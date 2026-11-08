// Draws invoice ops onto a canvas and turns it into a PDF (browser only).
import { invoiceOps } from './layout.js?v=1.8.1';
import { jpegsToPdf } from './pdf.js?v=1.8.1';

const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic","YuGothic",Meiryo,system-ui,sans-serif';
const PT = 0.3528; // mm per pt

export function drawOps(ops, pxPerMm) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(210 * pxPerMm);
  canvas.height = Math.round(297 * pxPerMm);
  const ctx = canvas.getContext('2d');
  const S = pxPerMm;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'alphabetic';
  for (const o of ops) {
    if (o.op === 'rect') {
      if (o.fill) { ctx.fillStyle = o.fill; ctx.fillRect(o.x * S, o.y * S, o.w * S, o.h * S); }
      if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = Math.max(1, (o.lw || 0.2) * S); ctx.strokeRect(o.x * S, o.y * S, o.w * S, o.h * S); }
    } else if (o.op === 'line') {
      ctx.strokeStyle = o.color; ctx.lineWidth = Math.max(1, o.w * S);
      ctx.beginPath(); ctx.moveTo(o.x1 * S, o.y1 * S); ctx.lineTo(o.x2 * S, o.y2 * S); ctx.stroke();
    } else if (o.op === 'text') {
      let size = o.size * PT * S;
      ctx.font = `${o.bold ? 700 : 400} ${size}px ${FONT}`;
      if (o.maxW) {
        const w = ctx.measureText(o.text).width;
        if (w > o.maxW * S) { size *= (o.maxW * S) / w; ctx.font = `${o.bold ? 700 : 400} ${size}px ${FONT}`; }
      }
      ctx.fillStyle = o.color || '#1d1d1f';
      ctx.textAlign = o.align || 'left';
      ctx.fillText(o.text, o.x * S, o.y * S);
    }
  }
  return canvas;
}

const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));

/** Preview image (smaller) for showing in the app. */
export async function invoicePreviewUrl(inv, data) {
  const canvas = drawOps(invoiceOps(inv, data), 4.2);
  const blob = await toBlob(canvas, 'image/jpeg', 0.85);
  return URL.createObjectURL(blob);
}

export function invoiceFileName(inv, data) {
  const c = data.clients.find((x) => x.id === inv.clientId) || {};
  const clean = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '').slice(0, 24);
  const parts = [inv.number, clean(c.nameEn || c.nameJa), clean(inv.project)].filter(Boolean);
  return `${parts.join('_')}.pdf`;
}

/** Full-quality PDF as a File. */
export async function invoicePdf(inv, data) {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const canvas = drawOps(invoiceOps(inv, data), 10); // ~254 dpi, safe for phones
  const blob = await toBlob(canvas, 'image/jpeg', 0.9);
  const jpeg = new Uint8Array(await blob.arrayBuffer());
  const pdf = jpegsToPdf([{ jpeg, width: canvas.width, height: canvas.height }], `Invoice ${inv.number}`);
  return new File([pdf], invoiceFileName(inv, data), { type: 'application/pdf' });
}
