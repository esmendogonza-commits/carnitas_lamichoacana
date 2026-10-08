import { cdmxNow, describeDate, formatMinutes, hhmmToMinutes, parseTime, pickupDays, pickupProblem } from './time.js';

const ORDER_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const HANDOFF_MS = 2 * 60 * 60 * 1000;
const MAX_QTY = { kg: 10, pieza: 100, paquete: 20 };
const TEXT_TYPES = new Set(['text', 'interactive', 'button']);

const INTENTS = {
  hours: /\b(horario|horarios|hora|abren|abierto|abiertos|cierran|dias)\b/,
  menu: /\b(menu|carta|precio|precios|cuesta|cuestan|cuanto|venden|tienen)\b/,
  location: /\b(donde|ubicacion|ubicados|direccion|mapa|llegar)\b/,
  payment: /\b(pago|pagar|pagos|tarjeta|transferencia|efectivo)\b/,
  delivery: /\b(domicilio|envio|envios|enviar|entrega|llevan)\b/,
  order: /\b(pedido|pedir|ordenar|orden|encargar|encargo|apartar|quiero|quisiera|deseo)\b/,
  human: /\b(persona|humano|asesor|encargado|encargada)\b/,
  cancel: /^(cancelar|cancela|cancelo)\b/,
  greeting: /^(hola|ola|buenas|buen dia|buenos dias|que tal|hey)\b/,
  yes: /^(si|confirmo|confirmar|ok|va|sale|correcto|esta bien|todo bien)\b/,
  more: /^(otro|otra|mas|agregar|si)\b/,
  done: /^(es todo|seria todo|listo|no|terminar|ya|nada mas|eso es todo)\b/,
};

export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function money(n) {
  return `$${n.toLocaleString('es-MX', { maximumFractionDigits: 2 })}`;
}

// "Kilo de carnitas" se muestra como "1,5 kg carnitas", no "1,5 kg Kilo de carnitas".
function lineName(item) {
  return item.unidad === 'kg' ? item.nombre.replace(/^kilo de /i, '') : item.nombre;
}

function qtyLabel(qty, unit) {
  if (unit === 'kg') return `${String(qty).replace('.', ',')} kg`;
  const word = unit === 'paquete' ? 'paquete' : 'pieza';
  return `${qty} ${qty === 1 ? word : `${word}s`}`;
}

const NUMBER_WORDS = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };

// "1.5", "1 y medio", "medio kilo", "3/4", "dos" -> número. Devuelve null si no se entiende.
export function parseQuantity(norm) {
  const t = norm.replace(/(\d),(\d)/g, '$1.$2');
  let value = null;
  const fraction = t.match(/(\d+)\s*\/\s*(\d+)/);
  const number = t.match(/\d+(?:\.\d+)?/);
  const word = t.match(/\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/);
  if (/\btres cuartos\b/.test(t)) value = 0.75;
  else if (fraction && Number(fraction[2]) > 0) value = Number(fraction[1]) / Number(fraction[2]);
  else if (number) value = Number(number[0]);
  else if (/^(medio|1\/2)\b/.test(t)) value = 0.5;
  else if (/^(un )?cuarto\b/.test(t)) value = 0.25;
  else if (word) value = NUMBER_WORDS[word[1]];
  if (value === null) return null;
  if (!fraction && /\by medio\b/.test(t)) value += 0.5;
  if (!fraction && /\by cuarto\b/.test(t)) value += 0.25;
  return value;
}

function validQuantity(qty, unit) {
  if (qty === null || !(qty > 0) || qty > MAX_QTY[unit]) return false;
  return unit === 'kg' ? Number.isInteger(qty * 4) : Number.isInteger(qty);
}

function cleanName(raw) {
  const name = String(raw || '')
    .replace(/[^\p{L}\s.'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return name.length >= 2 && name.length <= 40 && /\p{L}/u.test(name) ? name : null;
}

const MAIN_BUTTONS = [
  { id: 'order_start', title: 'Hacer pedido' },
  { id: 'info_menu', title: 'Menú y precios' },
  { id: 'info_hours', title: 'Horario y ubicación' },
];

export function createBot({ business, store, ownerPhone, now = () => Date.now() }) {
  const menu = business.menu;
  const agenda = business.agenda;

  const text = (to, body) => ({ to, kind: 'text', body });
  const buttons = (to, body, list) => ({ to, kind: 'buttons', body, buttons: list });
  const owner = (body, params) => ({ to: ownerPhone, kind: 'owner', body, params });

  function matchItem(norm) {
    const words = new Set(norm.split(' '));
    return menu.find((item) => item.palabras.some((w) => words.has(w))) || null;
  }

  function menuText() {
    const lines = menu.map((m, i) => {
      const unit = m.unidad === 'kg' ? 'el kilo' : `por ${m.unidad}`;
      return `${i + 1}. *${m.nombre}*: ${money(m.precio)} ${unit}\n   ${m.descripcion}`;
    });
    return `🍖 *Menú de ${business.nombre}*\n\n${lines.join('\n')}`;
  }

  const hoursText = () => `🕘 *Horario:* ${business.horarioTexto}`;
  const locationText = () => `📍 *Dónde estamos:* ${business.direccion}\n${business.mapa}`;

  function cartLines(cart) {
    return cart.map((line) => {
      const cut = line.corte ? ` (${line.corte})` : '';
      return `• ${qtyLabel(line.qty, line.unidad)} ${lineName(line)}${cut}: ${money(line.subtotal)}`;
    });
  }

  function cartTotal(cart) {
    return {
      total: Math.round(cart.reduce((sum, l) => sum + l.subtotal, 0) * 100) / 100,
      approx: cart.some((l) => l.aproximado),
    };
  }

  function pickupText(pickup) {
    const { date: today } = cdmxNow(now());
    const time = formatMinutes(pickup.minutes);
    return `${describeDate(pickup.date, today)} ${time.startsWith('1:') ? 'a la' : 'a las'} ${time}`;
  }

  // ---- Pasos del pedido ----

  function startOrder(s, from, norm, out) {
    if (store.data.paused) {
      out.push(text(from, 'Por hoy ya no estamos tomando pedidos por aquí (se nos acabó lo del día 🙏). Escribe PERSONA si necesitas algo más.'));
      return;
    }
    s.state = 'pick_item';
    s.cart = s.cart || [];
    const item = norm ? matchItem(norm) : null;
    if (item) selectItem(s, from, item, norm, out);
    else out.push(itemList(from, '¿Qué te gustaría pedir? Elige del menú 👇 o escribe el número.'));
  }

  function itemList(from, body) {
    return {
      to: from,
      kind: 'list',
      body,
      button: 'Ver menú',
      rows: menu.map((m, i) => ({
        id: `item_${m.id}`,
        title: truncate(m.nombre, 24),
        description: truncate(`${i + 1}. ${money(m.precio)} ${m.unidad === 'kg' ? 'el kilo' : `por ${m.unidad}`}`, 72),
      })),
    };
  }

  function selectItem(s, from, item, norm, out) {
    s.current = { id: item.id };
    if (item.cortes) {
      const cut = norm && item.cortes.find((c) => norm.split(' ').includes(normalize(c)));
      if (cut) {
        s.current.corte = cut;
        quantityOrAsk(s, from, item, norm, out);
        return;
      }
      s.state = 'pick_cut';
      out.push({
        to: from,
        kind: 'list',
        body: `¿Qué corte quieres para tu ${item.nombre.toLowerCase()}?`,
        button: 'Ver cortes',
        rows: item.cortes.map((c, i) => ({ id: `cut_${i}`, title: c, description: '' })),
      });
      return;
    }
    quantityOrAsk(s, from, item, norm, out);
  }

  // Si el cliente ya dijo la cantidad ("quiero 5 tacos"), no se la volvemos a preguntar.
  function quantityOrAsk(s, from, item, norm, out) {
    const qty = norm ? parseQuantity(norm) : null;
    if (validQuantity(qty, item.unidad)) {
      addToCart(s, item, qty);
      askMore(s, from, out);
    } else {
      askQuantity(s, from, item, out);
    }
  }

  function askQuantity(s, from, item, out) {
    s.state = 'pick_qty';
    const question = {
      kg: `¿Cuántos kilos de ${lineName(item).toLowerCase()}? Escribe por ejemplo 1, 1.5 o medio.`,
      pieza: `¿Cuántas piezas de ${item.nombre.toLowerCase()}?`,
      paquete: `¿Cuántos paquetes ${item.nombre} quieres?`,
    }[item.unidad];
    out.push(text(from, question));
  }

  function addToCart(s, item, qty) {
    const existing = s.cart.find((l) => l.id === item.id && l.corte === s.current.corte);
    if (existing) existing.qty += qty;
    const line = existing || { id: item.id, nombre: item.nombre, corte: s.current.corte, unidad: item.unidad, precio: item.precio, aproximado: Boolean(item.precioAproximado), qty };
    line.subtotal = Math.round(line.qty * line.precio * 100) / 100;
    if (!existing) s.cart.push(line);
    s.current = null;
  }

  function askMore(s, from, out) {
    s.state = 'more';
    const { total } = cartTotal(s.cart);
    out.push(buttons(from, `🧾 Llevas:\n${cartLines(s.cart).join('\n')}\nTotal: ${money(total)}\n\n¿Quieres agregar algo más?`, [
      { id: 'order_more', title: 'Agregar otro' },
      { id: 'order_done', title: 'Es todo' },
      { id: 'order_cancel', title: 'Cancelar' },
    ]));
  }

  function askName(s, from, out) {
    s.state = 'ask_name';
    if (s.name) {
      out.push(buttons(from, `¿A nombre de quién dejamos el pedido? Toca el botón si es el mismo de la vez pasada o escribe otro nombre.`, [
        { id: 'name_same', title: truncate(s.name, 20) },
      ]));
    } else {
      out.push(text(from, '¿A nombre de quién dejamos el pedido?'));
    }
  }

  function askDay(s, from, out, intro) {
    const days = pickupDays(agenda, now(), 3);
    if (!days.length) {
      resetOrder(s);
      out.push(buttons(from, 'Por ahora no tenemos días disponibles para recoger. Escribe PERSONA y te atiende alguien del equipo.', MAIN_BUTTONS));
      return;
    }
    s.state = 'pick_day';
    s.dayOptions = days.map((d) => d.date);
    const body = `${intro ? `${intro}\n\n` : ''}¿Qué día pasas a recogerlo? Abrimos ${business.horarioTexto.charAt(0).toLowerCase()}${business.horarioTexto.slice(1)}`;
    out.push(buttons(from, body, days.map((d) => ({ id: `day_${d.date}`, title: d.label }))));
  }

  function askTime(s, from, out, intro) {
    s.state = 'pick_time';
    const { date: today } = cdmxNow(now());
    const range = `${formatMinutes(hhmmToMinutes(agenda.abre))} a ${formatMinutes(hhmmToMinutes(agenda.ultimaRecogida))}`;
    out.push(text(from, `${intro ? `${intro} ` : ''}¿A qué hora pasas ${s.pickupDate === today || describeDate(s.pickupDate, today).startsWith('mañana') ? '' : 'el '}${describeDate(s.pickupDate, today)}? Puedes recoger de ${range}. Ejemplo: 11:30 o 2 pm.`));
  }

  function showConfirm(s, from, out) {
    s.state = 'confirm';
    const { total, approx } = cartTotal(s.cart);
    const body = [
      'Revisa tu pedido 📝',
      '',
      ...cartLines(s.cart),
      `${approx ? 'Total aproximado' : 'Total'}: *${money(total)}*`,
      approx ? '(Lo que se vende por pieza entera se cobra según su peso real.)' : null,
      '',
      `👤 A nombre de: ${s.name}`,
      `🕘 Recoges: ${pickupText(s.pickup)}`,
      `📍 En: ${business.direccion}`,
      `💵 ${business.pagos}`,
      '',
      '¿Está todo bien?',
    ].filter((l) => l !== null).join('\n');
    out.push(buttons(from, body, [
      { id: 'confirm_yes', title: 'Confirmar' },
      { id: 'confirm_edit', title: 'Cambiar algo' },
      { id: 'order_cancel', title: 'Cancelar' },
    ]));
  }

  function confirmOrder(s, from, out) {
    if (pickupProblem(agenda, s.pickup.date, s.pickup.minutes, now())) {
      askDay(s, from, out, 'Esa hora ya no está disponible 😕. Elijamos otra.');
      return;
    }
    const { total, approx } = cartTotal(s.cart);
    const order = store.addOrder({ phone: from, name: s.name, items: s.cart, total, approx, pickup: s.pickup, createdAt: now() });
    const when = pickupText(order.pickup);
    out.push(text(from, `✅ ¡Listo, ${order.name}! Tu pedido *#${order.id}* quedó confirmado para ${when}.\n\nTe esperamos en ${business.direccion}\nSi necesitas cambiar algo escribe PERSONA.`));
    const summary = order.items.map((l) => `${qtyLabel(l.qty, l.unidad)} ${lineName(l)}${l.corte ? ` (${l.corte})` : ''}`).join(', ');
    out.push(owner(
      `🔔 *Nuevo pedido #${order.id}*\n👤 ${order.name} (+${from})\n🕘 Recoge ${when}\n${cartLines(order.items).join('\n')}\n${approx ? 'Total aproximado' : 'Total'}: ${money(total)}`,
      [`#${order.id}`, `${order.name}, +${from}, recoge ${when}. ${summary}. Total ${money(total)}`],
    ));
    resetOrder(s);
  }

  function resetOrder(s) {
    s.state = 'idle';
    s.cart = [];
    s.current = null;
    s.pickup = null;
    s.pickupDate = null;
    s.dayOptions = null;
  }

  // ---- Conversación sin pedido en curso ----

  function idle(s, from, norm, choice, isNew, out) {
    const intro = isNew && !choice;
    if (intro) out.push(text(from, `¡Hola! 👋 Soy el asistente de *${business.nombre}*. Usamos tu nombre y número solo para atender tu pedido.`));
    if (choice === 'order_start') return startOrder(s, from, null, out);
    if (choice === 'info_menu') {
      out.push(buttons(from, menuText(), [MAIN_BUTTONS[0], MAIN_BUTTONS[2]]));
      return;
    }
    if (choice === 'info_hours') {
      out.push(buttons(from, `${hoursText()}\n\n${locationText()}`, [MAIN_BUTTONS[0], MAIN_BUTTONS[1]]));
      return;
    }
    const wantsOrder = INTENTS.order.test(norm);
    const infos = [];
    if (INTENTS.hours.test(norm)) infos.push(hoursText());
    if (INTENTS.location.test(norm)) infos.push(locationText());
    if (!wantsOrder && (INTENTS.menu.test(norm) || matchItem(norm))) infos.push(menuText());
    if (INTENTS.payment.test(norm)) infos.push(`💵 ${business.pagos}`);
    if (INTENTS.delivery.test(norm)) infos.push(`🛵 ${business.domicilio}`);
    if (wantsOrder && !INTENTS.delivery.test(norm)) {
      if (infos.length) out.push(text(from, infos.join('\n\n')));
      startOrder(s, from, norm, out);
      return;
    }
    if (infos.length) {
      out.push(buttons(from, `${infos.join('\n\n')}\n\n¿Te ayudo con algo más?`, MAIN_BUTTONS));
      return;
    }
    if (intro || INTENTS.greeting.test(norm)) {
      out.push(buttons(from, `${intro ? '' : '¡Hola de nuevo! 👋 '}Te doy el menú, precios y horario, y agendo tu pedido para recoger. ¿Qué necesitas?`, MAIN_BUTTONS));
      return;
    }
    out.push(buttons(from, 'No te entendí bien 🙏. Elige una opción, o escribe PERSONA para hablar con alguien del equipo.', MAIN_BUTTONS));
  }

  // ---- Entrada principal: un mensaje de un cliente -> lista de mensajes a enviar ----

  function handleCustomer({ from, type, text: raw = '', choiceId = '', profileName = '' }) {
    const t = now();
    const out = [];
    const existing = store.session(from);
    const s = existing || { state: 'idle', cart: [], updatedAt: t };
    if (s.state !== 'idle' && t - s.updatedAt > ORDER_TIMEOUT_MS) {
      resetOrder(s);
      out.push(text(from, 'Tu pedido anterior quedó sin terminar, así que lo cancelé. Empecemos de nuevo 🙂'));
    }
    s.updatedAt = t;
    store.setSession(from, s);
    const norm = normalize(raw);
    const choice = choiceId;

    if (s.handoffUntil && t < s.handoffUntil) {
      if (/^(menu|bot|inicio)$/.test(norm)) {
        s.handoffUntil = null;
        out.push(buttons(from, '¡De vuelta! ¿En qué te ayudo?', MAIN_BUTTONS));
      } else if (raw) {
        const who = s.name || profileName || 'Cliente';
        out.push(owner(`💬 ${who} (+${from}): ${truncate(raw, 500)}`, [who, `+${from}: ${truncate(raw, 500)}`]));
      }
      return out;
    }

    if (!TEXT_TYPES.has(type)) {
      out.push(text(from, 'Por ahora solo puedo leer mensajes de texto 🙏. Escríbeme lo que necesitas.'));
      return out;
    }

    if (INTENTS.human.test(norm)) {
      resetOrder(s);
      s.handoffUntil = t + HANDOFF_MS;
      const who = s.name || profileName || 'Un cliente';
      out.push(text(from, 'Listo, ya le avisé al encargado. Te va a contactar en cuanto pueda. Si quieres volver al asistente automático, escribe MENU.'));
      out.push(owner(`🙋 ${who} (+${from}) quiere hablar con una persona. Mensaje: ${truncate(raw, 300)}`, [who, `+${from} quiere hablar con una persona`]));
      return out;
    }

    if (INTENTS.cancel.test(norm) || choice === 'order_cancel') {
      if (s.state === 'idle') out.push(buttons(from, 'No tienes ningún pedido en curso. ¿Te ayudo con algo?', MAIN_BUTTONS));
      else {
        resetOrder(s);
        out.push(buttons(from, 'Listo, cancelé el pedido. ¿Te ayudo con algo más?', MAIN_BUTTONS));
      }
      return out;
    }

    switch (s.state) {
      case 'pick_item': {
        const byChoice = choice.startsWith('item_') && menu.find((m) => `item_${m.id}` === choice);
        const byNumber = /^\d+$/.test(norm) && menu[Number(norm) - 1];
        const item = byChoice || byNumber || matchItem(norm);
        if (item) selectItem(s, from, item, byChoice || byNumber ? null : norm, out);
        else out.push(itemList(from, 'No encontré ese producto. Elige uno del menú 👇 o escribe su número.'));
        break;
      }
      case 'pick_cut': {
        const item = menu.find((m) => m.id === s.current.id);
        const index = choice.startsWith('cut_') ? Number(choice.slice(4)) : /^\d+$/.test(norm) ? Number(norm) - 1 : item.cortes.findIndex((c) => norm.includes(normalize(c)));
        if (item.cortes[index]) {
          s.current.corte = item.cortes[index];
          askQuantity(s, from, item, out);
        } else {
          out.push(text(from, `Elige un corte: ${item.cortes.join(', ')}.`));
        }
        break;
      }
      case 'pick_qty': {
        const item = menu.find((m) => m.id === s.current.id);
        const qty = parseQuantity(norm);
        if (validQuantity(qty, item.unidad)) {
          addToCart(s, item, qty);
          askMore(s, from, out);
        } else if (item.unidad === 'kg') {
          out.push(text(from, `Escribe los kilos con número, en múltiplos de 1/4 y hasta ${MAX_QTY.kg} kg. Por ejemplo: 1, 1.5 o 0.75.`));
        } else {
          out.push(text(from, `Escribe la cantidad con número, de 1 a ${MAX_QTY[item.unidad]}.`));
        }
        break;
      }
      case 'more': {
        const item = matchItem(norm);
        if (choice === 'order_done' || (!choice && INTENTS.done.test(norm))) askName(s, from, out);
        else if (item && !choice) {
          s.state = 'pick_item';
          selectItem(s, from, item, norm, out);
        } else if (choice === 'order_more' || INTENTS.more.test(norm)) {
          s.state = 'pick_item';
          out.push(itemList(from, '¿Qué más te gustaría agregar?'));
        } else askMore(s, from, out);
        break;
      }
      case 'ask_name': {
        const name = choice === 'name_same' ? s.name : cleanName(raw);
        if (name) {
          s.name = name;
          askDay(s, from, out);
        } else out.push(text(from, 'Escríbeme solo el nombre, por ejemplo: Juan Pérez.'));
        break;
      }
      case 'pick_day': {
        const { date: today } = cdmxNow(now());
        const options = s.dayOptions || [];
        const date = choice.startsWith('day_')
          ? choice.slice(4)
          : options.find((d) => normalize(describeDate(d, today)).split(' ').some((w) => norm.split(' ').includes(w)));
        if (date && options.includes(date)) {
          s.pickupDate = date;
          askTime(s, from, out);
        } else askDay(s, from, out, 'Elige uno de los días disponibles.');
        break;
      }
      case 'pick_time': {
        const minutes = parseTime(raw);
        const problem = minutes === null ? 'unreadable' : pickupProblem(agenda, s.pickupDate, minutes, now());
        if (!problem) {
          s.pickup = { date: s.pickupDate, minutes };
          showConfirm(s, from, out);
        } else if (problem === 'past') askDay(s, from, out, 'Ese día ya pasó.');
        else if (problem === 'too_soon') askTime(s, from, out, `Necesitamos al menos ${agenda.anticipacionMinutos} minutos para prepararlo.`);
        else if (problem === 'closed') askTime(s, from, out, 'A esa hora no estamos recogiendo pedidos.');
        else askTime(s, from, out, 'No entendí la hora.');
        break;
      }
      case 'confirm': {
        if (choice === 'confirm_yes' || (!choice && INTENTS.yes.test(norm))) confirmOrder(s, from, out);
        else if (choice === 'confirm_edit' || /\bcambiar\b/.test(norm)) {
          s.cart = [];
          out.push(text(from, 'Va, armemos el pedido otra vez.'));
          startOrder(s, from, null, out);
        } else showConfirm(s, from, out);
        break;
      }
      default:
        idle(s, from, norm, choice, !existing, out);
    }
    return out;
  }

  // ---- Mensajes del dueño (desde OWNER_PHONE) ----

  function handleOwner({ text: raw = '' }) {
    const norm = normalize(raw);
    const reply = (body) => [text(ownerPhone, body)];
    if (norm === 'pedidos') {
      const { date: today } = cdmxNow(now());
      const orders = store.upcomingOrders(today);
      if (!orders.length) return reply('No hay pedidos pendientes.');
      const lines = orders.map((o) => `#${o.id} · ${describeDate(o.pickup.date, today)} ${formatMinutes(o.pickup.minutes)} · ${o.name} (+${o.phone}) · ${money(o.total)}\n   ${o.items.map((l) => `${qtyLabel(l.qty, l.unidad)} ${lineName(l)}${l.corte ? ` (${l.corte})` : ''}`).join(', ')}`);
      return reply(`📋 *Pedidos pendientes*\n\n${lines.join('\n')}`);
    }
    if (norm === 'pausa') {
      store.data.paused = true;
      return reply('⏸️ Listo: el bot ya no toma pedidos nuevos (sigue contestando preguntas). Escribe ACTIVAR para reanudar.');
    }
    if (norm === 'activar') {
      store.data.paused = false;
      return reply('▶️ Listo: el bot vuelve a tomar pedidos.');
    }
    return reply('Comandos: PEDIDOS (ver pedidos pendientes), PAUSA (dejar de tomar pedidos, por ejemplo si se acabó), ACTIVAR (volver a tomarlos).');
  }

  return { handleCustomer, handleOwner };
}
