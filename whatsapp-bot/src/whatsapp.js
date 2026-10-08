// Cliente mínimo de la API oficial de WhatsApp Cloud (Meta). Sin dependencias externas.
const REENGAGEMENT_ERROR = 131047; // pasaron más de 24 h desde el último mensaje de esa persona

// Las variables de una plantilla no aceptan saltos de línea, tabuladores ni más de 4 espacios seguidos.
function templateParam(text) {
  return String(text).replace(/[\n\t]+/g, ' · ').replace(/ {2,}/g, ' ').slice(0, 1000);
}

export function toPayload(msg) {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: msg.to };
  if (msg.kind === 'buttons') {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: msg.body.slice(0, 1024) },
        action: { buttons: msg.buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) },
      },
    };
  }
  if (msg.kind === 'list') {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: msg.body.slice(0, 1024) },
        action: {
          button: msg.button.slice(0, 20),
          sections: [{ title: 'Opciones', rows: msg.rows.slice(0, 10).map((r) => ({ id: r.id, title: r.title.slice(0, 24), ...(r.description ? { description: r.description.slice(0, 72) } : {}) })) }],
        },
      },
    };
  }
  return { ...base, type: 'text', text: { body: msg.body.slice(0, 4096), preview_url: false } };
}

export function createWhatsAppClient({ token, phoneNumberId, apiVersion, ownerTemplate, ownerTemplateLang, fetchImpl = fetch }) {
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  async function post(payload) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`WhatsApp API ${res.status}: ${data?.error?.message || 'error'}`);
      err.code = data?.error?.code;
      throw err;
    }
    return data;
  }

  // Avisos al dueño: primero como texto normal; si WhatsApp lo rechaza porque el dueño
  // no ha escrito al bot en 24 h, se manda con la plantilla aprobada (si está configurada).
  async function sendOwner(msg) {
    try {
      return await post(toPayload({ ...msg, kind: 'text' }));
    } catch (err) {
      if (err.code !== REENGAGEMENT_ERROR || !ownerTemplate) throw err;
      return post({
        messaging_product: 'whatsapp',
        to: msg.to,
        type: 'template',
        template: {
          name: ownerTemplate,
          language: { code: ownerTemplateLang },
          components: [{ type: 'body', parameters: msg.params.map((p) => ({ type: 'text', text: templateParam(p) })) }],
        },
      });
    }
  }

  return {
    send(msg) {
      return msg.kind === 'owner' ? sendOwner(msg) : post(toPayload(msg));
    },
    markRead(messageId) {
      return post({ messaging_product: 'whatsapp', status: 'read', message_id: messageId });
    },
  };
}
