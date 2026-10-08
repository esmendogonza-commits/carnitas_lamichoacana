import test from 'node:test';
import assert from 'node:assert/strict';
import { createBot, parseQuantity } from '../src/bot.js';
import { Store } from '../src/store.js';
import { business, FRIDAY_EVENING, SATURDAY_MORNING } from './helpers.js';

const OWNER = '525500000000';
const CLIENT = '525511112222';

function setup(start = FRIDAY_EVENING) {
  let clock = start;
  const store = new Store(null);
  const bot = createBot({ business, store, ownerPhone: OWNER, now: () => clock });
  const say = (text, extra = {}) => bot.handleCustomer({ from: CLIENT, type: 'text', text, ...extra });
  const tap = (choiceId) => bot.handleCustomer({ from: CLIENT, type: 'interactive', text: '', choiceId });
  return { store, bot, say, tap, advance: (ms) => { clock += ms; } };
}

const bodies = (out) => out.map((m) => m.body).join('\n');

test('cantidades en palabras y fracciones', () => {
  assert.equal(parseQuantity('1.5'), 1.5);
  assert.equal(parseQuantity('1,5'), 1.5);
  assert.equal(parseQuantity('medio'), 0.5);
  assert.equal(parseQuantity('1 y medio'), 1.5);
  assert.equal(parseQuantity('3/4'), 0.75);
  assert.equal(parseQuantity('dos kilos'), 2);
  assert.equal(parseQuantity('un cuarto'), 0.25);
  assert.equal(parseQuantity('nada'), null);
});

test('pedido completo con botones: confirma al cliente y avisa al dueño', () => {
  const { store, say, tap } = setup();
  let out = say('Hola');
  assert.match(out[0].body, /nombre y número solo/);
  assert.equal(out[1].kind, 'buttons');

  out = tap('order_start');
  assert.equal(out[0].kind, 'list');
  assert.equal(out[0].rows.length, business.menu.length);
  assert.ok(out[0].rows.every((r) => r.title.length <= 24));

  out = tap('item_kilo');
  assert.equal(out[0].kind, 'list');
  out = tap('cut_0');
  assert.match(bodies(out), /kilos/);
  out = say('1 y medio');
  assert.match(bodies(out), /1,5 kg carnitas \(Maciza\): \$555/);

  out = tap('order_more');
  out = say('5 tacos');
  assert.match(bodies(out), /5 piezas Taco de carnitas: \$140/);
  assert.match(bodies(out), /Total: \$695/);

  out = tap('order_done');
  assert.match(bodies(out), /nombre/);
  out = say('Juan Pérez 😀');
  assert.equal(out[0].kind, 'buttons');
  assert.ok(out[0].buttons.every((b) => b.title.length <= 20));
  out = tap('day_2026-10-10');
  out = say('11:30');
  assert.match(bodies(out), /Juan Pérez/);
  assert.match(bodies(out), /mañana sábado a las 11:30 am/);
  assert.equal(store.data.orders.length, 0);

  out = tap('confirm_yes');
  assert.equal(store.data.orders.length, 1);
  const [toClient, toOwner] = out;
  assert.equal(toClient.to, CLIENT);
  assert.match(toClient.body, /#1/);
  assert.equal(toOwner.to, OWNER);
  assert.equal(toOwner.kind, 'owner');
  assert.match(toOwner.body, /Juan Pérez \(\+525511112222\)/);
  assert.match(toOwner.body, /Total: \$695/);
  assert.ok(toOwner.params.every((p) => !p.includes('\n')));
  assert.equal(store.session(CLIENT).state, 'idle');
});

test('el mensaje del botón de la página web arranca el pedido con lo que ya dijo', () => {
  const { say } = setup();
  let out = say('Hola, me gustaria pedir Tacos de Carnitas Surtidas');
  assert.match(bodies(out), /Soy el asistente/);
  assert.match(bodies(out), /Cuántas piezas de taco/);
});

test('"quiero 5 tacos" agrega directo sin volver a preguntar', () => {
  const { say } = setup();
  say('hola');
  const out = say('quiero 5 tacos');
  assert.match(bodies(out), /Llevas:\n• 5 piezas Taco de carnitas/);
});

test('rechaza horas fuera de servicio y vuelve a preguntar', () => {
  const { say, tap } = setup(SATURDAY_MORNING);
  say('hola');
  tap('order_start');
  tap('item_taco');
  say('3');
  tap('order_done');
  say('Ana');
  tap('day_2026-10-10');
  assert.match(bodies(say('9:00')), /al menos 30 minutos/);
  assert.match(bodies(say('5 pm')), /no estamos recogiendo/);
  assert.match(bodies(say('cuando sea')), /No entendí la hora/);
  assert.match(bodies(say('12')), /Revisa tu pedido/);
});

test('contesta horario, ubicación y precios sin iniciar un pedido', () => {
  const { say, store } = setup();
  const out = say('a qué hora abren y dónde están?');
  assert.match(bodies(out), /Sábado y domingo/);
  assert.match(bodies(out), /Mercado Progreso del Sur/);
  assert.equal(store.session(CLIENT).state, 'idle');
  assert.match(bodies(say('cuanto cuesta el kilo')), /\$370 el kilo/);
});

test('cancelar borra el pedido en curso', () => {
  const { say, tap, store } = setup();
  say('hola');
  tap('order_start');
  tap('item_taco');
  const out = say('cancelar');
  assert.match(bodies(out), /cancelé/);
  assert.equal(store.session(CLIENT).state, 'idle');
  assert.equal(store.session(CLIENT).cart.length, 0);
});

test('un pedido abandonado por horas se reinicia', () => {
  const { say, tap, advance } = setup();
  say('hola');
  tap('order_start');
  advance(4 * 60 * 60 * 1000);
  assert.match(bodies(say('hola')), /quedó sin terminar/);
});

test('PERSONA avisa al dueño y el bot se calla hasta que escriban MENU', () => {
  const { say } = setup();
  let out = say('quiero hablar con una persona');
  assert.ok(out.some((m) => m.to === OWNER && /quiere hablar/.test(m.body)));
  out = say('es para un evento de 50 personas');
  assert.equal(out.length, 1);
  assert.equal(out[0].to, OWNER);
  out = say('menu');
  assert.equal(out[0].to, CLIENT);
});

test('mensajes de voz o fotos reciben una respuesta amable', () => {
  const { bot } = setup();
  const out = bot.handleCustomer({ from: CLIENT, type: 'audio' });
  assert.match(bodies(out), /solo puedo leer mensajes de texto/);
});

test('comandos del dueño: PEDIDOS, PAUSA y ACTIVAR', () => {
  const { bot, say, tap } = setup();
  assert.match(bodies(bot.handleOwner({ text: 'pedidos' })), /No hay pedidos/);
  say('hola');
  tap('order_start');
  tap('item_quesadilla');
  say('4');
  tap('order_done');
  say('Luis');
  tap('day_2026-10-11');
  say('1 pm');
  tap('confirm_yes');
  assert.match(bodies(bot.handleOwner({ text: 'Pedidos' })), /#1 · domingo 11\/10 1:00 pm · Luis/);

  bot.handleOwner({ text: 'PAUSA' });
  assert.match(bodies(say('quiero hacer un pedido')), /ya no estamos tomando pedidos/);
  bot.handleOwner({ text: 'activar' });
  assert.equal(say('quiero hacer un pedido')[0].kind, 'list');
});
