import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createBot } from './bot.js';
import { loadConfig } from './config.js';
import { RateLimiter, maskPhone, normalizePhone, safeEqual, verifySignature } from './security.js';
import { Store } from './store.js';
import { createWhatsAppClient } from './whatsapp.js';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_TEXT_CHARS = 1000;
const MAX_MESSAGE_AGE_MS = 24 * 60 * 60 * 1000;

const log = (...args) => console.log(new Date().toISOString(), ...args);

// Saca de un mensaje de WhatsApp lo único que el bot necesita.
export function extractInput(message, contacts = []) {
  const from = normalizePhone(message.from);
  const profileName = contacts.find((c) => normalizePhone(c.wa_id) === from)?.profile?.name || '';
  const reply = message.interactive?.button_reply || message.interactive?.list_reply;
  return {
    id: message.id,
    from,
    type: message.type,
    text: String(message.text?.body ?? reply?.title ?? message.button?.text ?? '').slice(0, MAX_TEXT_CHARS),
    choiceId: String(reply?.id ?? message.button?.payload ?? '').slice(0, 100),
    profileName: String(profileName).slice(0, 60),
    timestampMs: Number(message.timestamp) * 1000,
  };
}

export function createApp({ config, store, whatsapp, now = () => Date.now() }) {
  const bot = createBot({ business: config.business, store, ownerPhone: config.ownerPhone, now });
  const limiter = new RateLimiter({ limit: 15, windowMs: 60_000 });

  async function processWebhook(body) {
    for (const entry of body?.entry || []) {
      for (const change of entry?.changes || []) {
        const value = change?.value;
        if (change?.field !== 'messages' || value?.metadata?.phone_number_id !== config.phoneNumberId) continue;
        for (const message of value.messages || []) {
          const input = extractInput(message, value.contacts);
          if (!input.id || !input.from || !store.markProcessed(input.id)) continue;
          if (now() - input.timestampMs > MAX_MESSAGE_AGE_MS) continue;
          if (!limiter.allow(input.from, now())) {
            log('límite de mensajes alcanzado', maskPhone(input.from));
            continue;
          }
          const outgoing = input.from === config.ownerPhone ? bot.handleOwner(input) : bot.handleCustomer(input);
          store.save();
          whatsapp.markRead(input.id).catch(() => {});
          for (const msg of outgoing) {
            try {
              await whatsapp.send(msg);
            } catch (err) {
              log(`no se pudo enviar a ${maskPhone(msg.to)}:`, err.message);
            }
          }
        }
      }
    }
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(Object.assign(new Error('demasiado grande'), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, text = '') => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
      res.end(text);
    };
    if (url.pathname === '/health' && req.method === 'GET') return send(200, 'ok');
    if (url.pathname !== '/webhook') return send(404);

    // Meta verifica el webhook una vez al configurarlo.
    if (req.method === 'GET') {
      const challenge = url.searchParams.get('hub.challenge') || '';
      const ok = url.searchParams.get('hub.mode') === 'subscribe'
        && safeEqual(url.searchParams.get('hub.verify_token') || '', config.verifyToken)
        && /^[\w-]{1,200}$/.test(challenge);
      return ok ? send(200, challenge) : send(403);
    }
    if (req.method !== 'POST') return send(405);

    let raw;
    try {
      raw = await readBody(req);
    } catch (err) {
      return send(err.status || 400);
    }
    // Solo aceptamos mensajes firmados por Meta: cualquier otro se rechaza.
    if (!verifySignature(raw, req.headers['x-hub-signature-256'], config.appSecret)) return send(401);
    let body;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return send(400);
    }
    send(200, 'ok'); // Meta espera respuesta rápida; procesamos después.
    processWebhook(body).catch((err) => log('error procesando mensaje:', err.message));
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      log('error inesperado:', err.message);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return { server, processWebhook, limiter };
}

function main() {
  const config = loadConfig();
  const store = new Store(config.dataFile, { retentionDays: config.retentionDays });
  const whatsapp = createWhatsAppClient(config);
  const { server, limiter } = createApp({ config, store, whatsapp });

  const cleanup = setInterval(() => {
    store.purge();
    store.save();
    limiter.prune();
  }, 60 * 60 * 1000);
  cleanup.unref();

  const shutdown = () => {
    store.save();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  server.listen(config.port, () => log(`Bot de ${config.business.nombre} escuchando en el puerto ${config.port}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
