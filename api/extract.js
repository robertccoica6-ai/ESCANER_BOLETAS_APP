const GEMINI_MODEL = "gemini-2.5-flash";

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
    const { content } = req.body;
    if (!content || !Array.isArray(content)) {
      return res.status(400).json({ error: "Falta el campo 'content' o formato inválido." });
    }

    // Procesa múltiples archivos y bloques de texto en el formato exacto de tu Frontend
    const parts = content
      .map((block) => {
        if (block.type === "image" || block.type === "document") {
          if (!block.source?.media_type || !block.source?.data) return null;
          return {
            inline_data: {
              mime_type: block.source.media_type,
              data: block.source.data,
            },
          };
        }
        if (block.type === "text" && block.text) {
          return { text: block.text };
        }
        return null;
      })
      .filter(Boolean);

    if (parts.length === 0) {
      return res.status(400).json({ error: "No se enviaron partes válidas en 'content'." });
    }

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            maxOutputTokens: 2000,
          },
        }),
      }
    );

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      return res.status(geminiResponse.status).json(geminiData);
    }

    const text =
      geminiData?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n") || "";

    // Mantenemos la estructura JSON exacta que tu frontend espera
    return res.status(200).json({ content: [{ type: "text", text }] });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Error interno del servidor" });
  }
}