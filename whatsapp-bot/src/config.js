import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePhone } from './security.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED = ['WHATSAPP_TOKEN', 'PHONE_NUMBER_ID', 'APP_SECRET', 'VERIFY_TOKEN', 'OWNER_PHONE'];

// Lee la configuración de variables de entorno. Las claves nunca van en el código.
export function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Faltan variables de entorno: ${missing.join(', ')} (ver .env.example)`);
  if (env.VERIFY_TOKEN.length < 16) throw new Error('VERIFY_TOKEN debe tener al menos 16 caracteres.');
  const businessFile = env.BUSINESS_FILE || path.join(ROOT, 'negocio.json');
  return {
    token: env.WHATSAPP_TOKEN,
    phoneNumberId: env.PHONE_NUMBER_ID,
    appSecret: env.APP_SECRET,
    verifyToken: env.VERIFY_TOKEN,
    ownerPhone: normalizePhone(env.OWNER_PHONE),
    apiVersion: env.GRAPH_API_VERSION || 'v23.0',
    ownerTemplate: env.OWNER_TEMPLATE_NAME || '',
    ownerTemplateLang: env.OWNER_TEMPLATE_LANG || 'es_MX',
    port: Number(env.PORT || 3000),
    dataFile: path.join(env.DATA_DIR || path.join(ROOT, 'data'), 'estado.json'),
    retentionDays: Number(env.RETENTION_DAYS || 30),
    business: JSON.parse(fs.readFileSync(businessFile, 'utf8')),
  };
}
