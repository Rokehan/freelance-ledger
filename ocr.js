// Reads receipt photos ON THIS DEVICE (Tesseract.js). The photo never leaves your phone/computer.
// First use downloads the reader (~10 MB, Japanese + English), then it's cached for offline use.
import { parseReceipt, paperBox } from './receipt-parse.js';

const SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
let scriptP = null, workerP = null, progressFn = null;

function loadScript() {
  scriptP ||= new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement('script');
    s.src = SRC; s.async = true;
    s.onload = () => res();
    s.onerror = () => { scriptP = null; rej(new Error('Couldn\'t load the receipt reader. Are you online? (Only needed the first time.)')); };
    document.head.appendChild(s);
  });
  return scriptP;
}

function worker() {
  workerP ||= window.Tesseract.createWorker(['jpn', 'eng'], 1, {
    logger: (m) => { if (progressFn && m && typeof m.progress === 'number') progressFn(m); },
  }).catch((e) => { workerP = null; throw e; });
  return workerP;
}

/**
 * Finds the receipt in the photo, crops to it, and makes a big grey high-contrast copy.
 * Thermal receipt print is tiny, so cropping + enlarging matters more than anything else.
 */
async function prep(blob) {
  const bmp = await createImageBitmap(blob);
  // 1) small copy to find the paper
  const sw = 400, sh = Math.max(1, Math.round(bmp.height * (sw / bmp.width)));
  const sc = document.createElement('canvas'); sc.width = sw; sc.height = sh;
  const sctx = sc.getContext('2d'); sctx.drawImage(bmp, 0, 0, sw, sh);
  const box = paperBox(sctx.getImageData(0, 0, sw, sh).data, sw, sh) || { x: 0, y: 0, w: 1, h: 1 };
  // 2) crop at full resolution, receipt width → ~1400px (capped so phones don't choke)
  const cx = box.x * bmp.width, cy = box.y * bmp.height, cw = box.w * bmp.width, ch = box.h * bmp.height;
  let scale = Math.min(3, 1400 / cw);
  if (cw * scale * ch * scale > 1400 * 5200) scale = Math.sqrt((1400 * 5200) / (cw * ch));
  const cv = document.createElement('canvas');
  cv.width = Math.round(cw * scale); cv.height = Math.round(ch * scale);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, cx, cy, cw, ch, 0, 0, cv.width, cv.height);
  // 3) grey + stretch contrast between the 3rd and 97th percentile (handles dim/yellow light)
  const img = ctx.getImageData(0, 0, cv.width, cv.height); const d = img.data;
  const hist = new Uint32Array(256); const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0; d[i] = g; hist[g]++; }
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.03) { lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.03) { hi = v; break; } }
  const k = 255 / Math.max(30, hi - lo);
  for (let i = 0; i < d.length; i += 4) { const g = Math.max(0, Math.min(255, (d[i] - lo) * k)); d[i] = d[i + 1] = d[i + 2] = g; }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/**
 * onStep(text) gets friendly progress messages.
 * Returns { amount, date, vendor, category, amountSure, text }.
 */
export async function readReceipt(blob, onStep = () => {}) {
  if (!blob || !blob.type?.startsWith('image/')) throw new Error('Auto-read works on photos (not PDFs)');
  onStep('Loading the receipt reader…');
  await loadScript();
  progressFn = (m) => {
    if (m.status?.includes('loading') || m.status?.includes('initializ')) onStep(`First time setup: downloading the reader… ${Math.round(m.progress * 100)}%`);
    else if (m.status?.includes('recogniz')) onStep(`Reading the receipt… ${Math.round(m.progress * 100)}%`);
  };
  const w = await worker();
  onStep('Finding the receipt in the photo…');
  const canvas = await prep(blob);
  // receipts are one column of lines: PSM 4 first, PSM 6 as a second opinion if no clear total
  await w.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' });
  let { data } = await w.recognize(canvas);
  let got = parseReceipt(data.text);
  if (!got.amountSure) {
    onStep('Having a second look…');
    await w.setParameters({ tessedit_pageseg_mode: '6' });
    const second = await w.recognize(canvas);
    const g2 = parseReceipt(second.data.text);
    const merged = parseReceipt(`${data.text}\n${second.data.text}`);
    got = g2.amountSure ? g2 : merged;
    data = { text: `${data.text}\n---\n${second.data.text}` };
  }
  progressFn = null;
  return { ...got, text: data.text };
}
