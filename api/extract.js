const GEMINI_MODEL = "gemini-3.6-flash";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      error: "Falta configurar GEMINI_API_KEY en Vercel.",
    });
  }

  try {
    const { content } = req.body;
    if (!content || !Array.isArray(content)) {
      return res.status(400).json({ error: "Estructura de 'content' inválida." });
    }

    // Convertimos la estructura de la petición a la estructura nativa de Gemini
    const parts = content
      .map((block) => {
        if (block.type === "image" || block.type === "document") {
          return {
            inline_data: {
              mime_type: block.source?.media_type || "image/jpeg",
              data: block.source?.data,
            },
          };
        }
        if (block.type === "text") {
          return { text: block.text };
        }
        return null;
      })
      .filter(Boolean);

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
        }),
      }
    );

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      return res.status(geminiResponse.status).json({
        error: geminiData?.error?.message || "Error al comunicarse con Gemini",
      });
    }

    const text =
      geminiData?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n") || "";

    return res.status(200).json({ content: [{ type: "text", text }] });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Error interno del servidor" });
  }
}