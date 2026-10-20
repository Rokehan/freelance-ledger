// Minimal PDF writer: one JPEG image per A4 page. Zero dependencies.
const A4 = [595.28, 841.89];

/** pages: [{ jpeg: Uint8Array, width, height }] -> Uint8Array (PDF bytes) */
export function jpegsToPdf(pages, title = 'Invoice') {
  const enc = new TextEncoder();
  const chunks = [];
  let length = 0;
  const offsets = [];
  const push = (b) => { const u = typeof b === 'string' ? enc.encode(b) : b; chunks.push(u); length += u.length; };
  const obj = (n, body) => { offsets[n] = length; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };

  const nPages = pages.length;
  // object numbers: 1 catalog, 2 pages, 3 info, then per page: page, content, image
  const pageNo = (i) => 4 + i * 3;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${nPages} /Kids [${pages.map((_, i) => `${pageNo(i)} 0 R`).join(' ')}] >>`));
  const safeTitle = String(title).replace(/[^\x20-\x7E]/g, '').replace(/[()\\]/g, '');
  obj(3, () => push(`<< /Title (${safeTitle}) /Producer (Freelance Ledger) >>`));
  pages.forEach((p, i) => {
    const n = pageNo(i);
    const content = `q ${A4[0]} 0 0 ${A4[1]} 0 0 cm /Im0 Do Q`;
    obj(n, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4[0]} ${A4[1]}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`));
    obj(n + 1, () => { push(`<< /Length ${content.length} >>\nstream\n`); push(content); push('\nendstream'); });
    obj(n + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg); push('\nendstream');
    });
  });
  const total = 4 + nPages * 3;
  const xref = length;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(x);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
