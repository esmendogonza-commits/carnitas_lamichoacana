import fs from 'node:fs';
import path from 'node:path';

const EMPTY = () => ({ sessions: {}, orders: [], seq: 0, processed: [], paused: false });
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PROCESSED_IDS = 2000;

// Guarda conversaciones y pedidos en un archivo JSON. Cada escritura es atómica
// (archivo temporal + rename), así un corte de luz no deja el archivo a medias.
export class Store {
  constructor(file, { retentionDays = 30 } = {}) {
    this.file = file;
    this.retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    this.data = file ? this.load() : EMPTY();
  }

  load() {
    try {
      return { ...EMPTY(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch (err) {
      if (err.code === 'ENOENT') return EMPTY();
      throw new Error(`No se pudo leer ${this.file}: ${err.message}`);
    }
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  session(phone) {
    return this.data.sessions[phone] || null;
  }

  setSession(phone, session) {
    this.data.sessions[phone] = session;
  }

  // Devuelve true la primera vez que ve un id de mensaje; Meta reintenta envíos y no queremos responder dos veces.
  markProcessed(messageId) {
    if (this.data.processed.includes(messageId)) return false;
    this.data.processed.push(messageId);
    if (this.data.processed.length > MAX_PROCESSED_IDS) this.data.processed.splice(0, this.data.processed.length - MAX_PROCESSED_IDS);
    return true;
  }

  addOrder(order) {
    this.data.seq += 1;
    const saved = { ...order, id: this.data.seq };
    this.data.orders.push(saved);
    return saved;
  }

  upcomingOrders(today) {
    return this.data.orders
      .filter((o) => o.pickup.date >= today)
      .sort((a, b) => a.pickup.date.localeCompare(b.pickup.date) || a.pickup.minutes - b.pickup.minutes);
  }

  // Borra datos personales que ya no hacen falta: conversaciones viejas y pedidos pasados.
  purge(now = Date.now()) {
    for (const [phone, s] of Object.entries(this.data.sessions)) {
      if (now - s.updatedAt > SESSION_TTL_MS) delete this.data.sessions[phone];
    }
    this.data.orders = this.data.orders.filter((o) => now - o.createdAt < this.retentionMs);
  }
}
