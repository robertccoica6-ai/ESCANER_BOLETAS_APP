// Usamos gemini-2.5-flash para la máxima velocidad y estabilidad.
// También puedes cambiarlo a "gemini-1.5-flash" si usas esa versión específica.
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
    const { content, stream = true } = req.body;

    if (!content || !Array.isArray(content) || content.length === 0) {
      return res.status(400).json({ error: "Falta el campo 'content' o está vacío." });
    }

    // 1. Mapeamos TODOS los elementos (múltiples textos y archivos)
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
      .filter(Boolean); // Elimina elementos nulos o mal estructurados

    if (parts.length === 0) {
      return res.status(400).json({ error: "No se encontraron partes válidas en 'content'." });
    }

    // 2. Si el cliente solicita streaming (por defecto activado para evitar 503)
    if (stream) {
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?key=${process.env.GEMINI_API_KEY}&alt=sse`,
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

      if (!geminiResponse.ok) {
        const errorData = await geminiResponse.json();
        return res.status(geminiResponse.status).json(errorData);
      }

      // Configuramos los headers para SSE (Streaming de respuesta)
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      // Transmitimos la respuesta directamente al cliente a medida que llega
      const reader = geminiResponse.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
      }

      return res.end();
    }

    // 3. Petición estándar sin Streaming (Modo tradicional)
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

    return res.status(200).json({ content: [{ type: "text", text }] });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Error interno del servidor" });
  }
}