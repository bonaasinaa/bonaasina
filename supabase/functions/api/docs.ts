// Dokumen PDF Bonaasina: kontrak sewa, kuitansi, dan kartu penghuni (+ QR untuk cek keaslian).
// Memakai pdf-lib dengan huruf bawaan PDF (Helvetica/Times), jadi tidak perlu berkas font.
import { PDFDocument, StandardFonts, rgb, degrees, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, type PDFFont, type PDFPage, type PDFImage } from 'npm:pdf-lib@1.17.1';
import QRCode from 'npm:qrcode@1.5.4';

const INK = rgb(0.141, 0.086, 0.059);      // #24160F
const RED = rgb(0.557, 0.106, 0.106);      // #8E1B1B
const IJUK = rgb(0.42, 0.294, 0.227);      // #6B4B3A
const CREAM = rgb(0.969, 0.929, 0.89);     // #F7EDE3
const LINE = rgb(0.85, 0.8, 0.76);
const WHITE = rgb(1, 1, 1);

const SITE = (Deno.env.get('SITE_URL') || 'https://bonaasina.my.id').replace(/\/$/, '');

// ---------------------------------------------------------------- teks
// Huruf bawaan PDF hanya mengenal set WinAnsi (Latin-1 + beberapa tanda baca). Karakter lain diganti.
const CP1252 = new Set([0x20ac, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x17d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x17e, 0x178]);
export function win(s: unknown) {
  return String(s ?? '').replace(/\r/g, '').replace(/\t/g, '  ').replace(/[‐‑−]/g, '-').replace(/×/g, 'x')
    .replace(/[^\n]/gu, (c) => { const n = c.codePointAt(0)!; return (n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff) || CP1252.has(n) ? c : '?'; });
}
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const out: string[] = [];
  for (const para of win(text).split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    const indent = (para.match(/^\s*/)?.[0] || '');
    let line = '';
    for (const word of para.trim().split(/\s+/)) {
      const test = line ? `${line} ${word}` : indent + word;
      if (font.widthOfTextAtSize(test, size) <= width) { line = test; continue; }
      if (line) out.push(line);
      // Kata yang lebih panjang dari satu baris dipotong paksa.
      let w = word; line = '';
      while (font.widthOfTextAtSize(indent + w, size) > width && w.length > 1) {
        let k = w.length; while (k > 1 && font.widthOfTextAtSize(indent + w.slice(0, k), size) > width) k--;
        out.push(indent + w.slice(0, k)); w = w.slice(k);
      }
      line = indent + w;
    }
    out.push(line);
  }
  return out;
}

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export function tanggal(s?: string | null) {
  if (!s) return '-';
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
}
export function waktuWIB(iso?: string | null) {
  if (!iso) return '-';
  const d = new Date(new Date(iso).getTime() + 7 * 3600e3);
  return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, '0')}.${String(d.getUTCMinutes()).padStart(2, '0')} WIB`;
}
export const rupiah = (n: number) => 'Rp' + Number(n || 0).toLocaleString('id-ID');

// Angka → kata (Bahasa Indonesia), untuk kuitansi.
const SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
export function terbilang(n: number): string {
  n = Math.floor(Math.abs(Number(n) || 0));
  const f = (x: number): string => {
    if (x < 12) return SATUAN[x];
    if (x < 20) return `${f(x - 10)} belas`;
    if (x < 100) return `${f(Math.floor(x / 10))} puluh ${f(x % 10)}`;
    if (x < 200) return `seratus ${f(x - 100)}`;
    if (x < 1000) return `${f(Math.floor(x / 100))} ratus ${f(x % 100)}`;
    if (x < 2000) return `seribu ${f(x - 1000)}`;
    if (x < 1e6) return `${f(Math.floor(x / 1000))} ribu ${f(x % 1000)}`;
    if (x < 1e9) return `${f(Math.floor(x / 1e6))} juta ${f(x % 1e6)}`;
    if (x < 1e12) return `${f(Math.floor(x / 1e9))} miliar ${f(x % 1e9)}`;
    return `${f(Math.floor(x / 1e12))} triliun ${f(x % 1e12)}`;
  };
  const s = (n === 0 ? 'nol' : f(n)).replace(/\s+/g, ' ').trim();
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} rupiah`;
}

// ---------------------------------------------------------------- QR
export function qrMatrix(text: string) {
  const q = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size: number = q.modules.size; const data: Uint8Array = q.modules.data;
  return { size, on: (r: number, c: number) => !!data[r * size + c] };
}
export function qrSvg(text: string, px = 160) {
  const m = qrMatrix(text); const quiet = 2; const n = m.size + quiet * 2;
  let d = '';
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.on(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="Kode QR"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#24160F"/></svg>`;
}
function drawQr(page: PDFPage, text: string, x: number, y: number, size: number) {
  const m = qrMatrix(text); const quiet = 1; const cell = size / (m.size + quiet * 2);
  page.drawRectangle({ x, y, width: size, height: size, color: WHITE });
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) {
    if (m.on(r, c)) page.drawRectangle({ x: x + (c + quiet) * cell, y: y + size - (r + quiet + 1) * cell, width: cell + 0.05, height: cell + 0.05, color: INK });
  }
}

// ---------------------------------------------------------------- gambar (logo dari website, disimpan di memori)
const imgCache = new Map<string, Uint8Array | null>();
async function siteImage(path: string) {
  if (imgCache.has(path)) return imgCache.get(path)!;
  try {
    const res = await fetch(SITE + path, { signal: AbortSignal.timeout(4000) });
    const buf = res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    imgCache.set(path, buf); return buf;
  } catch { imgCache.set(path, null); return null; }
}
async function embedAny(doc: PDFDocument, bytes: Uint8Array | null): Promise<PDFImage | null> {
  if (!bytes || bytes.length < 8) return null;
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await doc.embedPng(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await doc.embedJpg(bytes);
  } catch { /* format tidak didukung */ }
  return null;
}

// ---------------------------------------------------------------- KONTRAK (A4)
export type ContractDoc = {
  number: string; body: string; status: string; ownerName: string; tenantName: string; propertyName: string; roomCode: string;
  startDate: string; endDate: string; acceptedAt?: string | null; acceptedName?: string | null; acceptedIp?: string | null; acceptedDevice?: string | null; createdAt?: string | null;
};
export async function contractPdf(c: ContractDoc) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Perjanjian Sewa ${c.number}`); doc.setAuthor('Bonaasina'); doc.setSubject(`${c.tenantName}, ${c.propertyName} ${c.roomCode}`);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedAny(doc, await siteImage('/assets/img/logo-bonaasina.png'));
  const W = 595.28, H = 841.89, M = 60, TW = W - M * 2;
  const pages: PDFPage[] = [];
  let page!: PDFPage; let y = 0;
  const draft = c.status !== 'disetujui';

  const newPage = () => {
    page = doc.addPage([W, H]); pages.push(page); y = H - M;
  };
  const ensure = (h: number) => { if (y - h < M + 30) newPage(); };
  newPage();

  // Kepala
  if (logo) { const s = 64 / logo.width; page.drawImage(logo, { x: M, y: y - logo.height * s + 6, width: 64, height: logo.height * s }); }
  page.drawText('BONAASINA', { x: M + 78, y: y - 14, size: 15, font: sansBold, color: INK });
  page.drawText(win(`${c.propertyName}  |  ${SITE.replace(/^https?:\/\//, '')}`), { x: M + 78, y: y - 30, size: 9.5, font: sans, color: IJUK });
  y -= 70;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: RED });
  y -= 30;
  const title = 'PERJANJIAN SEWA KAMAR KOS';
  page.drawText(title, { x: (W - serifBold.widthOfTextAtSize(title, 16)) / 2, y, size: 16, font: serifBold, color: INK });
  y -= 18;
  const no = win(`Nomor: ${c.number}`);
  page.drawText(no, { x: (W - serif.widthOfTextAtSize(no, 11)) / 2, y, size: 11, font: serif, color: IJUK });
  y -= 26;

  // Isi: baris "## Judul" ditebalkan, sisanya paragraf biasa.
  const size = 11, lh = 15.5;
  for (const raw of win(c.body).split('\n')) {
    if (/^##\s+/.test(raw)) {
      ensure(lh * 3); y -= 6;
      page.drawText(raw.replace(/^##\s+/, ''), { x: M, y, size: 11.5, font: serifBold, color: INK }); y -= lh + 2; continue;
    }
    for (const line of wrap(raw, serif, size, TW)) {
      ensure(lh);
      if (line) page.drawText(line, { x: M, y, size, font: serif, color: INK });
      y -= line ? lh : lh * 0.6;
    }
  }

  // Tanda persetujuan
  ensure(150); y -= 20;
  const colW = (TW - 30) / 2; const x2 = M + colW + 30;
  page.drawText('Pihak Pertama (Pemilik/Pengelola)', { x: M, y, size: 10, font: sansBold, color: IJUK });
  page.drawText('Pihak Kedua (Penghuni)', { x: x2, y, size: 10, font: sansBold, color: IJUK });
  y -= 16;
  const box = (x: number, lines: string[], tone: 'ok' | 'wait') => {
    const h = 74;
    page.drawRectangle({ x, y: y - h, width: colW, height: h, borderColor: tone === 'ok' ? rgb(0.18, 0.42, 0.25) : LINE, borderWidth: 1, color: tone === 'ok' ? rgb(0.95, 0.98, 0.95) : rgb(0.99, 0.98, 0.97) });
    let yy = y - 16;
    lines.forEach((l, i) => { for (const w of wrap(l, i === 0 ? sansBold : sans, i === 0 ? 10.5 : 8.5, colW - 20)) { page.drawText(w, { x: x + 10, y: yy, size: i === 0 ? 10.5 : 8.5, font: i === 0 ? sansBold : sans, color: i === 0 ? INK : IJUK }); yy -= i === 0 ? 14 : 11; } });
    return h;
  };
  const h1 = box(M, [c.ownerName || 'Pengelola Bonaasina', `Kontrak diterbitkan melalui sistem Bonaasina`, c.createdAt ? waktuWIB(c.createdAt) : ''].filter(Boolean), 'ok');
  box(x2, c.acceptedAt
    ? [c.acceptedName || c.tenantName, `Disetujui secara elektronik ${waktuWIB(c.acceptedAt)}`, `${c.acceptedDevice || ''}${c.acceptedIp ? `, IP ${c.acceptedIp}` : ''}`.replace(/^, /, '')]
    : [c.tenantName, 'Belum disetujui'], c.acceptedAt ? 'ok' : 'wait');
  y -= h1 + 18;

  // Kaki setiap halaman
  const total = pages.length;
  pages.forEach((p, i) => {
    if (draft) {
      // Tanda air diagonal di tengah halaman, digambar terakhir supaya tidak tertutup isi.
      const t = 'DRAF - BELUM DISETUJUI', fs = 40, a = 35 * Math.PI / 180, tw = sansBold.widthOfTextAtSize(t, fs);
      p.drawText(t, { x: W / 2 - Math.cos(a) * tw / 2 + Math.sin(a) * fs / 3, y: H / 2 - Math.sin(a) * tw / 2 - Math.cos(a) * fs / 3, size: fs, font: sansBold, color: RED, rotate: degrees(35), opacity: 0.12 });
    }
    const t = win(`${c.number}  |  ${c.tenantName}, kamar ${c.roomCode}  |  Halaman ${i + 1} dari ${total}`);
    p.drawLine({ start: { x: M, y: 44 }, end: { x: W - M, y: 44 }, thickness: 0.5, color: LINE });
    p.drawText(t, { x: M, y: 30, size: 8, font: sans, color: IJUK });
  });
  return await doc.save();
}

// ---------------------------------------------------------------- KUITANSI (A5 mendatar)
export type ReceiptDoc = {
  receiptNo: string; issuedAt: string; tenantName: string; amount: number; periodLabel: string; propertyName: string; roomCode: string;
  method: string; paidAt: string; ownerName: string; invoiceAmount: number; verifyCode?: string;
};
const METODE: Record<string, string> = { transfer: 'Transfer bank', qris: 'QRIS', tunai: 'Tunai', lainnya: 'Lainnya' };
export async function receiptPdf(r: ReceiptDoc) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Kuitansi ${r.receiptNo}`); doc.setAuthor('Bonaasina');
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const logo = await embedAny(doc, await siteImage('/assets/img/logo-bonaasina.png'));
  const W = 595.28, H = 419.53, M = 36;
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 0.985, 0.965) });
  page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: RED });
  // kepala
  let y = H - M - 10;
  if (logo) { const s = 48 / logo.width; page.drawImage(logo, { x: M, y: y - logo.height * s + 8, width: 48, height: logo.height * s }); }
  page.drawText('BONAASINA', { x: M + 60, y: y - 6, size: 13, font: bold, color: INK });
  page.drawText(win(r.propertyName), { x: M + 60, y: y - 20, size: 9, font: sans, color: IJUK });
  page.drawText('KUITANSI', { x: W - M - serifBold.widthOfTextAtSize('KUITANSI', 24), y: y - 8, size: 24, font: serifBold, color: INK });
  const no = win(`No. ${r.receiptNo}`);
  page.drawText(no, { x: W - M - sans.widthOfTextAtSize(no, 9.5), y: y - 24, size: 9.5, font: sans, color: IJUK });
  y -= 46;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: LINE });
  y -= 24;

  const labelW = 130; const valX = M + labelW;
  const row = (label: string, value: string, font = sans, size = 11) => {
    page.drawText(label, { x: M, y, size: 9.5, font: sans, color: IJUK });
    const lines = wrap(value, font, size, W - M - valX - 150);
    lines.forEach((l, i) => page.drawText(l, { x: valX, y: y - i * 14, size, font, color: INK }));
    y -= Math.max(1, lines.length) * 14 + 8;
  };
  row('Telah terima dari', r.tenantName, bold, 12);
  row('Uang sejumlah', terbilang(r.amount), italic, 10.5);
  row('Untuk pembayaran', `Sewa ${r.periodLabel}`);
  row('Kos & kamar', `${r.propertyName}, kamar ${r.roomCode}`);
  row('Tanggal bayar', `${tanggal(r.paidAt)} (${METODE[r.method] || r.method || '-'})`);
  if (r.amount !== r.invoiceAmount) row('Catatan', `Tagihan ${rupiah(r.invoiceAmount)}, dibayar ${rupiah(r.amount)}`);

  // kotak jumlah
  const amt = win(rupiah(r.amount));
  const boxW = Math.max(150, bold.widthOfTextAtSize(amt, 20) + 32);
  page.drawRectangle({ x: M, y: 46, width: boxW, height: 40, color: CREAM, borderColor: INK, borderWidth: 1.2 });
  page.drawText(amt, { x: M + 16, y: 60, size: 20, font: bold, color: INK });

  // tanda terima
  const sx = W - M - 190;
  page.drawText(win(`${tanggal(r.issuedAt.slice(0, 10))}`), { x: sx, y: 118, size: 10, font: sans, color: INK });
  page.drawText('Pengelola,', { x: sx, y: 104, size: 10, font: sans, color: IJUK });
  page.drawText('LUNAS', { x: sx + 4, y: 74, size: 18, font: bold, color: rgb(0.18, 0.42, 0.25), rotate: degrees(-8), opacity: 0.85 });
  page.drawText(win(r.ownerName || 'Pengelola Bonaasina'), { x: sx, y: 52, size: 10.5, font: bold, color: INK });
  page.drawText(win(`Diverifikasi ${waktuWIB(r.issuedAt)}`), { x: sx, y: 40, size: 7.5, font: sans, color: IJUK });
  if (r.verifyCode) drawQr(page, `${SITE}/cek/?k=${r.verifyCode}`, W - M - 56, 128, 56);

  page.drawText('Kuitansi ini dibuat oleh sistem Bonaasina setelah pembayaran diperiksa dan diterima pengelola.', { x: M, y: 22, size: 7.5, font: sans, color: IJUK });
  return await doc.save();
}

// ---------------------------------------------------------------- KARTU PENGHUNI (ukuran kartu 85,6 x 54 mm)
export type CardDoc = {
  name: string; propertyName: string; roomCode: string; since: string; validUntil?: string | null; cardCode: string; photo?: Uint8Array | null; status: string;
};
export async function cardPdf(c: CardDoc) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Kartu Penghuni ${c.name}`); doc.setAuthor('Bonaasina');
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const mark = await embedAny(doc, await siteImage('/assets/img/mark.png'));
  const photo = await embedAny(doc, c.photo ?? null);
  const W = 242.65, H = 153.07; // 85,6 x 54 mm dalam poin
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 0.985, 0.965) });
  // pita atas
  page.drawRectangle({ x: 0, y: H - 30, width: W, height: 30, color: INK });
  page.drawRectangle({ x: 0, y: H - 33, width: W, height: 3, color: RED });
  if (mark) { const s = 18 / mark.height; page.drawRectangle({ x: 9, y: H - 26, width: mark.width * s + 6, height: 22, color: CREAM }); page.drawImage(mark, { x: 12, y: H - 24, width: mark.width * s, height: 18 }); }
  page.drawText('BONAASINA', { x: 48, y: H - 15, size: 9.5, font: bold, color: CREAM });
  page.drawText('KARTU PENGHUNI', { x: 48, y: H - 25, size: 6.5, font: sans, color: rgb(0.85, 0.78, 0.72) });
  const right = win(c.propertyName.toUpperCase());
  page.drawText(right, { x: W - 10 - bold.widthOfTextAtSize(right, 7.5), y: H - 19, size: 7.5, font: bold, color: CREAM });

  // foto
  const px = 10, py = 22, pw = 56, ph = 72;
  page.drawRectangle({ x: px, y: py, width: pw, height: ph, color: CREAM, borderColor: LINE, borderWidth: 0.8 });
  if (photo) {
    // Isi bingkai foto (cover): gambar diperbesar seperlunya lalu dipotong tepat di bingkai.
    const k = Math.max(pw / photo.width, ph / photo.height);
    const iw = photo.width * k, ih = photo.height * k;
    page.pushOperators(pushGraphicsState(), rectangle(px, py, pw, ph), clip(), endPath());
    page.drawImage(photo, { x: px + (pw - iw) / 2, y: py + (ph - ih) / 2, width: iw, height: ih });
    page.pushOperators(popGraphicsState());
    page.drawRectangle({ x: px, y: py, width: pw, height: ph, borderColor: LINE, borderWidth: 0.8 });
  } else {
    page.drawText('FOTO', { x: px + 15, y: py + 32, size: 9, font: bold, color: IJUK });
  }

  // data
  const tx = 76; let ty = H - 50;
  const nameLines = wrap(c.name, serifBold, 12, 108);
  nameLines.slice(0, 2).forEach((l) => { page.drawText(l, { x: tx, y: ty, size: 12, font: serifBold, color: INK }); ty -= 13; });
  ty -= 3;
  const field = (label: string, value: string) => {
    page.drawText(label, { x: tx, y: ty, size: 5.8, font: sans, color: IJUK });
    page.drawText(win(value), { x: tx, y: ty - 8.5, size: 8, font: bold, color: INK });
    ty -= 19;
  };
  field('KAMAR', `${c.roomCode}`);
  field('PENGHUNI SEJAK', tanggal(c.since));
  if (c.validUntil) field('KONTRAK S.D.', tanggal(c.validUntil));

  // QR & nomor kartu
  drawQr(page, `${SITE}/cek/?k=${c.cardCode}`, W - 58, 20, 48);
  const code = win(`No. ${c.cardCode.toUpperCase().slice(0, 4)}-${c.cardCode.toUpperCase().slice(4, 8)}`);
  page.drawText(code, { x: W - 58, y: 11, size: 5.8, font: sans, color: IJUK });
  if (c.status !== 'aktif') page.drawText('TIDAK AKTIF', { x: 80, y: 40, size: 20, font: bold, color: RED, rotate: degrees(18), opacity: 0.6 });
  page.drawText('Pindai QR untuk cek keaslian kartu', { x: px, y: 10, size: 5.5, font: sans, color: IJUK });
  return await doc.save();
}

// ---------------------------------------------------------------- templat kontrak bawaan
export const DEFAULT_CONTRACT_TEMPLATE = `Pada {tanggal_kontrak}, yang bertanda tangan di bawah ini:

1. {pemilik}, selaku pemilik/pengelola {kos}, selanjutnya disebut PIHAK PERTAMA.
2. {nama_penghuni}, nomor WhatsApp {telepon_penghuni}, asal {asal}, selanjutnya disebut PIHAK KEDUA.

Kedua pihak sepakat membuat perjanjian sewa kamar kos dengan ketentuan berikut.

## Pasal 1 - Objek Sewa
PIHAK PERTAMA menyewakan kamar {kamar} ({tipe_kamar}) di {kos}, {alamat_kos}, kepada PIHAK KEDUA untuk tempat tinggal pribadi.

## Pasal 2 - Jangka Waktu
Sewa berlaku sejak {mulai} sampai dengan {selesai}. Perpanjangan dibicarakan paling lambat 30 hari sebelum masa sewa berakhir dan dituangkan dalam perjanjian baru.

## Pasal 3 - Harga Sewa dan Pembayaran
1. Harga sewa sebesar {harga} per {siklus}.
2. Sewa dibayar paling lambat pada tanggal jatuh tempo yang tercantum di dashboard penghuni.
3. Pembayaran dilakukan melalui: {cara_bayar}. Bukti transfer diunggah di dashboard penghuni; kuitansi diterbitkan setelah pembayaran diperiksa PIHAK PERTAMA.

## Pasal 4 - Deposit
1. PIHAK KEDUA menyerahkan deposit sebesar {deposit}.
2. Deposit dikembalikan setelah PIHAK KEDUA keluar, dikurangi biaya perbaikan kerusakan di luar pemakaian wajar dan tunggakan yang belum dibayar, berdasarkan catatan kondisi kamar saat masuk dan saat keluar.

## Pasal 5 - Kewajiban PIHAK KEDUA
1. Menjaga kebersihan, keamanan, dan ketertiban kamar serta lingkungan kos.
2. Mematuhi aturan kos, termasuk:
{aturan}
3. Mengikuti jadwal piket kebersihan yang ditetapkan.
4. Melaporkan kerusakan melalui dashboard penghuni.
5. Tidak menyewakan ulang atau memindahtangankan kamar kepada pihak lain.

## Pasal 6 - Kewajiban PIHAK PERTAMA
1. Menyerahkan kamar dalam keadaan layak huni sesuai catatan kondisi kamar saat masuk.
2. Menangani perbaikan fasilitas yang rusak karena pemakaian wajar dalam waktu yang patut.
3. Memberitahukan perubahan aturan atau gangguan layanan (air, listrik) melalui papan pengumuman.

## Pasal 7 - Berakhirnya Sewa
1. Sewa berakhir pada akhir jangka waktu, kecuali diperpanjang.
2. PIHAK KEDUA yang ingin berhenti sebelum waktunya memberitahukan paling lambat 30 hari sebelumnya; sewa yang telah dibayar untuk periode berjalan tidak dikembalikan, kecuali disepakati lain.
3. Saat keluar, kondisi kamar diperiksa bersama dan dicatat.

## Pasal 8 - Penyelesaian Perselisihan
Perselisihan diselesaikan secara musyawarah untuk mufakat.

## Pasal 9 - Persetujuan Elektronik
Perjanjian ini disetujui PIHAK KEDUA secara elektronik melalui dashboard penghuni Bonaasina. Waktu persetujuan dan perangkat yang dipakai dicatat oleh sistem.`;
