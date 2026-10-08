// Fechas y horas siempre en la hora de la Ciudad de México.
const TZ = 'America/Mexico_City';
const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// Devuelve { date: 'YYYY-MM-DD', minutes: minutos desde medianoche } en CDMX.
export function cdmxNow(now) {
  const parts = Object.fromEntries(formatter.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, '0');
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function weekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function describeDate(date, today) {
  const [, m, d] = date.split('-');
  const name = DAY_NAMES[weekday(date)];
  if (date === today) return `hoy ${name}`;
  if (date === addDays(today, 1)) return `mañana ${name}`;
  return `${name} ${d}/${m}`;
}

// Próximos días en que se puede recoger, con su etiqueta para un botón (máx. 20 caracteres).
export function pickupDays(agenda, now, count = 2) {
  const { date: today, minutes } = cdmxNow(now);
  const lastSlot = hhmmToMinutes(agenda.ultimaRecogida);
  const days = [];
  for (let i = 0; i <= agenda.diasAdelante && days.length < count; i++) {
    const date = addDays(today, i);
    if (!agenda.dias.includes(weekday(date))) continue;
    if (i === 0 && minutes + agenda.anticipacionMinutos > lastSlot) continue;
    const label = describeDate(date, today);
    days.push({ date, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return days;
}

const WORD_HOURS = { una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, nueve: 9, diez: 10, once: 11, doce: 12 };

// Convierte "11:30", "2 pm", "las 3 y media", "mediodía" en minutos desde medianoche.
// Una hora de 1 a 8 sin am/pm se toma como de la tarde, porque el local abre de día.
export function parseTime(text) {
  let t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/medio\s?dia/.test(t)) return 12 * 60;
  t = t.replace(/\b(una|dos|tres|cuatro|cinco|nueve|diez|once|doce)\b/g, (w) => String(WORD_HOURS[w]));
  const match = t.match(/(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?\s*(y media|y cuarto|a\.?\s?m\.?|p\.?\s?m\.?|de la tarde|de la manana)?/);
  if (!match) return null;
  let hour = Number(match[1]);
  let minute = match[2] ? Number(match[2]) : 0;
  const suffix = (match[3] || '').replace(/[.\s]/g, '');
  if (suffix === 'ymedia') minute = 30;
  if (suffix === 'ycuarto') minute = 15;
  if (hour > 23 || minute > 59) return null;
  const pm = suffix === 'pm' || suffix === 'delatarde' || /tarde/.test(t);
  const am = suffix === 'am' || suffix === 'delamanana';
  if (pm && hour < 12) hour += 12;
  else if (am && hour === 12) hour = 0;
  else if (!am && !pm && hour >= 1 && hour <= 8) hour += 12;
  return hour * 60 + minute;
}

// Valida una hora de recogida. Devuelve null si es válida o el motivo si no.
export function pickupProblem(agenda, date, minutes, now) {
  const { date: today, minutes: nowMinutes } = cdmxNow(now);
  if (date < today) return 'past';
  if (minutes < hhmmToMinutes(agenda.abre) || minutes > hhmmToMinutes(agenda.ultimaRecogida)) return 'closed';
  if (date === today && minutes < nowMinutes + agenda.anticipacionMinutos) return 'too_soon';
  return null;
}
