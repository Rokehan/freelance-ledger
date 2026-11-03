// Reads receipt photos ON THIS DEVICE (Tesseract.js). The photo never leaves your phone/computer.
// First use downloads the reader (~10 MB, Japanese + English), then it's cached for offline use.
import { parseReceipt } from './receipt-parse.js';

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

/** Grey, contrasty, sensibly sized copy of the photo: OCR reads it much better. */
async function prep(blob) {
  const bmp = await createImageBitmap(blob);
  const target = 1700;
  const scale = Math.min(2.5, target / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
  const ctx = cv.getContext('2d');
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    g = Math.max(0, Math.min(255, (g - 128) * 1.45 + 140)); // lift paper, darken ink
    d[i] = d[i + 1] = d[i + 2] = g;
  }
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
  const canvas = await prep(blob);
  const { data } = await w.recognize(canvas);
  progressFn = null;
  return { ...parseReceipt(data.text), text: data.text };
}
