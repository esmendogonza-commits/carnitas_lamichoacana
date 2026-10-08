# Asistente de WhatsApp de Carnitas La Michoacana

Un bot que contesta el WhatsApp del negocio, con la API oficial de Meta:

- Responde preguntas de **horario, ubicación, precios, menú, formas de pago y envíos**.
- **Toma pedidos para recoger**: producto, corte, cantidad, nombre, día y hora. Antes de confirmar le muestra al cliente un resumen con el total para que lo revise.
- **Te avisa a tu WhatsApp** en el momento en que un pedido queda confirmado.
- **Solo contesta.** Nunca le manda promociones ni mensajes a nadie que no le haya escrito primero.
- Si el cliente escribe **PERSONA**, te avisa y el bot deja de contestarle por 2 horas para que lo atiendas tú.

## Así se ve una conversación

```
Cliente: Hola, quisiera pedir 1 Kilo de Carnitas Tradicionales
Bot:     ¡Hola! 👋 Soy el asistente de Carnitas La Michoacana…
Bot:     ¿Qué corte quieres para tu kilo de carnitas?  [lista: Maciza, Costilla, …]
Cliente: [Surtida]
Bot:     ¿Cuántos kilos de carnitas?
Cliente: 1 y medio
Bot:     🧾 Llevas: 1,5 kg carnitas (Surtida): $555   [Agregar otro] [Es todo] [Cancelar]
Cliente: [Es todo]
Bot:     ¿A nombre de quién dejamos el pedido?
Cliente: Mariana
Bot:     ¿Qué día pasas a recogerlo?   [Mañana sábado] [Domingo 11/10] [Sábado 17/10]
Cliente: [Domingo 11/10]
Bot:     ¿A qué hora pasas? Puedes recoger de 9:00 am a 3:30 pm.
Cliente: 1:30
Bot:     Revisa tu pedido 📝 … Total: $555 … ¿Está todo bien?   [Confirmar] [Cambiar algo] [Cancelar]
Cliente: [Confirmar]
Bot:     ✅ ¡Listo, Mariana! Tu pedido #1 quedó confirmado para domingo 11/10 a la 1:30 pm.
A ti:    🔔 Nuevo pedido #1 · Mariana (+52…) · Recoge domingo 11/10 1:30 pm · Total: $555
```

Cuando le escribes al bot desde tu número tienes estos comandos:

| Escribes | Qué hace |
|---|---|
| `PEDIDOS` | Lista los pedidos pendientes |
| `PAUSA` | Deja de tomar pedidos, por ejemplo si ya se acabó lo del día. Sigue contestando preguntas. |
| `ACTIVAR` | Vuelve a tomar pedidos |

## Seguridad

- **API oficial de Meta.** No usa programas que "imitan" WhatsApp Web, que son los que hacen que bloqueen números.
- **Solo acepta mensajes firmados por Meta.** Cada mensaje que llega se comprueba con la clave secreta de la app; uno falso se rechaza.
- **Las claves no van en el código.** Viven en variables de entorno (`.env`), y `.env` nunca se sube a GitHub.
- **Freno contra abusos.** Atiende máximo 15 mensajes por minuto de cada número, ignora mensajes repetidos y rechaza los demasiado grandes.
- **Pocos datos y por poco tiempo.** Solo guarda nombre, número y pedido. Las conversaciones se borran a las 24 horas y los pedidos a los 30 días (`RETENTION_DAYS`). En los registros del servidor los números aparecen ocultos (`********2222`).
- **Cero dependencias externas.** Solo usa lo que trae Node.js, así que no hay paquetes de terceros que puedan venir infectados.

Tu página ya tiene un "Aviso de Privacidad". Revisa que diga que usas el nombre y el número del cliente para atender pedidos por WhatsApp, como pide la ley de datos personales en México.

## Lo que necesitas

1. **Una cuenta de Meta Business** (business.facebook.com), de preferencia verificada.
2. **Un número para el bot.** Tienes dos opciones:
   - Conectar el número que ya usas en **WhatsApp Business** (la app). Meta lo llama "coexistencia": sigues viendo los chats en la app y puedes contestar tú cuando alguien escribe PERSONA. Si al conectar no te aparece esa opción, usa la siguiente.
   - Usar un número nuevo que no esté en ninguna app de WhatsApp.
   - El bot va en el **55 3658 7818**, el mismo número al que llevan todos los botones de WhatsApp de la página.
3. **Un servidor con disco persistente** donde corra el bot las 24 horas, por ejemplo Railway con un volumen o Render con disco (unos 5 a 7 USD al mes). Los planes gratis "se duermen", y el cliente esperaría varios segundos la primera respuesta.
4. **Node.js 20.6 o más nuevo** si quieres probarlo en tu computadora.

**Costos de Meta:** contestar a los clientes que te escriben primero es gratis. Lo único que puede costar unos centavos es el aviso que te llega a ti con plantilla, y solo cuando no le has escrito al bot en las últimas 24 horas (ver paso 5).

## Instalación paso a paso

### 1. Crea la app en Meta
1. Entra a developers.facebook.com, ve a **Mis apps**, toca **Crear app** y elige el tipo **Negocios**. Agrega el producto **WhatsApp**.
2. En **WhatsApp > Configuración de la API**, agrega tu número y copia el **Identificador del número de teléfono**. Ese es tu `PHONE_NUMBER_ID`.
3. En **Configuración de la app > Básica**, copia la **Clave secreta de la app**. Esa es tu `APP_SECRET`.
4. Saca un **token permanente**: en Meta Business ve a **Configuración del negocio > Usuarios del sistema**, crea un usuario del sistema, dale acceso a la app y genera un token con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`. Ese es tu `WHATSAPP_TOKEN`. El token temporal de la página de prueba vence en 24 horas, no lo uses.

### 2. Sube el bot al servidor
1. En Railway o Render crea un servicio nuevo desde este repositorio, con la carpeta raíz `whatsapp-bot`.
2. El comando de arranque es `npm start`. No hace falta un paso de instalación.
3. Agrega un disco o volumen montado en `/data` y pon la variable `DATA_DIR=/data`.
4. Llena las variables de entorno siguiendo `.env.example`:
   - `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID` y `APP_SECRET`: los del paso 1.
   - `VERIFY_TOKEN`: una contraseña larga que inventas tú, de 16 caracteres o más.
   - `OWNER_PHONE`: tu WhatsApp personal, por ejemplo `5255XXXXXXXX`. Ahí te llegan los avisos.
5. Cuando arranque, abre `https://TU-SERVIDOR/health`. Debe decir `ok`.

### 3. Conecta Meta con tu servidor
1. En la app de Meta ve a **WhatsApp > Configuración > Webhook** y toca **Editar**.
2. En URL de devolución de llamada pon `https://TU-SERVIDOR/webhook`, y en Token de verificación pon el mismo `VERIFY_TOKEN`.
3. Tócale **Verificar y guardar**, y luego suscríbete al campo **messages**.

### 4. Prueba
Mándale "hola" al número del bot desde otro celular y haz un pedido de prueba. Luego, desde tu número, escribe `PEDIDOS`.

### 5. (Recomendado) Plantilla para que siempre te lleguen los avisos
WhatsApp solo deja que el bot te mande texto libre si tú le escribiste en las últimas 24 horas. El truco gratis es mandarle `PEDIDOS` cada sábado y domingo al abrir. Para no depender de eso, crea una plantilla:
1. En **WhatsApp > Plantillas de mensajes** crea una plantilla de categoría **Utilidad**, con nombre `nuevo_pedido`, idioma **Español (MEX)** y este texto:
   `Nuevo pedido {{1}}: {{2}}`
2. Cuando Meta la apruebe, agrega `OWNER_TEMPLATE_NAME=nuevo_pedido` a las variables del servidor.

Con eso, si el aviso normal no puede salir, el bot lo manda con la plantilla.

## Cambiar menú, precios u horario

Todo está en **`negocio.json`**. Lo puedes editar sin tocar el código:
- `menu`: productos, precios, descripción y cortes. `unidad` puede ser `kg`, `pieza` o `paquete`. En `palabras` van las palabras con que los clientes piden ese producto.
- `agenda`: días que abres (0 = domingo, 6 = sábado), horas, la última hora para recoger y cuántos minutos necesitan para preparar un pedido.
- `horarioTexto`, `direccion`, `pagos` y `domicilio`: lo que el bot contesta a esas preguntas.

Después de guardar los cambios, reinicia el servicio.

## Para quien programa

```bash
cd whatsapp-bot
cp .env.example .env   # llena los valores
npm test               # pruebas automáticas
npm run start:local    # arranca con .env
```

Archivos: `src/bot.js` tiene la conversación, `src/server.js` el webhook, la firma y los límites, `src/whatsapp.js` es el cliente de la API de Meta, `src/time.js` maneja horarios en hora de CDMX y `src/store.js` guarda los datos.
