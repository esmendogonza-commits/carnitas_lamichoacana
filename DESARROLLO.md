# Cómo editar la página

La página es HTML estático publicado en Vercel. Los estilos ya vienen compilados en `css/styles.css`, así que no depende de ningún script externo.

Si agregas o cambias clases de Tailwind en `index.html` o `aviso-de-privacidad.html`, regenera los estilos:

```bash
npx tailwindcss@3.4.19 -c tailwind.config.js -i css/tailwind.src.css -o css/styles.css --minify
```

- Los colores, tipografías y espacios del diseño están en `tailwind.config.js`.
- El código JavaScript de la página está en `js/main.js`. No pongas `<script>` dentro del HTML: la política de seguridad de `vercel.json` los bloquea.
- `vercel.json` define los encabezados de seguridad, y `.vercelignore` evita que se publiquen el bot de WhatsApp y estos archivos de trabajo.
