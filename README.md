# Escáner de Boletas & Facturas

App para escanear boletas/facturas con IA y exportarlas a Excel.

## Estructura

```
boletas-app/
├── src/App.jsx        ← la interfaz (lo que viste como artifact en Claude)
├── src/main.jsx        ← arranca la app
├── api/extract.js       ← backend que llama a Claude con tu API key (nunca en el navegador)
├── index.html
├── package.json
└── .env.example
```

## Cómo probarlo en tu computadora

1. **Instala Node.js** (v18 o superior) si no lo tienes: https://nodejs.org

2. **Instala las dependencias**, parado en la carpeta del proyecto:
   ```
   npm install
   ```

3. **Consigue tu API key de Gemini (gratis)**: entra a
   https://aistudio.google.com/apikey con tu cuenta de Google y genera una
   key. Gemini tiene un tier gratuito con límite de solicitudes por día —
   suficiente para probar y para uso bajo. Si lo superas, se cobra por uso
   (revisa precios vigentes en https://ai.google.dev/gemini-api/docs/pricing).

4. **Copia `.env.example` a `.env`** y pega tu key ahí:
   ```
   cp .env.example .env
   ```

5. **Corre el proyecto**:
   ```
   npm run dev
   ```
   Nota: el endpoint `/api/extract` solo funciona con Vercel corriendo
   localmente (`vercel dev`) o ya desplegado — con `npm run dev` a secas
   verás la interfaz pero el escaneo fallará hasta que despliegues (paso
   siguiente) o instales `vercel` para probar el backend en local.

## Cómo publicarlo en internet (recomendado: Vercel, es gratis para empezar)

1. Crea una cuenta en https://vercel.com (puedes entrar con tu cuenta de GitHub).

2. Sube este proyecto a un repositorio de GitHub (o usa `vercel` desde la
   terminal sin GitHub, con `npx vercel` parado en esta carpeta).

3. En Vercel, importa el repositorio. Vercel detecta automáticamente que es
   un proyecto Vite y configura el build.

4. **Antes de desplegar**, agrega tu API key como variable de entorno en
   Vercel: Project Settings → Environment Variables → agrega
   `GEMINI_API_KEY` con tu key real. Esto es lo que reemplaza al `.env`
   en producción.

5. Dale a Deploy. En unos minutos tendrás una URL pública
   (`tu-proyecto.vercel.app`) — ese es tu escáner de boletas, ya en internet,
   listo para que cualquiera lo use (o solo tú, si no lo compartes).

6. (Opcional) Conecta un dominio propio desde Project Settings → Domains.

## Costos a tener en cuenta

- **Vercel**: el plan gratuito alcanza de sobra para empezar.
- **Gemini API**: tier gratuito con límite de solicitudes por día — bien
  para empezar. Si superas el límite o creces, se cobra por uso (tokens).
  Revisa precios vigentes en https://ai.google.dev/gemini-api/docs/pricing
  para estimar tu costo por boleta antes de ofrecerlo a otras personas.

## Siguientes pasos sugeridos

- Agregar login (ej. con Clerk o Auth0) si más de una persona lo va a usar.
- Agregar una base de datos (ej. Supabase o Postgres) para guardar el
  historial de boletas entre sesiones — ahora mismo se pierde al recargar.
- Si vas a cobrar por esto, integrar Stripe para suscripciones.
