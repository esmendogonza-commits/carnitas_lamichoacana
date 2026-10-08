import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/server.js';
import { normalizePhone, verifySignature } from '../src/security.js';
import { Store } from '../src/store.js';
import { createWhatsAppClient } from '../src/whatsapp.js';
import { business, FRIDAY_EVENING } from './helpers.js';

const config = {
  appSecret: 'secreto-de-prueba',
  verifyToken: 'token-de-verificacion-largo',
  phoneNumberId: '111',
  ownerPhone: '525500000000',
  business,
};

const sign = (body) => `sha256=${crypto.createHmac('sha256', config.appSecret).update(body).digest('hex')}`;

function webhookBody(text, { id = 'wamid.1', from = '5215511112222', phoneNumberId = '111' } = {}) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: phoneNumberId },
          contacts: [{ wa_id: from, profile: { name: 'Cliente' } }],
          messages: [{ id, from, timestamp: String(FRIDAY_EVENING / 1000), type: 'text', text: { body: text } }],
        },
      }],
    }],
  });
}

async function withServer(fn) {
  const sent = [];
  const whatsapp = { send: async (m) => { sent.push(m); }, markRead: async () => {} };
  const store = new Store(null);
  const { server } = createApp({ config, store, whatsapp, now: () => FRIDAY_EVENING });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ base, sent, store });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 50));

test('la firma de Meta se valida con el App Secret', () => {
  const body = Buffer.from('{"a":1}');
  assert.equal(verifySignature(body, sign(body), config.appSecret), true);
  assert.equal(verifySignature(body, sign(Buffer.from('{"a":2}')), config.appSecret), false);
  assert.equal(verifySignature(body, 'sha256=abc', config.appSecret), false);
  assert.equal(verifySignature(body, undefined, config.appSecret), false);
});

test('los celulares de México se normalizan a 52 + 10 dígitos', () => {
  assert.equal(normalizePhone('5215511112222'), '525511112222');
  assert.equal(normalizePhone('+52 55 1111 2222'), '525511112222');
});

test('verificación del webhook solo con el token correcto', async () => {
  await withServer(async ({ base }) => {
    const ok = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=${config.verifyToken}&hub.challenge=12345`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '12345');
    const bad = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=12345`);
    assert.equal(bad.status, 403);
  });
});

test('rechaza mensajes sin firma o con firma falsa, y no contesta nada', async () => {
  await withServer(async ({ base, sent }) => {
    const body = webhookBody('hola');
    const unsigned = await fetch(`${base}/webhook`, { method: 'POST', body });
    assert.equal(unsigned.status, 401);
    const forged = await fetch(`${base}/webhook`, { method: 'POST', body, headers: { 'X-Hub-Signature-256': sign('otro cuerpo') } });
    assert.equal(forged.status, 401);
    await settle();
    assert.equal(sent.length, 0);
  });
});

test('contesta un mensaje firmado una sola vez aunque Meta lo reintente', async () => {
  await withServer(async ({ base, sent }) => {
    const body = webhookBody('hola');
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${base}/webhook`, { method: 'POST', body, headers: { 'X-Hub-Signature-256': sign(body) } });
      assert.equal(res.status, 200);
    }
    await settle();
    assert.equal(sent.length, 2); // saludo + botones, una sola vez
    assert.ok(sent.every((m) => m.to === '525511112222'));
  });
});

test('ignora mensajes de otro número de negocio', async () => {
  await withServer(async ({ base, sent }) => {
    const body = webhookBody('hola', { phoneNumberId: '999' });
    await fetch(`${base}/webhook`, { method: 'POST', body, headers: { 'X-Hub-Signature-256': sign(body) } });
    await settle();
    assert.equal(sent.length, 0);
  });
});

test('frena a quien manda demasiados mensajes seguidos', async () => {
  await withServer(async ({ base, sent }) => {
    for (let i = 0; i < 20; i++) {
      const body = webhookBody('hola', { id: `wamid.${i}` });
      await fetch(`${base}/webhook`, { method: 'POST', body, headers: { 'X-Hub-Signature-256': sign(body) } });
    }
    await settle();
    // 15 mensajes atendidos por minuto: el primero lleva saludo + botones, los demás una respuesta.
    assert.equal(sent.length, 16);
  });
});

test('rechaza cuerpos enormes', async () => {
  await withServer(async ({ base }) => {
    const body = 'x'.repeat(300 * 1024);
    const res = await fetch(`${base}/webhook`, { method: 'POST', body }).catch(() => ({ status: 413 }));
    assert.equal(res.status, 413);
  });
});

test('el aviso al dueño usa la plantilla si pasaron más de 24 h', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const payload = JSON.parse(init.body);
    calls.push(payload);
    if (payload.type === 'text') {
      return new Response(JSON.stringify({ error: { code: 131047, message: 'Re-engagement message' } }), { status: 400 });
    }
    return new Response(JSON.stringify({ messages: [{ id: 'ok' }] }), { status: 200 });
  };
  const client = createWhatsAppClient({ token: 't', phoneNumberId: '111', apiVersion: 'v23.0', ownerTemplate: 'nuevo_pedido', ownerTemplateLang: 'es_MX', fetchImpl });
  await client.send({ to: '525500000000', kind: 'owner', body: 'Nuevo pedido\n#1', params: ['#1', 'Ana, recoge\nsábado'] });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].type, 'template');
  assert.equal(calls[1].template.name, 'nuevo_pedido');
  assert.equal(calls[1].template.components[0].parameters[1].text, 'Ana, recoge · sábado');
});
