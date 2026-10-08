import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const business = JSON.parse(fs.readFileSync(path.join(ROOT, 'negocio.json'), 'utf8'));

// Viernes 9 oct 2026, 6:00 pm en CDMX (UTC-6).
export const FRIDAY_EVENING = Date.parse('2026-10-10T00:00:00Z');
// Sábado 10 oct 2026, 10:00 am en CDMX.
export const SATURDAY_MORNING = Date.parse('2026-10-10T16:00:00Z');
