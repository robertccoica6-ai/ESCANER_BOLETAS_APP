import React, { useState, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  Loader2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Receipt,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Escáner de Boletas y Facturas — MVP
// Sube fotos/PDFs de comprobantes, Claude extrae los campos, tú exportas a Excel.
// ---------------------------------------------------------------------------

const CATEGORIES = [
  "Alimentación",
  "Transporte",
  "Oficina",
  "Servicios",
  "Suministros",
  "Otros",
];

const FIELD_DEFS = [
  { key: "proveedor", label: "Proveedor" },
  { key: "ruc", label: "RUC" },
  { key: "numero", label: "N° Comprobante" },
  { key: "fecha", label: "Fecha" },
  { key: "subtotal", label: "Subtotal (S/)", numeric: true },
  { key: "igv", label: "IGV (S/)", numeric: true },
  { key: "total", label: "Total (S/)", numeric: true },
];

let rowIdCounter = 0;
const nextId = () => `row-${Date.now()}-${rowIdCounter++}`;

// Reads a File as a full data URI (e.g. "data:image/png;base64,....")
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

function fileToBase64(file) {
  return readAsDataUrl(file).then((dataUrl) => dataUrl.split(",")[1]);
}

// Downscales an image for a smaller, faster upload. If the canvas pipeline
// can't decode the file for any reason (unusual encodings, sandboxed
// environments, etc.), falls back to sending the original bytes untouched —
// so a failed resize never blocks the scan.
async function prepareImage(file, maxDim = 1400) {
  const originalDataUrl = await readAsDataUrl(file);
  const originalMediaType = file.type || "image/jpeg";

  const resized = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const outDataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ dataUrl: outDataUrl, mediaType: "image/jpeg" });
      } catch {
        resolve(null); // canvas step failed — fall back below
      }
    };
    img.onerror = () => resolve(null); // decode failed — fall back below
    img.src = originalDataUrl;
  });

  const chosen = resized || { dataUrl: originalDataUrl, mediaType: originalMediaType };
  return {
    base64: chosen.dataUrl.split(",")[1],
    mediaType: chosen.mediaType,
    previewUrl: chosen.dataUrl,
  };
}

async function extractReceiptData({ base64, mediaType, blockType }) {
  const contentBlock = {
    type: blockType === "document" ? "document" : "image",
    source: {
      media_type: blockType === "document" ? "application/pdf" : mediaType,
      data: base64,
    },
  };

  const prompt = `Eres un asistente contable. Observa esta boleta o factura peruana y extrae sus datos.
Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin markdown, con esta forma exacta:
{"proveedor": string, "ruc": string, "numero": string, "fecha": "DD/MM/AAAA", "subtotal": number, "igv": number, "total": number, "categoria": una de ${JSON.stringify(CATEGORIES)}}
Si algún campo no aparece en el documento, usa "" para texto o 0 para números. No inventes datos. No incluyas el símbolo S/ en los números, solo el valor numérico.`;

  const response = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: [contentBlock, { type: "text", text: prompt }],
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    // Extrae el mensaje de error de Gemini o Vercel sin mostrar [object Object]
    const errorMsg = data?.error?.message || data?.error || `Error ${response.status} en la API`;
    throw new Error(typeof errorMsg === "object" ? JSON.stringify(errorMsg) : errorMsg);
  }

  const text = data?.content?.[0]?.text || "";
  if (!text) throw new Error("No se recibió texto de la IA");

  const cleaned = text.replace(/```json|```/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("La IA no devolvió un JSON legible");

  return JSON.parse(jsonMatch[0]);
}


function Stamp() {
  return (
    <div className="stamp">
      <svg viewBox="0 0 80 80" width="52" height="52">
        <circle cx="40" cy="40" r="36" fill="none" stroke="var(--stamp-blue)" strokeWidth="2.5" strokeDasharray="4 3" />
        <circle cx="40" cy="40" r="28" fill="none" stroke="var(--stamp-blue)" strokeWidth="1.5" />
        <text x="40" y="36" textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--stamp-blue)" fontFamily="var(--font-mono)">
          PROCESADO
        </text>
        <text x="40" y="50" textAnchor="middle" fontSize="7" fill="var(--stamp-blue)" fontFamily="var(--font-mono)">
          ✓ IA
        </text>
      </svg>
    </div>
  );
}

export default function ReceiptScanner() {
  const [rows, setRows] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const emptyData = {
    proveedor: "",
    ruc: "",
    numero: "",
    fecha: "",
    subtotal: 0,
    igv: 0,
    total: 0,
    categoria: "Otros",
  };

  const runExtraction = useCallback((rowId, payload) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, status: "loading", error: null } : r)));
    extractReceiptData(payload)
      .then((data) => {
        setRows((prev) =>
          prev.map((r) => (r.id === rowId ? { ...r, status: "done", data: { ...r.data, ...data } } : r))
        );
      })
      .catch((err) => {
        setRows((prev) =>
          prev.map((r) =>
            r.id === rowId ? { ...r, status: "error", error: err.message || "No se pudo leer con la IA" } : r
          )
        );
      });
  }, []);

  const handleFiles = useCallback(
    (fileList) => {
      const files = Array.from(fileList).filter(
        (f) => f.type.startsWith("image/") || f.type === "application/pdf"
      );
      if (files.length === 0) return;

      const newRows = files.map((file) => ({
        id: nextId(),
        file,
        previewUrl: null,
        base64: null,
        mediaType: null,
        blockType: file.type === "application/pdf" ? "document" : "image",
        status: "preparing",
        error: null,
        data: { ...emptyData },
      }));

      setRows((prev) => [...newRows, ...prev]);

      newRows.forEach(async (row) => {
        try {
          let prepared;
          if (row.blockType === "document") {
            const base64 = await fileToBase64(row.file);
            prepared = { base64, mediaType: "application/pdf", previewUrl: null };
          } else {
            prepared = await prepareImage(row.file);
          }
          setRows((prev) =>
            prev.map((r) =>
              r.id === row.id
                ? { ...r, base64: prepared.base64, mediaType: prepared.mediaType, previewUrl: prepared.previewUrl }
                : r
            )
          );
          runExtraction(row.id, { base64: prepared.base64, mediaType: prepared.mediaType, blockType: row.blockType });
        } catch (err) {
          setRows((prev) =>
            prev.map((r) =>
              r.id === row.id
                ? { ...r, status: "error", error: err.message || "No se pudo leer el archivo" }
                : r
            )
          );
        }
      });
    },
    [runExtraction]
  );

  const updateField = (id, key, value) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, data: { ...r.data, [key]: value } } : r))
    );
  };

  const removeRow = (id) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const retryRow = async (id) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;

    if (row.base64) {
      runExtraction(id, { base64: row.base64, mediaType: row.mediaType, blockType: row.blockType });
      return;
    }

    // Preparation itself failed last time — try reading the file again from scratch.
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "preparing", error: null } : r)));
    try {
      let prepared;
      if (row.blockType === "document") {
        const base64 = await fileToBase64(row.file);
        prepared = { base64, mediaType: "application/pdf", previewUrl: null };
      } else {
        prepared = await prepareImage(row.file);
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, base64: prepared.base64, mediaType: prepared.mediaType, previewUrl: prepared.previewUrl }
            : r
        )
      );
      runExtraction(id, { base64: prepared.base64, mediaType: prepared.mediaType, blockType: row.blockType });
    } catch (err) {
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: "error", error: err.message || "No se pudo leer el archivo" } : r))
      );
    }
  };

  const totals = rows.reduce(
    (acc, r) => {
      if (r.status !== "done") return acc;
      acc.count += 1;
      acc.subtotal += Number(r.data.subtotal) || 0;
      acc.igv += Number(r.data.igv) || 0;
      acc.total += Number(r.data.total) || 0;
      return acc;
    },
    { count: 0, subtotal: 0, igv: 0, total: 0 }
  );

  const exportToExcel = () => {
    const done = rows.filter((r) => r.status === "done");
    if (done.length === 0) return;

    const sheetData = done.map((r) => ({
      Proveedor: r.data.proveedor,
      RUC: r.data.ruc,
      "N° Comprobante": r.data.numero,
      Fecha: r.data.fecha,
      Categoría: r.data.categoria,
      "Subtotal (S/)": Number(r.data.subtotal) || 0,
      "IGV (S/)": Number(r.data.igv) || 0,
      "Total (S/)": Number(r.data.total) || 0,
    }));

    sheetData.push({
      Proveedor: "",
      RUC: "",
      "N° Comprobante": "",
      Fecha: "",
      Categoría: "TOTAL",
      "Subtotal (S/)": totals.subtotal,
      "IGV (S/)": totals.igv,
      "Total (S/)": totals.total,
    });

    const ws = XLSX.utils.json_to_sheet(sheetData);
    ws["!cols"] = [
      { wch: 26 }, { wch: 13 }, { wch: 16 }, { wch: 12 },
      { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Boletas");
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `boletas_${today}.xlsx`);
  };

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

        :root {
          --paper: #F5F3EC;
          --paper-raised: #FBFAF6;
          --ledger-line: #D3DDCB;
          --ink: #232D26;
          --ink-soft: #6B7568;
          --stamp-blue: #1E5A8C;
          --stamp-green: #2F6B4F;
          --stamp-red: #B23A2E;
          --brass: #9C7A2E;
          --font-display: 'Fraunces', serif;
          --font-body: 'IBM Plex Sans', sans-serif;
          --font-mono: 'IBM Plex Mono', monospace;
        }

        .app {
          font-family: var(--font-body);
          background: var(--paper);
          color: var(--ink);
          min-height: 100%;
          padding: 28px 20px 60px;
          background-image:
            linear-gradient(var(--ledger-line) 1px, transparent 1px);
          background-size: 100% 42px;
          background-attachment: local;
        }

        .header {
          max-width: 980px;
          margin: 0 auto 24px;
          display: flex;
          flex-wrap: wrap;
          align-items: flex-end;
          justify-content: space-between;
          gap: 16px;
          border-bottom: 2px solid var(--ink);
          padding-bottom: 14px;
        }
        .header h1 {
          font-family: var(--font-display);
          font-size: 30px;
          font-weight: 600;
          letter-spacing: -0.01em;
          margin: 0 0 4px;
        }
        .header p {
          margin: 0;
          color: var(--ink-soft);
          font-size: 14px;
        }
        .eyebrow {
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--brass);
          margin: 0 0 6px;
        }

        .export-btn {
          font-family: var(--font-mono);
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.03em;
          background: var(--stamp-green);
          color: var(--paper-raised);
          border: none;
          border-radius: 3px;
          padding: 11px 18px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: transform 0.12s ease, box-shadow 0.12s ease;
          box-shadow: 0 2px 0 rgba(0,0,0,0.15);
        }
        .export-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 3px 0 rgba(0,0,0,0.18); }
        .export-btn:active:not(:disabled) { transform: translateY(1px); box-shadow: 0 1px 0 rgba(0,0,0,0.15); }
        .export-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .dropzone {
          max-width: 980px;
          margin: 0 auto 28px;
          border: 2px dashed var(--ink-soft);
          border-radius: 6px;
          background: var(--paper-raised);
          padding: 28px 20px;
          text-align: center;
          cursor: pointer;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .dropzone.drag { border-color: var(--stamp-blue); background: #EEF3F0; }
        .dropzone svg { color: var(--stamp-blue); margin-bottom: 8px; }
        .dropzone .main-txt { font-weight: 600; font-size: 15px; margin: 0 0 4px; }
        .dropzone .sub-txt { font-size: 12.5px; color: var(--ink-soft); margin: 0; }

        .summary {
          max-width: 980px;
          margin: 0 auto 20px;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        .summary-item {
          background: var(--paper-raised);
          border: 1px solid var(--ledger-line);
          border-radius: 4px;
          padding: 10px 16px;
          min-width: 120px;
        }
        .summary-item .label {
          font-family: var(--font-mono);
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--ink-soft);
          margin: 0 0 2px;
        }
        .summary-item .value {
          font-family: var(--font-mono);
          font-size: 18px;
          font-weight: 600;
          color: var(--ink);
        }

        .rows {
          max-width: 980px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .empty-state {
          max-width: 980px;
          margin: 40px auto;
          text-align: center;
          color: var(--ink-soft);
        }
        .empty-state svg { color: var(--ledger-line); margin-bottom: 10px; }

        .row-card {
          background: var(--paper-raised);
          border: 1px solid var(--ledger-line);
          border-left: 3px solid var(--ink);
          border-radius: 4px;
          padding: 14px 16px;
          display: flex;
          gap: 14px;
          align-items: flex-start;
          position: relative;
        }
        .row-card.error { border-left-color: var(--stamp-red); }
        .row-card.loading, .row-card.preparing { border-left-color: var(--brass); }

        .thumb {
          width: 56px;
          height: 56px;
          border-radius: 4px;
          object-fit: cover;
          border: 1px solid var(--ledger-line);
          flex-shrink: 0;
          background: #E9E7DD;
        }
        .thumb-placeholder {
          width: 56px;
          height: 56px;
          border-radius: 4px;
          border: 1px solid var(--ledger-line);
          flex-shrink: 0;
          background: #E9E7DD;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--ink-soft);
          font-family: var(--font-mono);
          font-size: 10px;
        }

        .row-body { flex: 1; min-width: 0; }

        .row-status {
          display: flex;
          align-items: center;
          gap: 7px;
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--ink-soft);
          margin-bottom: 8px;
        }
        .row-status.loading, .row-status.preparing { color: var(--brass); }
        .row-status.error { color: var(--stamp-red); }
        .row-status.done { color: var(--stamp-green); }
        .retry-link {
          font-family: var(--font-mono);
          font-size: 11px;
          text-decoration: underline;
          color: var(--stamp-red);
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
        }

        .field-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 8px 12px;
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .field label {
          font-family: var(--font-mono);
          font-size: 9.5px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--ink-soft);
        }
        .field input, .field select {
          font-family: var(--font-mono);
          font-size: 13px;
          border: none;
          border-bottom: 1px solid var(--ledger-line);
          background: transparent;
          padding: 3px 2px;
          color: var(--ink);
          width: 100%;
        }
        .field input:focus, .field select:focus {
          outline: none;
          border-bottom: 1px solid var(--stamp-blue);
        }

        .row-actions {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }
        .del-btn {
          background: none;
          border: none;
          color: var(--ink-soft);
          cursor: pointer;
          padding: 4px;
          border-radius: 3px;
          transition: color 0.12s ease, background 0.12s ease;
        }
        .del-btn:hover { color: var(--stamp-red); background: rgba(178,58,46,0.08); }

        .stamp {
          animation: stampIn 0.35s cubic-bezier(0.2, 1.4, 0.5, 1);
          transform: rotate(-8deg);
        }
        @keyframes stampIn {
          0% { opacity: 0; transform: rotate(-8deg) scale(1.6); }
          100% { opacity: 1; transform: rotate(-8deg) scale(1); }
        }

        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
.footer {
  max-width: 980px;
  margin: 40px auto 0;
  padding-top: 16px;
  border-top: 1px solid var(--ledger-line);
  text-align: center;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--ink-soft);
  letter-spacing: 0.02em;
}
.footer strong {
  color: var(--ink);
  font-weight: 600;
}
        
   @media (max-width: 560px) {
          .row-card { flex-wrap: wrap; }
        }
      `}</style>

      <div className="header">
        <div>
          <p className="eyebrow">Cuaderno de comprobantes</p>
          <h1>Escáner de Boletas &amp; Facturas</h1>
          <p>Sube fotos o PDFs — la IA lee cada campo. Tú revisas y exportas.</p>
        </div>
        <button className="export-btn" onClick={exportToExcel} disabled={totals.count === 0}>
          <FileSpreadsheet size={16} />
          Exportar a Excel ({totals.count})
        </button>
      </div>

      <div
        className={`dropzone ${dragOver ? "drag" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <Upload size={26} />
        <p className="main-txt">Arrastra boletas aquí, o haz clic para elegir</p>
        <p className="sub-txt">JPG, PNG o PDF · puedes subir varias a la vez</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          hidden
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {rows.length > 0 && (
        <div className="summary">
          <div className="summary-item">
            <p className="label">Comprobantes</p>
            <p className="value">{totals.count}</p>
          </div>
          <div className="summary-item">
            <p className="label">Subtotal</p>
            <p className="value">S/ {totals.subtotal.toFixed(2)}</p>
          </div>
          <div className="summary-item">
            <p className="label">IGV</p>
            <p className="value">S/ {totals.igv.toFixed(2)}</p>
          </div>
          <div className="summary-item">
            <p className="label">Total</p>
            <p className="value">S/ {totals.total.toFixed(2)}</p>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty-state">
          <Receipt size={36} />
          <p>Todavía no subiste ningún comprobante.</p>
        </div>
      ) : (
        <div className="rows">
          {rows.map((row) => (
            <div key={row.id} className={`row-card ${row.status}`}>
              {row.previewUrl ? (
                <img className="thumb" src={row.previewUrl} alt="comprobante" />
              ) : (
                <div className="thumb-placeholder">PDF</div>
              )}

              <div className="row-body">
                <div className={`row-status ${row.status}`}>
                  {row.status === "preparing" && (
                    <>
                      <Loader2 size={13} className="spin" />
                      Procesando imagen…
                    </>
                  )}
                  {row.status === "loading" && (
                    <>
                      <Loader2 size={13} className="spin" />
                      Leyendo comprobante con IA…
                    </>
                  )}
                  {row.status === "error" && (
                    <>
                      <AlertTriangle size={13} />
                      {row.error || "No se pudo leer"}
                      <button className="retry-link" onClick={() => retryRow(row.id)}>Reintentar</button>
                    </>
                  )}
                  {row.status === "done" && (
                    <>
                      <CheckCircle2 size={13} />
                      Datos extraídos — revisa y corrige si hace falta
                    </>
                  )}
                </div>

                {row.status !== "loading" && row.status !== "preparing" && (
                  <div className="field-grid">
                    {FIELD_DEFS.map((f) => (
                      <div className="field" key={f.key}>
                        <label>{f.label}</label>
                        <input
                          type={f.numeric ? "number" : "text"}
                          step={f.numeric ? "0.01" : undefined}
                          value={row.data[f.key]}
                          onChange={(e) => updateField(row.id, f.key, e.target.value)}
                        />
                      </div>
                    ))}
                    <div className="field">
                      <label>Categoría</label>
                      <select
                        value={row.data.categoria}
                        onChange={(e) => updateField(row.id, "categoria", e.target.value)}
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="row-actions">
                {row.status === "done" && <Stamp />}
                <button className="del-btn" onClick={() => removeRow(row.id)} title="Eliminar">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
            )}

      <footer className="footer">
        Desarrollado por <strong>Robert Ccoicca Janampa</strong> — Ingeniero de Sistemas
      </footer>
    </div>
  );
}
