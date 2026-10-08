import test from 'node:test';
import assert from 'node:assert/strict';
import { cdmxNow, parseTime, pickupDays, pickupProblem } from '../src/time.js';
import { business, FRIDAY_EVENING, SATURDAY_MORNING } from './helpers.js';

const agenda = business.agenda;

test('la hora local es la de la Ciudad de México', () => {
  assert.deepEqual(cdmxNow(SATURDAY_MORNING), { date: '2026-10-10', minutes: 600 });
});

test('entiende las formas comunes de decir una hora', () => {
  const cases = {
    '11:30': 690,
    '11': 660,
    '2 pm': 840,
    '2:15 p.m.': 855,
    'a las 3 y media': 930,
    '1': 780,
    'mediodía': 720,
    '14:00 hrs': 840,
    'once': 660,
    '10 am': 600,
    'como a las 2 de la tarde': 840,
  };
  for (const [text, minutes] of Object.entries(cases)) assert.equal(parseTime(text), minutes, text);
  assert.equal(parseTime('cuando puedan'), null);
  assert.equal(parseTime('25:00'), null);
});

test('ofrece solo sábados y domingos, y no hoy si ya es muy tarde', () => {
  assert.deepEqual(pickupDays(agenda, FRIDAY_EVENING, 3).map((d) => d.date), ['2026-10-10', '2026-10-11', '2026-10-17']);
  assert.equal(pickupDays(agenda, FRIDAY_EVENING, 3)[0].label, 'Mañana sábado');
  const saturdayLate = Date.parse('2026-10-10T21:10:00Z'); // 3:10 pm
  assert.deepEqual(pickupDays(agenda, saturdayLate, 2).map((d) => d.date), ['2026-10-11', '2026-10-17']);
});

test('rechaza horas fuera de servicio o sin tiempo para preparar', () => {
  assert.equal(pickupProblem(agenda, '2026-10-10', 690, SATURDAY_MORNING), null);
  assert.equal(pickupProblem(agenda, '2026-10-10', 615, SATURDAY_MORNING), 'too_soon');
  assert.equal(pickupProblem(agenda, '2026-10-10', 960, SATURDAY_MORNING), 'closed');
  assert.equal(pickupProblem(agenda, '2026-10-11', 480, SATURDAY_MORNING), 'closed');
  assert.equal(pickupProblem(agenda, '2026-10-04', 690, SATURDAY_MORNING), 'past');
});
