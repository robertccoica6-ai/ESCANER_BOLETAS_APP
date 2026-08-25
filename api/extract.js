// Backend proxy — corre en el servidor, nunca en el navegador.
// Guarda tu API key aquí (variable de entorno GEMINI_API_KEY) y nunca en el frontend.
//
// Desplegado en Vercel, este archivo se convierte automáticamente en el
// endpoint POST /api/extract — no requiere configuración adicional.
//
// Usa la API de Gemini (Google), que ofrece un tier gratuito con límite de
// solicitudes por día — útil mientras pruebas o si tu volumen es bajo.
// Consulta límites y precios vigentes en https://ai.google.dev/gemini-api/docs/pricing

const GEMINI_MODEL = "gemini-3.7-flash"; // rápido y barato; revisa ai.google.dev por modelos vigentes

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      error: "Falta configurar GEMINI_API_KEY en las variables de entorno del servidor.",
    });
  }

  try {
    // El frontend manda: { content: [ {type:"image"|"document", source:{...}}, {type:"text", text} ] }
    // Lo traducimos al formato que espera Gemini.
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: "Falta el campo 'content' en la solicitud." });
    }

    const textBlock = content.find((b) => b.type === "text");
    const fileBlock = content.find((b) => b.type === "image" || b.type === "document");

    const parts = [];
    if (fileBlock) {
      parts.push({
        inline_data: {
          mime_type: fileBlock.source.media_type,
          data: fileBlock.source.data,
        },
      });
    }
    if (textBlock) {
      parts.push({ text: textBlock.text });
    }

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { maxOutputTokens: 1000 },
        }),
      }
    );

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      return res.status(geminiResponse.status).json(geminiData);
    }

    // Adaptamos la respuesta de Gemini al mismo formato { content: [{type:"text", text}] }
    // que ya usa el frontend, para no tener que tocar App.jsx.
    const text = geminiData?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n") || "";

    return res.status(200).json({ content: [{ type: "text", text }] });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Error interno del servidor" });
  }
}

