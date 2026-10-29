// Bonaasina API — Supabase Edge Function (Deno).
// Satu fungsi melayani tiga kelompok:
//   /public, /surveys, /waitlist → calon penyewa (tanpa login)
//   /penghuni/...              → penghuni (username + kata sandi; sesi di header X-Tenant-Session)
//   /admin/...                 → pemilik (token login Supabase Auth, email harus terdaftar di tabel admins)
// Fungsi ini memakai kunci rahasia (melewati RLS); tabel tidak bisa diakses dari browser secara langsung.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import bcrypt from 'npm:bcryptjs@2.4.3';
import { contractPdf, receiptPdf, cardPdf, qrSvg, terbilang, DEFAULT_CONTRACT_TEMPLATE } from './docs.ts';
import { createMarket } from './market.ts';
import { createCommunity } from './community.ts';
import { createMailer, isEmail } from './mailer.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const secretKeys = safeJson(Deno.env.get('SUPABASE_SECRET_KEYS'));
const publishableKeys = safeJson(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'));
const SECRET = secretKeys?.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUBLISHABLE = publishableKeys?.default ?? Deno.env.get('SUPABASE_ANON_KEY')!;
const PHOTO_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/photos/`;
const SITE_URL = (Deno.env.get('SITE_URL') || 'https://bonaasina.my.id').replace(/\/$/, '');
const DEFAULT_INSPECTION_ITEMS = ['Kasur & dipan', 'Bantal, guling & sprei', 'Lemari', 'Meja & kursi', 'Lampu & stopkontak', 'Kipas angin / AC', 'Pintu & kunci', 'Jendela & gorden', 'Dinding, plafon & lantai', 'Kamar mandi (bila di dalam)', 'Kunci kamar diserahkan'];
const sb: SupabaseClient = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });

function safeJson(s?: string | null) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

// ---------------------------------------------------------------- util umum
type Row = Record<string, any>;
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const bad = (m: string) => new HttpError(400, m);
const notFound = (m: string) => new HttpError(404, m);

const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const toCamel = (r: any): any => (r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v])) : r);
const toSnake = (r: Row) => Object.fromEntries(Object.entries(r).map(([k, v]) => [snake(k), v]));

const str = (v: unknown, max = 500) => String(v ?? '').trim().slice(0, max);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0; };
// Potongan deposit boleh 0, tetapi negatif atau bukan angka ditolak dengan pesan (dulu menjadi 0 diam-diam).
function depositDeduction(v: unknown) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw bad('Potongan deposit tidak boleh negatif atau bukan angka.');
  return Math.round(n);
}
const strList = (v: unknown, max = 40) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : []).map((x) => str(x, 200)).filter(Boolean).slice(0, max);
// Daftar foto dengan batas eksplisit: kelebihan ditolak dengan pesan, bukan dipotong tanpa kabar.
function photoList(v: unknown, max: number, label = 'foto') {
  const list = strList(v, 200).filter(okPhoto);
  if (list.length > max) throw bad(`Maksimal ${max} ${label}. Hapus sebagian dulu sebelum menyimpan.`);
  return list;
}
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const pick = (o: Row, f: string[]) => { const out: Row = {}; for (const k of f) if (o[k] !== undefined) out[k] = o[k]; return out; };
const byCode = (a: Row, b: Row) => a.code.localeCompare(b.code, 'id', { numeric: true });
const bySort = (a: Row, b: Row) => (a.sort ?? 0) - (b.sort ?? 0);

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomToken(bytes = 24) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------- akses data
async function q<T = Row>(p: PromiseLike<{ data: any; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) {
    if (error.code === '23505') throw bad('Data ini sudah ada (duplikat).');
    if (error.code === '23503') throw bad('Data ini masih dipakai oleh data lain, jadi tidak bisa dihapus.');
    console.error(error);
    throw new HttpError(500, 'Gagal mengakses database.');
  }
  return data as T;
}
// PostgREST membatasi jumlah baris yang dikembalikan satu permintaan (max_rows, bawaan 1000) tanpa
// memberi tahu pemanggil. Setiap daftar yang dibaca penuh diambil per halaman supaya tidak ada data
// yang diam-diam hilang ketika tabel bertambah besar.
const PAGE_SIZE = 500;
const ALL_MAX = 20000;
const IN_CHUNK = 100;
async function pages<T = Row>(make: (from: number, to: number) => any, max = ALL_MAX): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE_SIZE) {
    const part = (await q<T[]>(make(from, from + PAGE_SIZE - 1))) || [];
    out.push(...part);
    if (part.length < PAGE_SIZE) break;
  }
  return out;
}
// Daftar penuh sebuah tabel, urut kolom yang diminta + id sebagai pemecah seri supaya halaman stabil.
// Username dipakai bersama oleh penghuni, pemilik kos, dan customer reservasi; /masuk mencoba
// ketiganya, jadi keunikan harus dicek di ketiga tabel juga — bukan hanya di tenants.
async function usernameTakenAnywhere(username: string, except?: { table: string; id: string }) {
  const tables: [string, string][] = [['owners', 'pemilik kos'], ['leads', 'customer reservasi'], ['tenants', 'penghuni']];
  const rows = await Promise.all(tables.map(([t]) => q<Row | null>(sb.from(t).select('id').eq('username', username).maybeSingle())));
  for (let i = 0; i < tables.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (except && except.table === tables[i][0] && row.id === except.id) continue;
    return tables[i][1];
  }
  return null;
}

const all = async (table: string, order = 'created_at', opts: { ascending?: boolean; max?: number } = {}) => {
  const ascending = opts.ascending ?? true;
  const rows = await pages<Row>(
    (from, to) => sb.from(table).select('*').order(order, { ascending }).order('id', { ascending }).range(from, to),
    opts.max ?? ALL_MAX,
  );
  return rows.map((r) => toCamel(r)!);
};
// Baris untuk daftar id yang panjang: dipotong per 100 id (batas panjang URL) dan tetap per halaman.
async function rowsIn(table: string, column: string, ids: string[], select = '*', extra?: (b: any) => any) {
  const out: Row[] = [];
  const list = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < list.length; i += IN_CHUNK) {
    const part = list.slice(i, i + IN_CHUNK);
    out.push(...await pages<Row>((from, to) => {
      let b = sb.from(table).select(select).in(column, part);
      if (extra) b = extra(b);
      return b.order('id').range(from, to);
    }));
  }
  return out;
}
const one = async (table: string, id: string) => toCamel(await q(sb.from(table).select('*').eq('id', id).maybeSingle()));
const insert = async (table: string, row: Row) => toCamel(await q(sb.from(table).insert(toSnake(row)).select().single()))!;
const update = async (table: string, id: string, patch: Row) => {
  const r = toCamel(await q(sb.from(table).update(toSnake(patch)).eq('id', id).select().maybeSingle()));
  if (!r) throw notFound('Data tidak ditemukan.');
  return r;
};
const remove = async (table: string, id: string) => { await q(sb.from(table).delete().eq('id', id)); return { ok: true }; };
async function getSettings(): Promise<Row> { return (await q<Row | null>(sb.from('settings').select('data').eq('id', 1).maybeSingle()))?.data ?? {}; }

// ---------------------------------------------------------------- tanggal & tagihan
const DAY = 864e5;
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
// Kalender pemilik: WIB (UTC+7)
const todayStr = () => fmt(new Date(Date.now() + 7 * 3600 * 1000));
function addMonths(s: string, n: number) {
  const d = parse(s); const day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last)); return fmt(t);
}
const monthsDiff = (a: string, b: string) => (parse(b).getUTCFullYear() - parse(a).getUTCFullYear()) * 12 + (parse(b).getUTCMonth() - parse(a).getUTCMonth());
const tanggal = (s?: string | null) => { if (!s) return ''; const d = parse(s); return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
// Lama satu periode tagihan dalam bulan (harian ditagih sekali untuk seluruh masa inap).
const CYCLE_MONTHS: Record<string, number> = { bulanan: 1, semesteran: 6, tahunan: 12 };
const CYCLES = ['harian', 'bulanan', 'semesteran', 'tahunan'];
const CYCLE_WORD: Record<string, string> = { harian: 'hari', bulanan: 'bulan', semesteran: '6 bulan', tahunan: 'tahun' };
export function roomPrice(r: Row, cycle: string) {
  return Number(({ harian: r.priceDaily, bulanan: r.priceMonthly, semesteran: r.priceSemester, tahunan: r.priceYearly } as Row)[cycle]) || 0;
}
// Tambahan bila berdua untuk sejumlah bulan; extraPersonFee dicatat per bulan atau per tahun (extraPersonPeriod).
export function extraFee(r: Row, months: number) {
  const fee = Number(r.extraPersonFee) || 0;
  return r.extraPersonPeriod === 'tahunan' ? Math.round((fee * months) / 12) : fee * months;
}
function periodLabel(t: Row, start: string) {
  const s = parse(start);
  const range = (e: Date) => `${s.getUTCDate()} ${BULAN[s.getUTCMonth()]} ${s.getUTCFullYear()} – ${e.getUTCDate()} ${BULAN[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
  if (t.rentCycle === 'harian') { const e = parse(t.endDate || start); if (t.endDate) e.setUTCDate(e.getUTCDate() - 1); return range(e); }
  if (t.rentCycle === 'tahunan' || t.rentCycle === 'semesteran') {
    const e = parse(addMonths(start, CYCLE_MONTHS[t.rentCycle])); e.setUTCDate(e.getUTCDate() - 1);
    return range(e);
  }
  return `${BULAN[s.getUTCMonth()]} ${s.getUTCFullYear()}`;
}
const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((parse(b).getTime() - parse(a).getTime()) / DAY));
function decorate(i: Row, today = todayStr()): Row {
  const d = i.status === 'belum' && i.dueDate < today ? Math.round((parse(today).getTime() - parse(i.dueDate).getTime()) / DAY) : 0;
  return { ...i, overdue: d > 0, overdueDays: d };
}
function normalizePhone(p?: string) {
  let s = String(p || '').replace(/[^0-9+]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('0')) s = '62' + s.slice(1);
  if (s.startsWith('8')) s = '62' + s;
  return s;
}
const rupiah = (n: number) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
const waLink = (phone: string, text: string) => `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(text)}`;

// Pembuatan tagihan otomatis cukup sekali per beberapa menit per instance; perubahan data oleh admin
// mereset jeda ini (lihat Deno.serve), jadi tagihan baru tetap langsung muncul setelah data penghuni berubah.
let lastAutoGen = 0;
async function generateInvoicesThrottled() {
  if (Date.now() - lastAutoGen < 5 * 60e3) return 0;
  const n = await generateInvoices();
  lastAutoGen = Date.now();
  return n;
}

// Penanda tagihan yang sengaja dihapus admin (migrasi: invoice_skips). Bila migrasinya belum
// diterapkan, pembuatan tagihan tetap berjalan seperti biasa alih-alih gagal total.
async function invoiceSkips(tenantIds: string[]): Promise<Row[]> {
  if (!tenantIds.length) return [];
  try {
    return await rowsIn('invoice_skips', 'tenant_id', tenantIds, 'tenant_id, period_start');
  } catch (e) {
    console.error('invoice_skips belum tersedia', e);
    return [];
  }
}

// Buat tagihan yang sudah waktunya (idempoten: unik per penghuni + awal periode).
async function generateInvoices(tenantId?: string) {
  const settings = await getSettings();
  const lead = Number(settings.invoiceLeadDays ?? 7);
  const limit = fmt(new Date(parse(todayStr()).getTime() + lead * DAY));
  let tq = sb.from('tenants').select('*').eq('status', 'aktif');
  if (tenantId) tq = tq.eq('id', tenantId);
  const tenants = ((await q<Row[]>(tq)) || []).map((r) => toCamel(r)!);
  if (!tenants.length) return 0;
  const tenantIds = tenants.map((t) => t.id);
  // Hanya periode setahun terakhir yang relevan untuk pembuatan otomatis; membaca seluruh riwayat
  // tagihan tiap penghuni membuat permintaan ini tumbuh terus tanpa manfaat.
  const lookback = addMonths(todayStr(), -12);
  const [billed, skipped] = await Promise.all([
    rowsIn('invoices', 'tenant_id', tenantIds, 'tenant_id, period_start', (b: any) => b.gte('period_start', lookback)),
    invoiceSkips(tenantIds),
  ]);
  // Tagihan yang sengaja dihapus admin tidak dibuat ulang (dicatat di tabel invoice_skips).
  const seen = new Set([...billed, ...skipped].map((r) => `${r.tenant_id}|${r.period_start}`));
  const roomIds = [...new Set(tenants.map((t) => t.roomId).filter(Boolean))] as string[];
  const rooms = new Map((await rowsIn('rooms', 'id', roomIds, 'id, property_id')).map((r) => [r.id, r.property_id]));
  const rows: Row[] = [];
  for (const t of tenants) {
    if (!t.startDate || !t.rentAmount) continue;
    // Sewa harian: satu tagihan untuk seluruh masa inap (tarif per hari × jumlah malam).
    if (t.rentCycle === 'harian') {
      const start = t.startDate;
      if (start > limit || seen.has(`${t.id}|${start}`) || (t.billFrom && start < t.billFrom)) continue;
      const nights = t.endDate ? nightsBetween(start, t.endDate) : 1;
      rows.push({ tenant_id: t.id, room_id: t.roomId, property_id: rooms.get(t.roomId) ?? null, period_start: start, period_label: `${periodLabel(t, start)} (${nights} malam)`, cycle: 'harian', due_date: start, amount: t.rentAmount * nights, status: 'belum' });
      seen.add(`${t.id}|${start}`);
      continue;
    }
    const step = CYCLE_MONTHS[t.rentCycle] || 1;
    const firstK = Math.max(0, Math.ceil(monthsDiff(t.startDate, lookback) / step));
    for (let k = firstK; k < firstK + 600; k++) {
      const start = addMonths(t.startDate, step * k);
      if (start > limit || (t.endDate && start >= t.endDate)) break;
      if (seen.has(`${t.id}|${start}`) || (t.billFrom && start < t.billFrom)) continue;
      rows.push({ tenant_id: t.id, room_id: t.roomId, property_id: rooms.get(t.roomId) ?? null, period_start: start, period_label: periodLabel(t, start), cycle: t.rentCycle, due_date: start, amount: t.rentAmount, status: 'belum' });
      seen.add(`${t.id}|${start}`);
    }
  }
  if (rows.length) {
    const inserted = (await q<Row[]>(sb.from('invoices').upsert(rows, { onConflict: 'tenant_id,period_start', ignoreDuplicates: true }).select('id, tenant_id, period_label, amount, due_date'))) || [];
    mailNewInvoices(tenants, inserted.map((r) => toCamel(r)!));
  }
  return rows.length;
}
// Satu email per penghuni untuk tagihan yang baru terbit (bisa lebih dari satu periode sekaligus).
function mailNewInvoices(tenants: Row[], invs: Row[]) {
  for (const t of tenants) {
    const mine = invs.filter((i) => i.tenantId === t.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (!mine.length || !t.email) continue;
    const total = mine.reduce((a, i) => a + (i.amount || 0), 0);
    mail.send({
      to: t.email, kind: 'invoice.new', dedupeKey: `invoice.new:${mine.map((i) => i.id).join(',')}`.slice(0, 250),
      subject: mine.length === 1 ? `Tagihan sewa ${mine[0].periodLabel}: ${rupiah(total)}` : `${mine.length} tagihan sewa baru: ${rupiah(total)}`,
      title: mine.length === 1 ? 'Tagihan sewa baru' : `${mine.length} tagihan sewa baru`,
      intro: `Horas ${t.name}, tagihan sewa kamar Anda sudah terbit.`,
      rows: mine.map((i) => [i.periodLabel, `${rupiah(i.amount)}, jatuh tempo ${tanggal(i.dueDate)}`] as [string, string]),
      note: 'Setelah membayar, unggah bukti transfer di dashboard penghuni supaya pembayaran cepat diperiksa.',
      cta: { label: 'Buka dashboard penghuni', url: PENGHUNI_URL },
    });
  }
}

const DEFAULT_TEMPLATE =
  'Horas {nama}, ini pengingat dari {kos}.\n\nTagihan sewa kamar {kamar} untuk periode {periode} sebesar {jumlah} jatuh tempo {jatuh_tempo}.{keterlambatan}\n\n' +
  'Pembayaran bisa ditransfer ke:\n{rekening}\n\nSetelah bayar, unggah bukti transfer di dashboard penghuni Anda:\n{portal}\n\nTerima kasih.';

// ---------------------------------------------------------------- berkas
const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
async function readImage(req: Request, maxBytes = 5 * 1024 * 1024) {
  const type = (req.headers.get('content-type') || '').split(';')[0];
  const ext = MIME_EXT[type];
  if (!ext) throw bad('Unggah foto JPG, PNG, atau WebP.');
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length) throw bad('File kosong.');
  if (buf.length > maxBytes) throw bad('Foto terlalu besar (maks. 5 MB).');
  const hex = [...buf.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const ascii = (a: number, b: number) => String.fromCharCode(...buf.slice(a, b));
  const ok = (ext === 'jpg' && buf[0] === 0xff && buf[1] === 0xd8) || (ext === 'png' && hex === '89504e47') || (ext === 'webp' && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP');
  if (!ok) throw bad('File ini bukan gambar yang valid.');
  return { buf, type, ext };
}
async function putFile(bucket: string, path: string, buf: Uint8Array, type: string) {
  const { error } = await sb.storage.from(bucket).upload(path, buf, { contentType: type, upsert: false });
  if (error) { console.error(error); throw new HttpError(500, 'Gagal menyimpan file.'); }
}
async function signedUrl(path: string) {
  const { data, error } = await sb.storage.from('private').createSignedUrl(path, 300);
  if (error) throw notFound('File tidak ditemukan.');
  return data.signedUrl;
}
const okPhoto = (u: string) => u.startsWith(PHOTO_PREFIX) || u.startsWith('/assets/');

// ---------------------------------------------------------------- log aktivitas
// Dicatat: login/keluar admin, semua perubahan data oleh admin, akses berkas & unduhan,
// aktivitas penghuni di dashboard, permintaan survei & daftar tunggu, dan percobaan akses yang gagal.
// Kunjungan halaman publik tidak dicatat di sini (itu tugas Google Analytics).
type ActorType = 'admin' | 'penghuni' | 'publik' | 'pemilik' | 'customer';
type LogEntry = { action: string; summary: string; target?: string | null; ok?: boolean; meta?: Row; dedupeMinutes?: number };
const LOG_KEEP_DAYS = 180;

function describeUA(ua: string | null) {
  const s = ua || '';
  if (!s) return '';
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet'
    : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /bot|crawl|spider/i.test(s) ? 'Bot' : 'Peramban lain';
  const os = /Android/.test(s) ? 'Android' : /iPhone|iPad|iPod/.test(s) ? 'iPhone/iPad' : /Windows/.test(s) ? 'Windows'
    : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${browser} di ${os}` : browser;
}
function clientInfo(req: Request) {
  const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 64);
  return { ip, ua: describeUA(req.headers.get('user-agent')) };
}
// Jalankan di latar belakang supaya respons ke pengguna tidak menunggu penulisan log.
function background(p: Promise<unknown>) {
  const safe = p.catch((e) => console.error('log', e));
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(safe); } catch { /* tetap jalan */ }
}
function writeLog(req: Request, actorType: ActorType, actor: string, e: LogEntry, roomIdForTarget?: string) {
  const { ip, ua } = clientInfo(req);
  background((async () => {
    if (roomIdForTarget && !e.target) e.target = (await one('rooms', roomIdForTarget))?.code;
    if (e.dedupeMinutes) {
      const since = new Date(Date.now() - e.dedupeMinutes * 60e3).toISOString();
      let dq = sb.from('activity_log').select('id', { count: 'exact', head: true })
        .eq('action', e.action).eq('actor', actor).eq('ip', ip).gte('created_at', since);
      if (e.target) dq = dq.eq('target', e.target);
      const { count } = await dq;
      if ((count ?? 0) > 0) return;
    }
    const { error } = await sb.from('activity_log').insert({
      actor_type: actorType, actor: str(actor, 200) || '-', action: e.action, summary: str(e.summary, 300),
      target: e.target ? str(e.target, 120) : null, ok: e.ok !== false, ip, user_agent: ua, meta: e.meta ?? null,
    });
    if (error) console.error('log', error);
    // Bersihkan log lama sesekali.
    if (Math.random() < 0.02) await sb.from('activity_log').delete().lt('created_at', new Date(Date.now() - LOG_KEEP_DAYS * DAY).toISOString());
  })());
}
// ---------------------------------------------------------------- email (Resend)
const mail = createMailer({ sb, background, SITE_URL });
// Kolom email opsional dari formulir: kosong boleh, isi harus alamat yang benar.
function emailField(v: unknown) {
  const e = str(v, 120).toLowerCase();
  if (e && !isEmail(e)) throw bad('Alamat email belum benar. Contoh: nama@gmail.com');
  return e;
}
const PENGHUNI_URL = `${SITE_URL}/penghuni/`;
const ADMIN_URL = `${SITE_URL}/admin/`;

const STATUS_LABEL: Record<string, string> = { kosong: 'Kosong', terisi: 'Terisi', dipesan: 'Dipesan', perbaikan: 'Perbaikan', baru: 'Baru', dikonfirmasi: 'Dikonfirmasi', selesai: 'Selesai', batal: 'Batal', dikerjakan: 'Sedang dikerjakan' };
async function invoiceDesc(id: string) {
  const r = await q<Row | null>(sb.from('invoices').select('period_label, amount, tenants(name), rooms(code)').eq('id', id).maybeSingle());
  return r ? { text: `${r.tenants?.name || 'penghuni'}, ${r.period_label} (${rupiah(r.amount)})`, target: r.rooms?.code || null } : { text: 'tagihan', target: null };
}

// ---------------------------------------------------------------- router
type Ctx = { req: Request; url: URL; params: Record<string, string>; body: Row; tenant?: Row; owner?: Row; lead?: Row; adminEmail?: string; log?: LogEntry | null };
// Handler memanggil log({...}) untuk mencatat aktivitasnya; catatan ditulis setelah handler berhasil.
type Handler = (c: Ctx, log: (e: LogEntry) => void) => Promise<unknown> | unknown;
type Area = 'public' | 'penghuni' | 'admin' | 'pemilik' | 'akun';
const routes: { method: string; re: RegExp; keys: string[]; area: Area; raw: boolean; fn: Handler }[] = [];
function on(method: string, path: string, fn: Handler, opts: { raw?: boolean } = {}) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  const area: Area = path.startsWith('/admin') && !/^\/admin\/(login|refresh|setup)$/.test(path) ? 'admin'
    : path.startsWith('/penghuni') && path !== '/penghuni/login' ? 'penghuni'
    : path.startsWith('/pemilik/') ? 'pemilik' : path.startsWith('/akun/') ? 'akun' : 'public';
  routes.push({ method, re, keys, area, raw: !!opts.raw, fn });
}
const created = (body: unknown) => ({ __status: 201, body });

// ================================================================ PUBLIK
export const PUBLIC_PROPERTY_FIELDS = ['id', 'slug', 'name', 'shortName', 'logo', 'gender', 'tagline', 'description', 'address', 'mapsQuery', 'facilities', 'nearby', 'photos', 'kind', 'city', 'periods', 'minBooking', 'bookingPolicy', 'visitHours', 'chatEnabled', 'checkedAt'];
export const PUBLIC_ROOM_FIELDS = ['id', 'propertyId', 'code', 'type', 'sizeM2', 'floor', 'priceDaily', 'priceMonthly', 'priceSemester', 'priceYearly', 'capacity', 'extraPersonFee', 'extraPersonPeriod', 'facilities', 'photos', 'note'];
on('GET', '/public', async () => {
  const [s, allProps, active, partners] = await Promise.all([
    getSettings(), all('properties'),
    q<Row[]>(sb.from('tenants').select('room_id').eq('status', 'aktif')),
    sb.from('properties').select('id', { count: 'exact', head: true }).eq('kind', 'mitra').eq('status', 'aktif'),
  ]);
  // Halaman utama hanya menampilkan kos milik Bonaasina; kos mitra tampil di /kos-sekitar/.
  const props = allProps.filter((p) => p.kind !== 'mitra' && p.status === 'aktif');
  // Kamar dibaca hanya untuk kos yang tampil, bukan seluruh kamar marketplace.
  const rooms = (await rowsIn('rooms', 'property_id', props.map((p) => p.id), '*')).map((r) => toCamel(r)!);
  const ids = new Set(props.map((p) => p.id));
  const occ = new Set((active || []).map((t) => t.room_id));
  return {
    site: pick(s, ['siteName', 'tagline', 'ownerName', 'whatsapp', 'depositInfo', 'paymentMethods', 'faq', 'heroWords', 'surveyHours', 'brandLogo']),
    whatsappNormalized: normalizePhone(s.whatsapp),
    partnersCount: partners.count ?? 0,
    properties: props.sort(bySort).map((p) => ({ ...pick(p, PUBLIC_PROPERTY_FIELDS), waEnabled: p.waEnabled !== false })),
    rooms: rooms.filter((r) => !r.hidden && ids.has(r.propertyId)).map((r) => ({
      ...pick(r, PUBLIC_ROOM_FIELDS),
      status: occ.has(r.id) ? 'terisi' : r.status,
    })).sort(byCode),
  };
});

// Logo & kontak untuk header/footer halaman publik selain beranda (ringan, tanpa data kamar).
on('GET', '/brand', async () => {
  const [s, props] = await Promise.all([getSettings(), q<Row[]>(sb.from('properties').select('name, logo, kind, status, sort'))]);
  return {
    brandLogo: s.brandLogo || '', whatsapp: normalizePhone(s.whatsapp || ''),
    properties: (props || []).filter((p) => p.kind !== 'mitra' && p.status === 'aktif').sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map((p) => ({ name: p.name, logo: p.logo })),
  };
});

on('POST', '/surveys', async ({ body: b }, log) => {
  if (b.website) return { ok: true }; // honeypot
  const name = str(b.name, 80), phone = str(b.phone, 20), propertyId = str(b.propertyId, 60), email = emailField(b.email);
  if (!name) throw bad('Isi nama Anda.');
  if (normalizePhone(phone).length < 10) throw bad('Nomor WhatsApp belum benar. Contoh: 0812 3456 7890.');
  if (!(await one('properties', propertyId))) throw bad('Pilih kos yang ingin disurvei.');
  if (!isDate(b.date) || b.date < todayStr()) throw bad('Pilih tanggal survei hari ini atau setelahnya.');
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count } = await sb.from('surveys').select('id', { count: 'exact', head: true }).eq('phone', phone).gte('created_at', since);
  if ((count ?? 0) >= 3) throw new HttpError(429, 'Permintaan dari nomor ini sudah cukup banyak. Silakan hubungi lewat WhatsApp.');
  const roomId = b.roomId && (await one('rooms', str(b.roomId, 40))) ? str(b.roomId, 40) : null;
  const rec = await insert('surveys', {
    propertyId, roomId, name, phone, email, date: b.date, time: str(b.time, 20), occupation: str(b.occupation, 80),
    duration: ['bulanan', 'tahunan', 'belum tahu'].includes(b.duration) ? b.duration : 'belum tahu', note: str(b.note, 600),
  });
  // Hitung ulang setelah insert: dua kiriman bersamaan bisa sama-sama lolos pemeriksaan awal.
  const { count: surveyAfter } = await sb.from('surveys').select('id', { count: 'exact', head: true }).eq('phone', phone).gte('created_at', since);
  if ((surveyAfter ?? 0) > 3) {
    await q(sb.from('surveys').delete().eq('id', rec.id));
    throw new HttpError(429, 'Permintaan dari nomor ini sudah cukup banyak. Silakan hubungi lewat WhatsApp.');
  }
  const prop = await one('properties', propertyId);
  const roomCode = rec.roomId ? (await one('rooms', rec.roomId))?.code : null;
  const when = `${tanggal(b.date)}${rec.time ? `, ${rec.time}` : ''}`;
  mail.send({
    to: email, kind: 'survey.received', dedupeKey: `survey.received:${rec.id}`,
    subject: `Permintaan survei ${prop?.name || 'kos'} diterima`, title: 'Permintaan survei Anda sudah kami terima',
    intro: `Horas ${name}, terima kasih sudah mendaftar survei. Pengelola akan mengonfirmasi jadwalnya lewat WhatsApp atau email ini.`,
    rows: [['Kos', prop?.name || '-'], ['Kamar', roomCode || ''], ['Jadwal', when]],
  });
  mail.sendAdmin({
    kind: 'survey.admin', dedupeKey: `survey.admin:${rec.id}`, subject: `Survei baru: ${name}, ${prop?.name || ''} ${tanggal(b.date)}`,
    title: 'Permintaan survei baru', rows: [['Nama', name], ['WhatsApp', phone], ['Email', email], ['Kos', prop?.name || '-'], ['Kamar', roomCode || ''], ['Jadwal', when], ['Catatan', rec.note || '']],
    cta: { label: 'Buka admin', url: ADMIN_URL },
  });
  log({ action: 'survey.create', summary: `Mengirim permintaan survei ${prop?.name || ''} untuk ${tanggal(b.date)}`, target: rec.roomId ? (await one('rooms', rec.roomId))?.code : null, meta: { name } });
  return created({ ok: true, id: rec.id });
});

// ================================================================ DASHBOARD PENGHUNI — bukti bayar & kerusakan
on('POST', '/penghuni/invoices/:id/proof', async ({ req, params, tenant: t }, log) => {
  const inv = await one('invoices', params.id);
  if (!inv || inv.tenantId !== t!.id) throw notFound('Tagihan tidak ditemukan.');
  if (inv.status === 'lunas') throw bad('Tagihan ini sudah lunas.');
  const { buf, type, ext } = await readImage(req);
  const path = `proofs/${t!.id}/${inv.id}-${Date.now()}.${ext}`;
  await putFile('private', path, buf, type);
  const rec = await update('invoices', inv.id, { proofPath: path, proofStatus: 'menunggu', proofNote: null, proofUploadedAt: new Date().toISOString() });
  mail.sendAdmin({
    kind: 'invoice.proof', dedupeKey: `invoice.proof:${path}`, subject: `Bukti bayar dari ${t!.name}: ${inv.periodLabel}`,
    title: 'Bukti bayar baru perlu diperiksa', rows: [['Penghuni', t!.name], ['Tagihan', inv.periodLabel], ['Jumlah', rupiah(inv.amount)]],
    note: 'Periksa mutasi rekening, lalu tandai lunas atau tolak buktinya di menu Tagihan.', cta: { label: 'Buka admin', url: ADMIN_URL },
  });
  log({ action: 'tenant.proof', summary: `Mengunggah bukti bayar ${inv.periodLabel} (${rupiah(inv.amount)})` });
  return pick(rec, ['id', 'proofStatus', 'proofUploadedAt']);
}, { raw: true });

const ISSUE_CATS = ['Listrik', 'Air & kamar mandi', 'Pintu & kunci', 'Perabot', 'WiFi', 'Kebersihan', 'Lainnya'];
on('POST', '/penghuni/issues', async ({ body: b, tenant: t }, log) => {
  const title = str(b.title, 120);
  if (!title) throw bad('Tulis singkat apa yang rusak.');
  const { count } = await sb.from('issues').select('id', { count: 'exact', head: true }).eq('tenant_id', t!.id).gte('created_at', new Date(Date.now() - DAY).toISOString());
  if ((count ?? 0) >= 10) throw new HttpError(429, 'Laporan hari ini sudah banyak. Hubungi pengelola lewat WhatsApp.');
  const room = await one('rooms', t!.roomId);
  const rec = await insert('issues', {
    tenantId: t!.id, roomId: t!.roomId, propertyId: room?.propertyId ?? null,
    category: ISSUE_CATS.includes(b.category) ? b.category : 'Lainnya', title, description: str(b.description, 1500),
  });
  mail.sendAdmin({
    kind: 'issue.new', dedupeKey: `issue.new:${rec.id}`, subject: `Laporan kerusakan kamar ${room?.code || ''}: ${title}`,
    title: 'Laporan kerusakan baru', rows: [['Penghuni', t!.name], ['Kamar', room?.code || '-'], ['Kategori', rec.category], ['Masalah', title], ['Keterangan', rec.description || '']],
    cta: { label: 'Buka admin', url: ADMIN_URL },
  });
  log({ action: 'tenant.issue', summary: `Melaporkan kerusakan: ${title}`, target: room?.code });
  return created(pick(rec, ['id', 'category', 'title', 'description', 'status', 'createdAt']));
});
on('POST', '/penghuni/issues/:id/photo', async ({ req, params, tenant: t }, log) => {
  const iss = await one('issues', params.id);
  if (!iss || iss.tenantId !== t!.id) throw notFound('Laporan tidak ditemukan.');
  const { buf, type, ext } = await readImage(req);
  const path = `issues/${t!.id}/${iss.id}-${Date.now()}.${ext}`;
  await putFile('private', path, buf, type);
  await update('issues', iss.id, { photoPath: path });
  log({ action: 'tenant.issue_photo', summary: `Menambah foto laporan "${iss.title}"` });
  return { ok: true };
}, { raw: true });

// ================================================================ ADMIN — login
on('POST', '/admin/login', async ({ req, body: b }, log) => {
  const email = str(b.email, 200).toLowerCase();
  const fail = (why: string) => { writeLog(req, 'admin', email || '(tanpa email)', { action: 'login.failed', summary: `Gagal masuk: ${why}`, ok: false }); return new HttpError(401, 'Email atau kata sandi salah.'); };
  if (!(await q<Row | null>(sb.from('admins').select('email').eq('email', email).maybeSingle()))) throw fail('email tidak terdaftar sebagai admin');
  const auth = createClient(SUPABASE_URL, PUBLISHABLE, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.signInWithPassword({ email, password: String(b.password || '') });
  if (error || !data.session) throw fail('kata sandi salah');
  log({ action: 'login', summary: 'Masuk ke admin' });
  return sessionOut(data.session);
});
on('POST', '/admin/logout', async (_c, log) => { log({ action: 'logout', summary: 'Keluar dari admin' }); return { ok: true }; });
on('POST', '/admin/activity/view', async ({ body: b }, log) => {
  const view = str(b.view, 40); const label = str(b.label, 60) || view;
  if (view) log({ action: 'view', summary: `Membuka menu ${label}`, target: view, dedupeMinutes: 15 });
  return { ok: true };
});
on('POST', '/admin/refresh', async ({ body: b }) => {
  const auth = createClient(SUPABASE_URL, PUBLISHABLE, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.refreshSession({ refresh_token: String(b.refreshToken || '') });
  if (error || !data.session) throw new HttpError(401, 'Sesi berakhir. Silakan masuk lagi.');
  return sessionOut(data.session);
});
// Buat/ganti kata sandi admin dengan kode penyiapan sekali pakai (dibuat pemilik proyek lewat SQL).
on('POST', '/admin/setup', async ({ req, body: b }, log) => {
  const email = str(b.email, 200).toLowerCase(); const code = str(b.code, 64); const password = String(b.password || '');
  if (password.length < 10) throw bad('Kata sandi minimal 10 karakter.');
  const { ip } = clientInfo(req);
  const since = new Date(Date.now() - 15 * 60e3).toISOString();
  const { count } = await sb.from('activity_log').select('id', { count: 'exact', head: true }).eq('action', 'setup.failed').eq('ip', ip).gte('created_at', since);
  if ((count ?? 0) >= 5) throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.');
  const row = toCamel(await q(sb.from('setup_codes').select('*').eq('email', email).maybeSingle()));
  if (!row || row.expiresAt < new Date().toISOString() || row.codeHash !== (await sha256(code))) {
    writeLog(req, 'admin', email || '(tanpa email)', { action: 'setup.failed', summary: 'Gagal mengatur kata sandi: kode penyiapan salah atau kedaluwarsa', ok: false });
    throw new HttpError(401, 'Kode penyiapan salah atau sudah kedaluwarsa.');
  }
  // Kode diklaim lebih dulu dengan hapus bersyarat: dua permintaan yang datang bersamaan tidak bisa
  // sama-sama memakainya (dulu keduanya lolos dan kata sandi terakhir yang menang).
  const claimed = await q(sb.from('setup_codes').delete().eq('email', email).eq('code_hash', row.codeHash).select('email').maybeSingle()).catch(() => null);
  if (!claimed) throw new HttpError(401, 'Kode penyiapan ini sudah dipakai. Minta kode baru dari pemilik proyek.');
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = list?.users.find((u) => (u.email || '').toLowerCase() === email);
  const res = user
    ? await sb.auth.admin.updateUserById(user.id, { password })
    : await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (res.error) {
    await Promise.allSettled([sb.from('setup_codes').insert({ email, code_hash: row.codeHash, expires_at: row.expiresAt })]);
    console.error(res.error); throw bad('Gagal menyimpan kata sandi. Coba kata sandi lain.');
  }
  mail.send({
    to: email, kind: 'security.admin_setup', dedupeKey: null, subject: 'Kata sandi admin Bonaasina diatur',
    title: 'Kata sandi admin baru saja diatur', intro: `Kata sandi admin untuk ${email} baru saja diatur memakai kode penyiapan dari ${clientInfo(req).ua || 'perangkat tidak dikenal'}.`,
    note: 'Bila bukan Anda, segera buat kode penyiapan baru dan ganti kata sandinya.', cta: { label: 'Masuk ke admin', url: ADMIN_URL },
  });
  log({ action: 'setup', summary: 'Mengatur kata sandi admin dengan kode penyiapan' });
  return { ok: true };
});
function sessionOut(s: Row) { return { accessToken: s.access_token, refreshToken: s.refresh_token, expiresAt: s.expires_at }; }

// ================================================================ ADMIN — ringkasan
on('GET', '/admin/summary', async () => {
  const createdCount = await generateInvoicesThrottled();
  const today = todayStr(); const month = today.slice(0, 7); const monthStart = `${month}-01`;
  // Ringkasan hanya membaca baris yang benar-benar dipakai: tagihan belum lunas, pembayaran bulan ini,
  // pengeluaran bulan ini, penghuni aktif, plus hitungan untuk lencana — bukan seluruh riwayat tabel.
  const [props, rooms, activeTenants, unpaidRows, paidMonth, expRows, contracts, s, [surveysBaru, issuesOpen, waitlistToNotify]] = await Promise.all([
    all('properties'), all('rooms'),
    pages<Row>((from, to) => sb.from('tenants').select('id, room_id, end_date').eq('status', 'aktif').range(from, to)),
    pages<Row>((from, to) => sb.from('invoices').select('amount, due_date, proof_status').eq('status', 'belum').range(from, to)),
    pages<Row>((from, to) => sb.from('invoices').select('amount, paid_amount').eq('status', 'lunas').gte('paid_at', monthStart).range(from, to)),
    pages<Row>((from, to) => sb.from('expenses').select('amount').gte('date', monthStart).range(from, to)),
    all('contracts'), getSettings(),
    Promise.all([
      sb.from('surveys').select('id', { count: 'exact', head: true }).eq('status', 'baru'),
      sb.from('issues').select('id', { count: 'exact', head: true }).neq('status', 'selesai'),
      sb.from('waitlist').select('id', { count: 'exact', head: true }).eq('status', 'perlu_dikabari'),
    ]),
  ]);
  const ctr = contracts.map((c) => ({ ...c, ...contractPhase(c, today) }));
  const tenants = activeTenants.map((r) => toCamel(r)!);
  const occ = new Set(tenants.map((t) => t.roomId));
  const eff = (r: Row) => (occ.has(r.id) ? 'terisi' : r.status);
  const unpaid = unpaidRows.map((r) => toCamel(r)!).map((i) => decorate(i, today));
  const overdue = unpaid.filter((i) => i.overdue);
  const dueSoon = unpaid.filter((i) => !i.overdue);
  const sum = (list: Row[], key: string) => list.reduce((a, i) => a + Number(i[key] || 0), 0);
  return {
    today, month, newInvoices: createdCount, isSample: !!s.isSample,
    perProperty: props.filter((p) => p.kind !== 'mitra').sort(bySort).map((p) => {
      const st = rooms.filter((r) => r.propertyId === p.id).map(eff);
      return { id: p.id, name: p.name, total: st.length, terisi: st.filter((x) => x === 'terisi').length, kosong: st.filter((x) => x === 'kosong').length, dipesan: st.filter((x) => x === 'dipesan').length, perbaikan: st.filter((x) => x === 'perbaikan').length };
    }),
    overdue: overdue.length, overdueAmount: sum(overdue, 'amount'),
    dueSoon: dueSoon.length, dueSoonAmount: sum(dueSoon, 'amount'),
    incomeThisMonth: paidMonth.reduce((a, i) => a + Number(i.paid_amount ?? i.amount ?? 0), 0),
    expensesThisMonth: expRows.reduce((a, e) => a + Number(e.amount || 0), 0),
    newSurveys: surveysBaru.count ?? 0,
    proofsPending: unpaid.filter((i) => i.proofStatus === 'menunggu').length,
    openIssues: issuesOpen.count ?? 0,
    endingSoon: tenants.filter((t) => t.endDate && t.endDate <= addMonths(today, 1)).length,
    contractsPending: ctr.filter((c) => c.phase === 'menunggu').length,
    contractsEnding: ctr.filter((c) => c.phase === 'akan_habis' && !c.decision).length,
    contractDecisions: ctr.filter((c) => c.decision && !c.decisionHandledAt).length,
    tenantsWithoutContract: tenants.filter((t) => !ctr.some((c) => c.tenantId === t.id && ['menunggu', 'aktif', 'akan_habis', 'akan_mulai'].includes(c.phase))).length,
    waitlistToNotify: waitlistToNotify.count ?? 0,
    market: await market.adminCounts(),
    community: await community.counts(),
  };
});

// ================================================================ ADMIN — kos & kamar
on('GET', '/admin/properties', async () => (await all('properties')).sort(bySort));
// Kolom kos yang boleh diubah pemilik (admin bisa semuanya, lihat propertyAdminPatch).
export function propertyPatch(b: Row) {
  const patch: Row = pick(b, ['name', 'gender', 'tagline', 'description', 'address', 'mapsQuery', 'city', 'whatsapp', 'bankInfo', 'bookingPolicy', 'visitHours', 'logo']);
  const LONG_TEXT: Record<string, number> = { description: 6000, bookingPolicy: 4000, address: 500, bankInfo: 500, tagline: 400, note: 600 };
  for (const k of Object.keys(patch)) patch[k] = str(patch[k], LONG_TEXT[k] ?? 300);
  if (patch.name !== undefined && !patch.name) throw bad('Isi nama kos.');
  if (patch.gender !== undefined && !['Putra', 'Putri', 'Campur', 'Pasutri'].includes(patch.gender)) patch.gender = 'Campur';
  if (patch.logo !== undefined && patch.logo && !okPhoto(patch.logo)) delete patch.logo;
  for (const k of ['facilities', 'rules', 'nearby']) if (b[k] !== undefined) patch[k] = strList(b[k]);
  if (b.photos !== undefined) patch.photos = photoList(b.photos, 12, 'foto kos');
  if (b.periods !== undefined) {
    const list = (Array.isArray(b.periods) ? b.periods : String(b.periods).split(',')).filter((x: string) => CYCLES.includes(x));
    if (!list.length) throw bad('Pilih minimal satu periode sewa yang dibuka.');
    patch.periods = CYCLES.filter((c) => list.includes(c));
  }
  for (const k of ['chatEnabled', 'waEnabled']) if (b[k] !== undefined) patch[k] = b[k] === true || b[k] === 'on' || b[k] === 'true';
  if (b.minBooking !== undefined) patch.minBooking = num(b.minBooking);
  return patch;
}
function propertyAdminPatch(b: Row) {
  const patch = propertyPatch(b);
  if (b.status !== undefined) { if (!['draf', 'menunggu', 'aktif', 'nonaktif'].includes(b.status)) throw bad('Status kos tidak dikenal.'); patch.status = b.status; }
  if (b.ownerId !== undefined) patch.ownerId = str(b.ownerId, 40) || null;
  if (b.reviewNote !== undefined) patch.reviewNote = str(b.reviewNote, 600);
  if (b.feeType !== undefined) {
    patch.feeType = ['persen', 'nominal'].includes(b.feeType) ? b.feeType : null;
    patch.feeValue = patch.feeType ? Math.max(0, Number(b.feeValue) || 0) : null;
    if (patch.feeType === 'persen' && patch.feeValue > 100) throw bad('Fee persen maksimal 100%.');
  }
  if (b.sort !== undefined) patch.sort = Math.min(999, num(b.sort));
  return patch;
}
const slugify = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'kos';
export async function uniqueSlug(name: string) {
  const base = slugify(name.replace(/^kos\s+/i, '')); let slug = base;
  for (let i = 2; i < 50; i++) { if (!(await q<Row | null>(sb.from('properties').select('id').eq('slug', slug).maybeSingle()))) return slug; slug = `${base}-${i}`; }
  return `${base}-${randomToken(3).toLowerCase()}`;
}
// Kos baru: kos mitra mulai sebagai draf (pemilik melengkapi info & kamar, lalu mengajukan tayang).
export async function createProperty(kind: 'sendiri' | 'mitra', patch: Row) {
  const slug = await uniqueSlug(patch.name);
  return await insert('properties', { id: `kos_${slug.replace(/-/g, '_')}_${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`, slug, kind, status: kind === 'mitra' ? 'draf' : 'aktif', logo: '/assets/img/mark.webp', sort: 50, checkedAt: new Date().toISOString(), ...patch });
}
on('POST', '/admin/properties', async ({ body: b }, log) => {
  const patch = propertyAdminPatch(b);
  if (!patch.name) throw bad('Isi nama kos.');
  const kind = b.kind === 'sendiri' ? 'sendiri' : 'mitra';
  if (kind === 'mitra' && patch.ownerId && !(await one('owners', patch.ownerId))) throw bad('Pemilik kos tidak ditemukan.');
  const rec = await createProperty(kind, patch);
  log({ action: 'property.create', summary: `Menambah kos ${rec.name}${kind === 'mitra' ? ' (mitra)' : ''}`, target: rec.name });
  return created(rec);
});
on('PUT', '/admin/properties/:id', async ({ params, body: b }, log) => {
  const patch = propertyAdminPatch(b);
  if (patch.ownerId && !(await one('owners', patch.ownerId))) throw bad('Pemilik kos tidak ditemukan.');
  const before = await one('properties', params.id);
  if (patch.status === 'aktif' && before?.status !== 'aktif') patch.reviewNote = patch.reviewNote ?? '';
  const rec = await update('properties', params.id, patch);
  if (before && patch.status && patch.status !== before.status) background(market.propertyStatusChanged(rec, before.status));
  log({ action: 'property.update', summary: patch.status && patch.status !== before?.status ? `Mengubah status ${rec.name} menjadi ${patch.status}` : `Mengubah info ${rec.name}`, target: rec.name });
  return rec;
});

const STATUS_KAMAR = ['kosong', 'terisi', 'dipesan', 'perbaikan'];
export function roomFromBody(b: Row) {
  const r: Row = {};
  for (const [k, m] of [['propertyId', 60], ['code', 20], ['type', 60], ['floor', 20], ['sizeM2', 20], ['note', 300]] as const) if (b[k] !== undefined) r[k] = str(b[k], m);
  for (const k of ['priceDaily', 'priceMonthly', 'priceSemester', 'priceYearly', 'extraPersonFee']) if (b[k] !== undefined) r[k] = num(b[k]);
  if (b.capacity !== undefined) r.capacity = Number(b.capacity) === 2 ? 2 : 1;
  if (b.extraPersonPeriod !== undefined) r.extraPersonPeriod = b.extraPersonPeriod === 'tahunan' ? 'tahunan' : 'bulanan';
  if (b.facilities !== undefined) r.facilities = strList(b.facilities);
  if (b.photos !== undefined) r.photos = photoList(b.photos, 12, 'foto kamar');
  if (b.hidden !== undefined) r.hidden = !!b.hidden;
  if (b.status !== undefined) { if (!STATUS_KAMAR.includes(b.status)) throw bad('Status kamar tidak dikenal.'); r.status = b.status; }
  return r;
}
on('GET', '/admin/rooms', async () => {
  const [rooms, tenants] = await Promise.all([all('rooms'), q<Row[]>(sb.from('tenants').select('id, name, room_id').eq('status', 'aktif'))]);
  const occ = new Map((tenants || []).map((t) => [t.room_id, { id: t.id, name: t.name }]));
  return rooms.map((r) => ({ ...r, effectiveStatus: occ.has(r.id) ? 'terisi' : r.status, tenant: occ.get(r.id) ?? null })).sort(byCode);
});
on('POST', '/admin/rooms', async ({ body }, log) => {
  const r = roomFromBody(body);
  if (!r.code) throw bad('Isi nomor/kode kamar.');
  const prop = await one('properties', r.propertyId);
  if (!prop) throw bad('Pilih kos untuk kamar ini.');
  const rec = await insert('rooms', { status: 'kosong', ...r });
  if (rec.status === 'kosong') await matchWaitlist(rec.id);
  log({ action: 'room.create', summary: `Menambah kamar ${rec.code} di ${prop.name}`, target: rec.code });
  return created(rec);
});
on('PUT', '/admin/rooms/:id', async ({ params, body }, log) => {
  const r = roomFromBody(body); delete r.propertyId;
  const before = await one('rooms', params.id);
  const rec = await update('rooms', params.id, r);
  const keys = Object.keys(r);
  const waiting = rec.status === 'kosong' && (before?.status !== 'kosong' || before?.hidden !== rec.hidden) ? await matchWaitlist(rec.id) : 0;
  if (waiting) (rec as Row).waitlistMatched = waiting;
  log(keys.length === 1 && keys[0] === 'status'
    ? { action: 'room.status', summary: `Mengubah status kamar ${rec.code} menjadi ${STATUS_LABEL[rec.status] || rec.status}`, target: rec.code }
    : { action: 'room.update', summary: `Mengubah data kamar ${rec.code}`, target: rec.code });
  return rec;
});
on('DELETE', '/admin/rooms/:id', async ({ params }, log) => {
  const cur = await one('rooms', params.id);
  if (!cur) throw notFound('Kamar tidak ditemukan.');
  // Reservasi yang sedang berjalan akan kehilangan kamarnya bila baris ini dihapus.
  const used = await sb.from('leads').select('id', { count: 'exact', head: true }).eq('room_id', cur.id)
    .in('status', ['baru', 'menunggu_dp', 'dp_dikirim', 'dp_diterima', 'berhasil']);
  if ((used.count ?? 0) > 0) throw bad('Kamar ini masih punya reservasi berjalan. Sembunyikan saja dari website.');
  if (await activeInRoom(cur.id)) throw bad('Kamar ini masih ditempati penghuni aktif.');
  const out = await remove('rooms', params.id);
  log({ action: 'room.delete', summary: `Menghapus kamar ${cur?.code || ''}`, target: cur?.code });
  return out;
});

// ================================================================ ADMIN — penghuni
function tenantFromBody(b: Row) {
  const t: Row = {};
  for (const k of ['name', 'phone', 'occupation', 'origin', 'emergencyName', 'emergencyPhone', 'emergencyRelation', 'note', 'coName', 'coPhone', 'coRelation', 'coOccupation']) if (b[k] !== undefined) t[k] = str(b[k], k === 'note' ? 600 : 120);
  if (b.email !== undefined) t.email = emailField(b.email);
  if (b.roomId !== undefined) t.roomId = str(b.roomId, 40);
  if (b.leadId !== undefined) t.leadId = str(b.leadId, 40) || null;
  if (b.rentCycle !== undefined) { if (!CYCLES.includes(b.rentCycle)) throw bad('Pilih sewa harian, bulanan, 6 bulanan, atau tahunan.'); t.rentCycle = b.rentCycle; }
  if (b.rentAmount !== undefined) t.rentAmount = num(b.rentAmount);
  if (b.deposit !== undefined) t.deposit = num(b.deposit);
  for (const k of ['startDate', 'endDate', 'billFrom']) if (b[k] !== undefined) { if (b[k] && !isDate(b[k])) throw bad('Format tanggal tidak benar.'); t[k] = b[k] || null; }
  return t;
}
const activeInRoom = async (roomId: string) => !!(await q<Row | null>(sb.from('tenants').select('id').eq('room_id', roomId).eq('status', 'aktif').maybeSingle()));

on('GET', '/admin/tenants', async () => {
  const [tenants, rooms, invs] = await Promise.all([all('tenants'), all('rooms'), q<Row[]>(sb.from('invoices').select('tenant_id, amount, due_date, status').eq('status', 'belum'))]);
  const roomMap = new Map(rooms.map((r) => [r.id, r])); const today = todayStr();
  return tenants.map((t): Row => {
    const mine = (invs || []).filter((i) => i.tenant_id === t.id);
    const r = roomMap.get(t.roomId);
    return {
      ...tenantPublic(t),
      room: r ? pick(r, ['id', 'code', 'propertyId']) : null,
      unpaidCount: mine.length, unpaidAmount: mine.reduce((a, i) => a + i.amount, 0), overdue: mine.some((i) => i.due_date < today),
    };
  }).sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'aktif' ? -1 : 1));
});
on('POST', '/admin/tenants', async ({ body }, log) => {
  const t = tenantFromBody(body);
  if (!t.name) throw bad('Isi nama penghuni.');
  const room = t.roomId ? await one('rooms', t.roomId) : null;
  if (!room) throw bad('Pilih kamar.');
  if (await activeInRoom(room.id)) throw bad('Kamar ini masih ditempati penghuni aktif.');
  if (!t.startDate) throw bad('Isi tanggal mulai sewa.');
  t.rentCycle ||= 'bulanan';
  if (!t.rentAmount) t.rentAmount = roomPrice(room, t.rentCycle);
  if (t.rentCycle === 'harian' && !t.endDate) throw bad('Untuk sewa harian, isi tanggal keluar supaya tagihan menghitung jumlah malam.');
  if (t.coName && Number(room.capacity || 1) < 2) throw bad(`Kamar ${room.code} hanya untuk 1 orang. Ubah kapasitas kamar menjadi 2 orang dulu.`);
  // Akun login dicek dulu supaya penghuni tidak terlanjur dibuat bila username bentrok/kata sandi terlalu pendek.
  const wantsAccount = !!str(body.username, 60);
  if (wantsAccount) {
    const u = str(body.username, 60).toLowerCase();
    if (!USERNAME_RE.test(u)) throw bad('Username 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda minus. Tanpa spasi.');
    const takenBy = await usernameTakenAnywhere(u);
    if (takenBy) throw bad(`Username "${u}" sudah dipakai akun ${takenBy} lain. Pilih username lain.`);
    if (String(body.password || '').length < 8) throw bad('Kata sandi minimal 8 karakter.');
  }
  const rec = await insert('tenants', { status: 'aktif', ...t });
  let account: Row | null = null;
  try {
    await update('rooms', room.id, { status: 'terisi' });
    if (rec.leadId) await q(sb.from('leads').update({ tenant_id: rec.id }).eq('id', rec.leadId));
    await generateInvoices(rec.id);
    account = wantsAccount ? await setAccount(rec, { username: body.username, password: body.password, enabled: true }) : null;
    if (!account) await ensureCardCode(rec);
  } catch (e) {
    // Tanpa transaksi: bila langkah mana pun gagal (mis. username bentrok di indeks unik), seluruh
    // jejaknya dibatalkan supaya kamar tidak tertinggal terisi dan tagihan tidak menggantung.
    await Promise.allSettled([
      sb.from('invoices').delete().eq('tenant_id', rec.id),
      sb.from('tenant_sessions').delete().eq('tenant_id', rec.id),
      sb.from('tenants').delete().eq('id', rec.id),
      sb.from('rooms').update({ status: 'kosong' }).eq('id', room.id),
      rec.leadId ? sb.from('leads').update({ tenant_id: null }).eq('id', rec.leadId) : Promise.resolve(),
    ]);
    throw e;
  }
  if (rec.email) mail.send({
    to: rec.email, kind: 'tenant.welcome', dedupeKey: `tenant.welcome:${rec.id}`,
    subject: `Selamat datang di ${(await one('properties', room.propertyId))?.name || 'Bonaasina'}`, title: `Selamat datang, ${rec.name}`,
    intro: 'Data Anda sebagai penghuni sudah kami catat. Tagihan, kuitansi, kontrak, pengumuman, dan laporan kerusakan akan dikabarkan lewat email ini.',
    rows: [['Kamar', room.code], ['Mulai sewa', tanggal(rec.startDate)], ['Sewa', `${rupiah(rec.rentAmount)} per ${CYCLE_WORD[rec.rentCycle] || 'bulan'}`], ['Username dashboard', account?.username || '']],
    note: account ? 'Kata sandi diberikan langsung oleh pengelola. Segera ganti setelah masuk pertama kali.' : '',
    cta: account ? { label: 'Masuk ke dashboard penghuni', url: PENGHUNI_URL } : undefined,
  });
  log({ action: 'tenant.create', summary: `Menambah penghuni ${rec.name} di kamar ${room.code}${account ? ` dengan akun login ${account.username}` : ''}`, target: room.code });
  return created({ ...tenantPublic(rec), username: account?.username ?? null, loginEnabled: !!account });
});
on('PUT', '/admin/tenants/:id', async ({ params, body }, log) => {
  const t = tenantFromBody(body); const cur = await one('tenants', params.id);
  if (!cur) throw notFound('Penghuni tidak ditemukan.');
  const moving = !!(t.roomId && t.roomId !== cur.roomId);
  if (moving) {
    const dest = await one('rooms', t.roomId!);
    if (!dest) throw bad('Kamar tujuan tidak ditemukan.');
    if (cur.status === 'aktif' && (await activeInRoom(t.roomId!))) throw bad('Kamar tujuan masih ditempati.');
  }
  // Semua penolakan (mis. kapasitas kamar) terjadi sebelum status kamar diubah.
  if (t.coName) { const room = await one('rooms', t.roomId || cur.roomId); if (Number(room?.capacity || 1) < 2) throw bad(`Kamar ${room?.code || ''} hanya untuk 1 orang. Ubah kapasitas kamar menjadi 2 orang dulu.`); }
  const rec = await update('tenants', params.id, t);
  // Penghuni yang sudah keluar tidak menempati kamar, jadi status kamar tidak diubah untuknya.
  if (moving && cur.status === 'aktif') {
    await update('rooms', cur.roomId, { status: 'kosong' });
    await update('rooms', t.roomId!, { status: 'terisi' });
  }
  if (moving) background(matchWaitlist(cur.roomId));
  log({ action: 'tenant.update', summary: `Mengubah data penghuni ${rec.name}` });
  return tenantPublic(rec);
});
on('POST', '/admin/tenants/:id/checkout', async ({ params, body }, log) => {
  const cur = await one('tenants', params.id); if (!cur) throw notFound('Penghuni tidak ditemukan.');
  // Sekali saja: mencatat keluar untuk penghuni yang sudah keluar akan menimpa tanggal dan menghapus tagihan.
  if (cur.status !== 'aktif') throw bad(`${cur.name} sudah tercatat keluar${cur.endDate ? ` per ${tanggal(cur.endDate)}` : ''}.`);
  const endDate = isDate(body.endDate) ? body.endDate : todayStr();
  await update('tenants', cur.id, { status: 'keluar', endDate, portalTokenHash: null });
  await q(sb.from('tenant_sessions').delete().eq('tenant_id', cur.id)); tenantCache.clear();
  // Kamar hanya dikosongkan bila tidak ada penghuni pengganti di kamar yang sama.
  if (!(await activeInRoom(cur.roomId))) await update('rooms', cur.roomId, { status: 'kosong' });
  const waiting = await matchWaitlist(cur.roomId);
  // Tagihan yang sudah dibayar / sedang diperiksa buktinya tidak dihapus.
  await q(sb.from('invoices').delete().eq('tenant_id', cur.id).eq('status', 'belum').is('proof_path', null).gte('period_start', endDate));
  const room = await one('rooms', cur.roomId);
  log({ action: 'tenant.checkout', summary: `Mencatat ${cur.name} keluar per ${tanggal(endDate)}${waiting ? `; ${waiting} orang di daftar tunggu perlu dikabari` : ''}`, target: room?.code });
  return { ok: true, waitlistMatched: waiting };
});
// ================================================================ ADMIN — tagihan
on('GET', '/admin/invoices', async () => {
  await generateInvoicesThrottled();
  const [invs, tenants, rooms] = await Promise.all([all('invoices', 'due_date'), all('tenants'), all('rooms')]);
  const tm = new Map(tenants.map((t) => [t.id, t])); const rm = new Map(rooms.map((r) => [r.id, r]));
  return invs.map((i): Row => ({ ...decorate(i), tenantName: tm.get(i.tenantId)?.name || '(dihapus)', tenantPhone: tm.get(i.tenantId)?.phone || '', roomCode: rm.get(i.roomId)?.code || '-' }))
    .sort((a, b) => (a.status === b.status ? a.dueDate.localeCompare(b.dueDate) : a.status === 'belum' ? -1 : 1));
});
on('POST', '/admin/invoices', async ({ body: b }, log) => {
  const t = await one('tenants', str(b.tenantId, 40)); if (!t) throw bad('Pilih penghuni.');
  if (!num(b.amount)) throw bad('Isi jumlah tagihan.'); if (!isDate(b.dueDate)) throw bad('Isi tanggal jatuh tempo.');
  const room = await one('rooms', t.roomId);
  const rec = await insert('invoices', { tenantId: t.id, roomId: t.roomId, propertyId: room?.propertyId ?? null, periodStart: null, periodLabel: str(b.label, 120) || 'Tagihan tambahan', cycle: 'manual', dueDate: b.dueDate, amount: num(b.amount), status: 'belum', note: str(b.note, 300) });
  mailNewInvoices([t], [rec]);
  log({ action: 'invoice.create', summary: `Membuat tagihan tambahan untuk ${t.name}: ${rec.periodLabel} (${rupiah(rec.amount)})`, target: room?.code });
  return created(rec);
});
on('POST', '/admin/invoices/:id/pay', async ({ params, body: b }, log) => {
  const inv = await one('invoices', params.id); if (!inv) throw notFound('Tagihan tidak ditemukan.');
  const d = await invoiceDesc(inv.id);
  const rec = await update('invoices', inv.id, {
    status: 'lunas', paidAt: isDate(b.paidAt) ? b.paidAt : todayStr(),
    paidAmount: b.paidAmount !== undefined && b.paidAmount !== '' ? num(b.paidAmount) : inv.amount,
    method: ['tunai', 'transfer', 'qris', 'lainnya'].includes(b.method) ? b.method : 'transfer',
    note: b.note !== undefined ? str(b.note, 300) : inv.note,
    proofStatus: inv.proofPath ? 'diterima' : inv.proofStatus,
  });
  // Kuitansi bernomor diterbitkan saat pembayaran diverifikasi.
  const withReceipt = rec.receiptNo ? rec : await issueReceipt(rec);
  const payer = await one('tenants', inv.tenantId);
  if (payer?.email) mail.send({
    to: payer.email, kind: 'invoice.paid', dedupeKey: `invoice.paid:${inv.id}:${withReceipt.receiptNo}`,
    subject: `Pembayaran ${inv.periodLabel} diterima`, title: 'Pembayaran diterima, terima kasih',
    intro: `Horas ${payer.name}, pembayaran Anda sudah kami catat lunas.`,
    rows: [['Tagihan', inv.periodLabel], ['Dibayar', rupiah(withReceipt.paidAmount ?? inv.amount)], ['Tanggal', tanggal(withReceipt.paidAt)], ['Nomor kuitansi', withReceipt.receiptNo]],
    note: 'Kuitansi PDF bisa diunduh di dashboard penghuni, menu Tagihan.', cta: { label: 'Buka dashboard penghuni', url: PENGHUNI_URL },
  });
  log({ action: 'invoice.pay', summary: `Menandai lunas tagihan ${d.text}${inv.proofStatus === 'menunggu' ? ' (bukti diterima)' : ''}, kuitansi ${withReceipt.receiptNo}`, target: d.target });
  return withReceipt;
});
on('POST', '/admin/invoices/:id/unpay', async ({ params }, log) => {
  const rec = await update('invoices', params.id, { status: 'belum', paidAt: null, paidAmount: null, method: null, proofStatus: null, receiptNo: null, receiptCode: null, receiptIssuedAt: null });
  const d = await invoiceDesc(params.id);
  log({ action: 'invoice.unpay', summary: `Membatalkan status lunas tagihan ${d.text}`, target: d.target });
  return rec;
});
on('POST', '/admin/invoices/:id/reject-proof', async ({ params, body }, log) => {
  const note = str(body.note, 300); if (!note) throw bad('Tulis alasan agar penghuni tahu apa yang perlu diperbaiki.');
  const rec = await update('invoices', params.id, { proofStatus: 'ditolak', proofNote: note });
  const payer = await one('tenants', rec.tenantId);
  if (payer?.email) mail.send({
    to: payer.email, kind: 'invoice.proof_rejected', dedupeKey: `invoice.proof_rejected:${rec.id}:${rec.proofPath || ''}`,
    subject: `Bukti bayar ${rec.periodLabel} perlu diperbaiki`, title: 'Bukti bayar belum bisa diterima',
    intro: `Horas ${payer.name}, bukti bayar untuk tagihan ${rec.periodLabel} (${rupiah(rec.amount)}) belum bisa kami terima.`,
    rows: [['Alasan', note]], note: 'Silakan unggah ulang bukti yang benar di dashboard penghuni.', cta: { label: 'Unggah ulang bukti', url: PENGHUNI_URL },
  });
  const d = await invoiceDesc(params.id);
  log({ action: 'invoice.reject_proof', summary: `Menolak bukti bayar ${d.text}: ${note}`, target: d.target });
  return rec;
});
on('PUT', '/admin/invoices/:id', async ({ params, body: b }, log) => {
  const patch: Row = {};
  if (b.amount !== undefined) patch.amount = num(b.amount);
  if (b.dueDate !== undefined) { if (!isDate(b.dueDate)) throw bad('Format tanggal tidak benar.'); patch.dueDate = b.dueDate; }
  if (b.note !== undefined) patch.note = str(b.note, 300);
  const rec = await update('invoices', params.id, patch);
  const d = await invoiceDesc(params.id);
  log({ action: 'invoice.update', summary: `Mengubah tagihan ${d.text}`, target: d.target });
  return rec;
});
on('DELETE', '/admin/invoices/:id', async ({ params }, log) => {
  const d = await invoiceDesc(params.id);
  const inv = await one('invoices', params.id);
  // Tagihan periode tetap (sewa) yang dihapus dicatat supaya tidak dibuat ulang oleh pembuatan otomatis.
  if (inv?.tenantId && inv?.periodStart) {
    try {
      await q(sb.from('invoice_skips').upsert({ tenant_id: inv.tenantId, period_start: inv.periodStart, reason: 'dihapus admin' }, { onConflict: 'tenant_id,period_start', ignoreDuplicates: true }));
    } catch (e) { console.error('invoice_skips belum tersedia', e); }
  }
  const out = await remove('invoices', params.id);
  log({ action: 'invoice.delete', summary: `Menghapus tagihan ${d.text}`, target: d.target });
  return out;
});
on('GET', '/admin/invoices/:id/reminder', async ({ params, url }, log) => {
  const inv = await one('invoices', params.id); if (!inv) throw notFound('Tagihan tidak ditemukan.');
  const [t, room, s] = await Promise.all([one('tenants', inv.tenantId), one('rooms', inv.roomId), getSettings()]);
  if (!t?.phone && !t?.email) throw bad('Penghuni ini belum punya nomor WhatsApp atau email.');
  const prop = room ? await one('properties', room.propertyId) : null;
  const site = str(url.searchParams.get('site'), 200).replace(/\/$/, '');
  const d = decorate(inv);
  const text = String(s.reminderTemplate || DEFAULT_TEMPLATE)
    .replaceAll('{nama}', t.name || '').replaceAll('{kos}', prop?.name || 'Bonaasina').replaceAll('{kamar}', room?.code || '')
    .replaceAll('{periode}', inv.periodLabel || '').replaceAll('{jumlah}', rupiah(inv.amount)).replaceAll('{jatuh_tempo}', tanggal(inv.dueDate))
    .replaceAll('{keterlambatan}', d.overdue ? ` Saat ini sudah lewat ${d.overdueDays} hari.` : '')
    .replaceAll('{rekening}', s.paymentInfo || '-').replaceAll('{portal}', site ? `${site}/penghuni/` : '');
  await update('invoices', inv.id, { lastRemindedAt: new Date().toISOString() });
  if (t.email) mail.send({
    to: t.email, kind: 'invoice.reminder', dedupeKey: `invoice.reminder:${inv.id}:${todayStr()}`,
    subject: d.overdue ? `Tagihan ${inv.periodLabel} sudah lewat jatuh tempo` : `Pengingat tagihan ${inv.periodLabel}`,
    title: d.overdue ? `Tagihan lewat ${d.overdueDays} hari` : 'Pengingat tagihan sewa',
    intro: `Horas ${t.name}, ini pengingat dari ${prop?.name || 'Bonaasina'}.`,
    rows: [['Kamar', room?.code || ''], ['Tagihan', inv.periodLabel], ['Jumlah', rupiah(inv.amount)], ['Jatuh tempo', tanggal(inv.dueDate)], ['Rekening', s.paymentInfo || '']],
    note: 'Setelah bayar, unggah bukti transfer di dashboard penghuni.', cta: { label: 'Buka dashboard penghuni', url: PENGHUNI_URL },
  });
  log({ action: 'invoice.remind', summary: `Membuat pengingat ${t.phone ? 'WhatsApp' : ''}${t.phone && t.email ? ' & ' : ''}${t.email ? 'email' : ''} untuk ${t.name}, ${inv.periodLabel}`, target: room?.code });
  return { text, url: t.phone ? waLink(t.phone, text) : null, emailedTo: t.email || null };
});
// Tautan sementara (5 menit) untuk melihat bukti bayar / foto kerusakan
on('GET', '/admin/file', async ({ url }, log) => {
  const path = str(url.searchParams.get('path'), 300);
  if (!/^(proofs|issues|inspections|chores|faces|contracts|leads)\/[\w-]+\/[\w.-]+$/.test(path)) throw bad('Alamat file tidak valid.');
  const out = { url: await signedUrl(path) };
  const isLead = path.startsWith('leads/');
  const who = isLead ? await one('leads', path.split('/')[1]) : await one('tenants', path.split('/')[1]);
  const what: Record<string, string> = { proofs: 'bukti bayar', issues: 'foto kerusakan', inspections: 'foto kondisi kamar', chores: 'foto piket', faces: 'foto profil', contracts: 'PDF kontrak', leads: 'bukti transfer reservasi' };
  log({ action: 'file.view', summary: `Melihat ${what[path.split('/')[0]]} ${who?.name || ''}`.trim() });
  return out;
});

// ================================================================ ADMIN — survei, kerusakan, pengeluaran
on('GET', '/admin/surveys', async () => {
  const [list, props, rooms] = await Promise.all([all('surveys'), all('properties'), all('rooms')]);
  const pm = new Map(props.map((p) => [p.id, p.name])); const rm = new Map(rooms.map((r) => [r.id, r.code]));
  return list.map((s) => ({
    ...s, propertyName: pm.get(s.propertyId) || '-', roomCode: s.roomId ? rm.get(s.roomId) : null,
    waUrl: waLink(s.phone, `Horas ${s.name}, terima kasih sudah mendaftar survei di ${pm.get(s.propertyId) || 'Bonaasina'} untuk ${tanggal(s.date)}${s.time ? ' ' + s.time : ''}. `),
  })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
});
on('PUT', '/admin/surveys/:id', async ({ params, body: b }, log) => {
  const patch: Row = {};
  if (b.status !== undefined) { if (!['baru', 'dikonfirmasi', 'selesai', 'batal'].includes(b.status)) throw bad('Status tidak dikenal.'); patch.status = b.status; }
  if (b.ownerNote !== undefined) patch.ownerNote = str(b.ownerNote, 2000);
  const before = await one('surveys', params.id);
  const rec = await update('surveys', params.id, patch);
  if (rec.email && patch.status && patch.status !== before?.status && ['dikonfirmasi', 'batal'].includes(patch.status)) {
    const prop = await one('properties', rec.propertyId);
    const ok = patch.status === 'dikonfirmasi';
    mail.send({
      to: rec.email, kind: `survey.${patch.status}`, dedupeKey: `survey.${patch.status}:${rec.id}:${rec.date}`,
      subject: ok ? `Jadwal survei ${prop?.name || ''} dikonfirmasi` : `Jadwal survei ${prop?.name || ''} dibatalkan`,
      title: ok ? 'Jadwal survei dikonfirmasi' : 'Jadwal survei dibatalkan',
      intro: ok ? `Horas ${rec.name}, kami tunggu kedatangan Anda.` : `Horas ${rec.name}, mohon maaf jadwal survei Anda dibatalkan. Hubungi kami lewat WhatsApp untuk mengatur ulang.`,
      rows: [['Kos', prop?.name || '-'], ['Alamat', ok ? prop?.address || '' : ''], ['Jadwal', `${tanggal(rec.date)}${rec.time ? `, ${rec.time}` : ''}`], ['Catatan pengelola', rec.ownerNote || '']],
      cta: ok && prop?.mapsQuery ? { label: 'Buka lokasi di Google Maps', url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(prop.mapsQuery)}` } : undefined,
    });
  }
  log({ action: 'survey.update', summary: `Mengubah status survei ${rec.name} menjadi ${STATUS_LABEL[rec.status] || rec.status}` });
  return rec;
});
on('DELETE', '/admin/surveys/:id', async ({ params }, log) => {
  const cur = await one('surveys', params.id);
  const out = await remove('surveys', params.id);
  log({ action: 'survey.delete', summary: `Menghapus permintaan survei ${cur?.name || ''}`.trim() });
  return out;
});

on('GET', '/admin/issues', async () => {
  const [list, tenants, rooms, props] = await Promise.all([all('issues'), all('tenants'), all('rooms'), all('properties')]);
  const tm = new Map(tenants.map((t) => [t.id, t])); const rm = new Map(rooms.map((r) => [r.id, r.code])); const pm = new Map(props.map((p) => [p.id, p.name]));
  return list.map((i) => ({
    ...i, tenantName: tm.get(i.tenantId)?.name || '-', roomCode: rm.get(i.roomId) || '-', propertyName: pm.get(i.propertyId) || '-',
    waUrl: tm.get(i.tenantId)?.phone ? waLink(tm.get(i.tenantId)!.phone, `Horas ${tm.get(i.tenantId)!.name}, soal laporan "${i.title}" di kamar ${rm.get(i.roomId) || ''}: `) : null,
  })).sort((a, b) => (a.status === 'selesai') === (b.status === 'selesai') ? b.createdAt.localeCompare(a.createdAt) : a.status === 'selesai' ? 1 : -1);
});
on('PUT', '/admin/issues/:id', async ({ params, body: b }, log) => {
  const patch: Row = {};
  if (b.status !== undefined) { if (!['baru', 'dikerjakan', 'selesai'].includes(b.status)) throw bad('Status tidak dikenal.'); patch.status = b.status; }
  if (b.ownerNote !== undefined) patch.ownerNote = str(b.ownerNote, 2000);
  const before = await one('issues', params.id);
  const rec = await update('issues', params.id, patch);
  if (patch.status && patch.status !== before?.status) {
    const reporter = await one('tenants', rec.tenantId);
    if (reporter?.email) mail.send({
      to: reporter.email, kind: 'issue.status', dedupeKey: `issue.status:${rec.id}:${rec.status}`,
      subject: `Laporan "${rec.title}": ${STATUS_LABEL[rec.status] || rec.status}`, title: rec.status === 'selesai' ? 'Laporan kerusakan selesai ditangani' : 'Laporan kerusakan sedang dikerjakan',
      intro: `Horas ${reporter.name}, ada kabar soal laporan Anda.`,
      rows: [['Masalah', rec.title], ['Status', STATUS_LABEL[rec.status] || rec.status], ['Catatan pengelola', rec.ownerNote || '']],
      cta: { label: 'Lihat di dashboard', url: PENGHUNI_URL },
    });
  }
  log({ action: 'issue.update', summary: `Memperbarui laporan "${rec.title}" menjadi ${STATUS_LABEL[rec.status] || rec.status}` });
  return rec;
});

on('GET', '/admin/expenses', async () => (await all('expenses')).sort((a, b) => b.date.localeCompare(a.date)));
on('POST', '/admin/expenses', async ({ body: b }, log) => {
  if (!isDate(b.date)) throw bad('Isi tanggal pengeluaran.'); if (!num(b.amount)) throw bad('Isi jumlah pengeluaran.');
  const propertyId = b.propertyId && (await one('properties', str(b.propertyId, 60))) ? str(b.propertyId, 60) : null;
  const rec = await insert('expenses', { date: b.date, amount: num(b.amount), category: str(b.category, 60) || 'Lainnya', propertyId, note: str(b.note, 300) });
  log({ action: 'expense.create', summary: `Mencatat pengeluaran ${rec.category} ${rupiah(rec.amount)} (${tanggal(rec.date)})` });
  return created(rec);
});
on('DELETE', '/admin/expenses/:id', async ({ params }, log) => {
  const cur = await one('expenses', params.id);
  const out = await remove('expenses', params.id);
  log({ action: 'expense.delete', summary: `Menghapus pengeluaran ${cur?.category || ''} ${cur ? rupiah(cur.amount) : ''}`.trim() });
  return out;
});

// ================================================================ ADMIN — laporan
async function report(year: string) {
  const [props, invs, exps] = await Promise.all([all('properties'), q<Row[]>(sb.from('invoices').select('*').eq('status', 'lunas').gte('paid_at', `${year}-01-01`).lte('paid_at', `${year}-12-31`)), q<Row[]>(sb.from('expenses').select('*').gte('date', `${year}-01-01`).lte('date', `${year}-12-31`))]);
  const paidAll = (invs || []).map((r) => toCamel(r)!); const expAll = (exps || []).map((r) => toCamel(r)!);
  const ps = props.sort(bySort);
  const months = Array.from({ length: 12 }, (_, m) => {
    const key = `${year}-${pad(m + 1)}`;
    const paid = paidAll.filter((i) => i.paidAt.startsWith(key)); const exp = expAll.filter((e) => e.date.startsWith(key));
    const income = paid.reduce((a, i) => a + (i.paidAmount ?? i.amount), 0); const expense = exp.reduce((a, e) => a + e.amount, 0);
    const byProp = Object.fromEntries(ps.map((p) => [p.id, { income: paid.filter((i) => i.propertyId === p.id).reduce((a, i) => a + (i.paidAmount ?? i.amount), 0), expense: exp.filter((e) => e.propertyId === p.id).reduce((a, e) => a + e.amount, 0) }]));
    return { month: key, income, expense, net: income - expense, byProp, payments: paid.length };
  });
  const totals = months.reduce((t, m) => ({ income: t.income + m.income, expense: t.expense + m.expense }), { income: 0, expense: 0 });
  return { year, properties: ps.map((p) => pick(p, ['id', 'name'])), months, totals: { ...totals, net: totals.income - totals.expense }, _raw: { paidAll, expAll } };
}
const yearOf = (url: URL) => (/^\d{4}$/.test(url.searchParams.get('year') || '') ? url.searchParams.get('year')! : todayStr().slice(0, 4));
on('GET', '/admin/reports', async ({ url }) => { const r = await report(yearOf(url)); delete (r as Row)._raw; return r; });
on('GET', '/admin/reports.csv', async ({ url }, log) => {
  const year = yearOf(url); const r = await report(year);
  log({ action: 'report.download', summary: `Mengunduh laporan keuangan ${year} (CSV)` });
  const [tenants, rooms, props] = await Promise.all([all('tenants'), all('rooms'), all('properties')]);
  const tm = new Map(tenants.map((t) => [t.id, t.name])); const rm = new Map(rooms.map((x) => [x.id, x.code])); const pm = new Map(props.map((p) => [p.id, p.name]));
  const esc = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const rows = [
    ...r._raw.paidAll.map((i) => [i.paidAt, 'Pembayaran sewa', pm.get(i.propertyId), rm.get(i.roomId), tm.get(i.tenantId), i.periodLabel, i.method, i.paidAmount ?? i.amount, 0]),
    ...r._raw.expAll.map((e) => [e.date, 'Pengeluaran', pm.get(e.propertyId) || 'Umum', '', e.category, e.note, '', 0, e.amount]),
  ].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const csv = '\uFEFF' + [['Tanggal', 'Jenis', 'Kos', 'Kamar', 'Nama/Kategori', 'Keterangan', 'Metode', 'Masuk', 'Keluar'], ...rows].map((x) => x.map(esc).join(',')).join('\r\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="laporan-bonaasina-${year}.csv"` } });
});

// ================================================================ ADMIN — pengaturan, unggah, cadangan
const SETTING_FIELDS = ['siteName', 'tagline', 'ownerName', 'whatsapp', 'paymentInfo', 'paymentMethods', 'depositInfo', 'reminderTemplate', 'invoiceLeadDays', 'surveyHours',
  'bonaBankInfo', 'waTemplateConfirm', 'waTemplateReject', 'marketIntro', 'ownBankInfo', 'brandLogo', 'notifyEmail'];
const SETTING_NUMBERS: Record<string, [number, number]> = { invoiceLeadDays: [0, 60], feeDueDays: [1, 30], dpHours: [1, 168], leadResponseHours: [1, 168] };
on('GET', '/admin/settings', async () => ({ ...market.marketDefaults(), ...(await getSettings()), defaultReminderTemplate: DEFAULT_TEMPLATE, defaultContractTemplate: DEFAULT_CONTRACT_TEMPLATE, defaultInspectionItems: DEFAULT_INSPECTION_ITEMS, ...market.marketTemplates() }));
on('PUT', '/admin/settings', async ({ body: b }, log) => {
  const cur = await getSettings(); const patch: Row = {};
  for (const k of SETTING_FIELDS) if (b[k] !== undefined && k !== 'invoiceLeadDays') patch[k] = str(b[k], 2000);
  if (patch.brandLogo && !okPhoto(patch.brandLogo)) patch.brandLogo = '';
  if (patch.notifyEmail !== undefined) {
    const list = patch.notifyEmail.toLowerCase().split(/[\s,;]+/).filter(Boolean);
    if (list.some((e: string) => !isEmail(e))) throw bad('Email notifikasi admin belum benar. Pisahkan beberapa alamat dengan koma.');
    patch.notifyEmail = list.slice(0, 5).join(', ');
  }
  for (const [k, [lo, hi]] of Object.entries(SETTING_NUMBERS)) if (b[k] !== undefined && b[k] !== '') patch[k] = Math.max(lo, Math.min(num(b[k]), hi));
  if (b.feeDefaultType !== undefined) patch.feeDefaultType = b.feeDefaultType === 'nominal' ? 'nominal' : 'persen';
  if (b.feeDefaultValue !== undefined) {
    patch.feeDefaultValue = Math.max(0, Number(b.feeDefaultValue) || 0);
    if ((patch.feeDefaultType || cur.feeDefaultType || 'persen') === 'persen' && patch.feeDefaultValue > 100) throw bad('Fee persen maksimal 100%.');
  }
  if (b.heroWords !== undefined) patch.heroWords = strList(b.heroWords, 8);
  if (b.contractTemplate !== undefined) patch.contractTemplate = String(b.contractTemplate || '').replace(/\r/g, '').slice(0, 30000).trim();
  if (b.inspectionItems !== undefined) patch.inspectionItems = strList(b.inspectionItems, 40);
  if (b.isSample !== undefined) patch.isSample = !!b.isSample;
  if (b.faq !== undefined) {
    if (!Array.isArray(b.faq)) throw bad('Format tanya jawab tidak benar.');
    const faq = b.faq.map((f: Row) => ({ q: str(f.q, 200), a: str(f.a, 1200) }));
    if (faq.length > 20) throw bad('Maksimal 20 tanya jawab.');
    // Pertanyaan tanpa jawaban (dan sebaliknya) ditolak dengan pesan, bukan dibuang diam-diam.
    const half = faq.find((f: Row) => !!f.q !== !!f.a);
    if (half) throw bad(`Tanya jawab "${str(half.q || '(tanpa pertanyaan)', 60)}" harus diisi pertanyaan dan jawaban sekaligus.`);
    patch.faq = faq.filter((f: Row) => f.q && f.a);
  }
  const data = { ...cur, ...patch };
  await q(sb.from('settings').upsert({ id: 1, data }));
  log(Object.keys(patch).length === 1 && 'isSample' in patch
    ? { action: 'settings.sample', summary: 'Menyembunyikan pengingat data contoh' }
    : { action: 'settings.update', summary: 'Mengubah pengaturan website' });
  return data;
});
on('POST', '/admin/upload', async ({ req }, log) => {
  const { buf, type, ext } = await readImage(req);
  const path = `${new Date().getFullYear()}/${Date.now()}-${randomToken(6)}.${ext}`;
  await putFile('photos', path, buf, type);
  log({ action: 'photo.upload', summary: 'Mengunggah foto kos/kamar' });
  return created({ url: PHOTO_PREFIX + path });
}, { raw: true });
on('GET', '/admin/export', async (_c, log) => {
  log({ action: 'export', summary: 'Mengunduh cadangan seluruh data' });
  const tables = ['settings', 'properties', 'rooms', 'tenants', 'invoices', 'surveys', 'expenses', 'issues', 'contracts', 'room_inspections', 'waitlist', 'announcements', 'announcement_reads', 'chore_tasks', 'chore_reports', 'owners', 'leads', 'messages', 'notifications', 'partner_applications', 'listings', 'places'];
  const out: Row = { exportedAt: new Date().toISOString() };
  for (const t of tables) out[t] = (await q<Row[]>(sb.from(t).select('*'))).map((r) => ({ ...r, portal_token_hash: undefined, password_hash: undefined }));
  return out;
});

// ================================================================ ADMIN — log aktivitas
on('GET', '/admin/activity', async ({ url }) => {
  const type = url.searchParams.get('type') || 'semua';
  const term = str(url.searchParams.get('q'), 80).replace(/[%,()]/g, ' ').trim();
  const before = Number(url.searchParams.get('before')) || 0;
  const limit = 100;
  let query = sb.from('activity_log').select('*').order('id', { ascending: false }).limit(limit + 1);
  if (['admin', 'penghuni', 'publik', 'pemilik', 'customer'].includes(type)) query = query.eq('actor_type', type);
  if (type === 'gagal') query = query.eq('ok', false);
  if (before) query = query.lt('id', before);
  if (term) query = query.or(`summary.ilike.%${term}%,actor.ilike.%${term}%,target.ilike.%${term}%,ip.ilike.%${term}%`);
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const count = (f: (x: any) => any) => f(sb.from('activity_log').select('id', { count: 'exact', head: true }).gte('created_at', since)).then((r: any) => r.count ?? 0);
  const rows = await q<Row[]>(query);
  const list = (rows || []).map((r) => toCamel(r)!);
  const items = list.slice(0, limit);
  // Memuat baris yang lebih lama tidak perlu menghitung ulang 7 angka bulan ini; biayanya dihindari.
  if (before) return { items, hasMore: list.length > limit, counts: null, keepDays: LOG_KEEP_DAYS };
  const [all30, admin, penghuni, publik, gagal, pemilik, customer] = await Promise.all([
    count((x) => x), count((x) => x.eq('actor_type', 'admin')), count((x) => x.eq('actor_type', 'penghuni')),
    count((x) => x.eq('actor_type', 'publik')), count((x) => x.eq('ok', false)), count((x) => x.eq('actor_type', 'pemilik')), count((x) => x.eq('actor_type', 'customer')),
  ]);
  return { items, hasMore: list.length > limit, counts: { semua: all30, admin, penghuni, publik, pemilik, customer, gagal }, keepDays: LOG_KEEP_DAYS };
});

// ================================================================ DASHBOARD PENGHUNI — masuk & data utama
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const SESSION_DAYS = 30;
const cardCode = (n = 10) => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; return [...crypto.getRandomValues(new Uint8Array(n))].map((x) => a[x % a.length]).join(''); };
async function ensureCardCode(t: Row) {
  if (t.cardCode) return t.cardCode as string;
  for (let i = 0; i < 5; i++) {
    const c = cardCode();
    const { error } = await sb.from('tenants').update({ card_code: c }).eq('id', t.id).is('card_code', null);
    if (!error) { const cur = await one('tenants', t.id); if (cur?.cardCode) return cur.cardCode as string; }
  }
  throw new HttpError(500, 'Gagal membuat nomor kartu.');
}
// Tautan sementara untuk banyak berkas privat sekaligus.
async function signMany(paths: (string | null | undefined)[], expires = 3600) {
  const uniq = [...new Set(paths.filter((p): p is string => !!p))];
  if (!uniq.length) return new Map<string, string>();
  const { data, error } = await sb.storage.from('private').createSignedUrls(uniq, expires);
  if (error) { console.error(error); return new Map<string, string>(); }
  return new Map((data || []).filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl]));
}
async function readPrivate(path?: string | null) {
  if (!path) return null;
  const { data, error } = await sb.storage.from('private').download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}
const pdfOut = (bytes: Uint8Array, name: string) => new Response(bytes as unknown as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
const fileSafe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'dokumen';

on('POST', '/penghuni/login', async ({ req, body: b }, log) => {
  const username = str(b.username, 60).toLowerCase(); const password = String(b.password || '');
  const { ip } = clientInfo(req);
  const since = new Date(Date.now() - 15 * 60e3).toISOString();
  const { count } = await sb.from('activity_log').select('id', { count: 'exact', head: true }).eq('action', 'tenant.login.failed').eq('ip', ip).gte('created_at', since);
  if ((count ?? 0) >= 10) throw new HttpError(429, 'Terlalu banyak percobaan masuk. Coba lagi 15 menit lagi.');
  const fail = (why: string) => { writeLog(req, 'penghuni', username || '(tanpa username)', { action: 'tenant.login.failed', summary: `Gagal masuk ke dashboard penghuni: ${why}`, ok: false }); return new HttpError(401, 'Username atau kata sandi salah.'); };
  if (!USERNAME_RE.test(username) || !password) throw fail('username/kata sandi kosong atau tidak valid');
  // Batas per username juga, supaya tebakan dari banyak alamat IP tetap tertahan.
  const { count: perAccount } = await sb.from('activity_log').select('id', { count: 'exact', head: true }).eq('action', 'tenant.login.failed').eq('actor', username).gte('created_at', since);
  if ((perAccount ?? 0) >= 10) throw new HttpError(429, 'Terlalu banyak percobaan masuk ke akun ini. Coba lagi 15 menit lagi.');
  const t = toCamel(await q(sb.from('tenants').select('*').eq('username', username).maybeSingle()));
  if (!t?.passwordHash || !(await bcrypt.compare(password, t.passwordHash))) throw fail(t ? 'kata sandi salah' : 'username tidak terdaftar');
  if (t.status !== 'aktif') { writeLog(req, 'penghuni', t.name, { action: 'tenant.login.failed', summary: 'Gagal masuk: penghuni sudah tercatat keluar', ok: false }); throw new HttpError(403, 'Akun ini tidak aktif karena masa sewa sudah selesai. Hubungi pengelola bila perlu dokumen Anda.'); }
  if (!t.loginEnabled) { writeLog(req, 'penghuni', t.name, { action: 'tenant.login.failed', summary: 'Gagal masuk: akun sedang dinonaktifkan', ok: false }); throw new HttpError(403, 'Akun ini sedang dinonaktifkan. Hubungi pengelola.'); }
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY).toISOString();
  await q(sb.from('tenant_sessions').insert({ token_hash: await sha256(token), tenant_id: t.id, expires_at: expiresAt }));
  await q(sb.from('tenants').update({ last_login_at: new Date().toISOString() }).eq('id', t.id));
  // Sesi kedaluwarsa dibersihkan sesekali.
  if (Math.random() < 0.05) background(Promise.resolve(sb.from('tenant_sessions').delete().lt('expires_at', new Date().toISOString())));
  log({ action: 'tenant.login', summary: 'Masuk ke dashboard penghuni' });
  b.name = t.name;
  return { token, name: t.name, expiresAt };
});
on('POST', '/penghuni/logout', async ({ req }, log) => {
  const token = req.headers.get('x-tenant-session') || '';
  if (token) { await q(sb.from('tenant_sessions').delete().eq('token_hash', await sha256(token))); tenantCache.delete(token); }
  log({ action: 'tenant.logout', summary: 'Keluar dari dashboard penghuni' });
  return { ok: true };
});
on('POST', '/penghuni/password', async ({ req, body: b, tenant: t }, log) => {
  const oldPw = String(b.oldPassword || ''); const pw = String(b.newPassword || '');
  if (pw.length < 8) throw bad('Kata sandi baru minimal 8 karakter.');
  if (!(await bcrypt.compare(oldPw, t!.passwordHash || ''))) throw bad('Kata sandi lama salah.');
  await q(sb.from('tenants').update({ password_hash: await bcrypt.hash(pw, 10), password_set_at: new Date().toISOString() }).eq('id', t!.id));
  // Keluarkan sesi lain, kecuali yang sedang dipakai.
  const token = req.headers.get('x-tenant-session') || '';
  await q(sb.from('tenant_sessions').delete().eq('tenant_id', t!.id).neq('token_hash', await sha256(token)));
  tenantCache.clear();
  if (t!.email) mail.send({
    to: t!.email, kind: 'security.password', dedupeKey: null, subject: 'Kata sandi dashboard penghuni diganti',
    title: 'Kata sandi Anda baru saja diganti', intro: `Horas ${t!.name}, kata sandi dashboard penghuni Anda baru saja diganti dan perangkat lain sudah dikeluarkan.`,
    note: 'Bila bukan Anda yang menggantinya, segera hubungi pengelola.',
  });
  log({ action: 'tenant.password', summary: 'Mengganti kata sandi sendiri' });
  return { ok: true };
});
on('PUT', '/penghuni/email', async ({ body: b, tenant: t }, log) => {
  const email = emailField(b.email);
  await q(sb.from('tenants').update({ email }).eq('id', t!.id));
  tenantCache.clear();
  if (email && email !== t!.email) mail.send({
    to: email, kind: 'email.set', dedupeKey: null, subject: 'Email notifikasi Bonaasina aktif', title: 'Email notifikasi aktif',
    intro: `Horas ${t!.name}, mulai sekarang kabar tagihan, pembayaran, kontrak, pengumuman, dan laporan kerusakan dikirim ke alamat ini.`,
    cta: { label: 'Buka dashboard penghuni', url: PENGHUNI_URL },
  });
  log({ action: 'tenant.email', summary: email ? 'Mengatur email notifikasi' : 'Menghapus email notifikasi' });
  return { email };
});

// Fase kontrak dari sudut pandang tanggal hari ini.
function contractPhase(c: Row, today = todayStr()) {
  if (c.status === 'menunggu') return { phase: 'menunggu', daysLeft: null };
  if (c.status === 'dibatalkan') return { phase: 'dibatalkan', daysLeft: null };
  const daysLeft = Math.round((parse(c.endDate).getTime() - parse(today).getTime()) / DAY);
  if (daysLeft < 0) return { phase: 'berakhir', daysLeft };
  if (c.startDate > today) return { phase: 'akan_mulai', daysLeft };
  return { phase: daysLeft <= 30 ? 'akan_habis' : 'aktif', daysLeft };
}
const CONTRACT_FIELDS = ['id', 'number', 'tenantId', 'roomId', 'propertyId', 'startDate', 'endDate', 'rentAmount', 'rentCycle', 'deposit', 'status', 'acceptedAt', 'acceptedName', 'decision', 'decisionNote', 'decisionAt', 'decisionHandledAt', 'renewedFrom', 'createdAt'];
const contractOut = (c: Row): Row => ({ ...pick(c, CONTRACT_FIELDS), hasPdf: !!c.pdfPath, ...contractPhase(c) });

// ---------------------------------------------------------------- piket: jadwal bergilir
const MAX_CHORE_PHOTOS = 24;
function choreDates(task: Row, from: string, to: string) {
  const out: { date: string; k: number }[] = [];
  const start = task.startDate as string; if (start > to) return out;
  if (task.frequency === 'bulanan') {
    for (let k = 0; k < 600; k++) { const d = addMonths(start, k); if (d > to) break; if (d >= from) out.push({ date: d, k }); }
    return out;
  }
  const step = task.frequency === 'harian' ? 1 : task.frequency === 'dua_mingguan' ? 14 : 7;
  const diff = Math.round((parse(from).getTime() - parse(start).getTime()) / DAY);
  let k = Math.max(0, Math.ceil(diff / step));
  for (let i = 0; i < 400; i++, k++) { const d = fmt(new Date(parse(start).getTime() + k * step * DAY)); if (d > to) break; out.push({ date: d, k }); }
  return out;
}
// Peserta: penghuni aktif di kos itu, urut kamar. Giliran ke-k mendapat orang berikutnya dalam daftar.
function choreAssigned(task: Row, k: number, people: Row[]) {
  if (!people.length) return [];
  if (task.mode === 'bersama') return people;
  const n = Math.min(Math.max(1, task.peoplePerTurn || 1), people.length);
  return Array.from({ length: n }, (_, i) => people[(k * n + i) % people.length]);
}
async function choreSchedule(propertyId: string | null, from: string, to: string) {
  let tq = sb.from('chore_tasks').select('*').eq('active', true); if (propertyId) tq = tq.eq('property_id', propertyId);
  const tasks = ((await q<Row[]>(tq)) || []).map((r) => toCamel(r)!);
  if (!tasks.length) return { tasks: [], items: [] as Row[] };
  // Kamar & penghuni hanya dibaca untuk kos yang diminta (dashboard penghuni tidak perlu seluruh marketplace).
  const rooms = propertyId
    ? (await rowsIn('rooms', 'property_id', [propertyId], '*')).map((r) => toCamel(r)!)
    : await all('rooms');
  const [tenants, reports] = await Promise.all([
    propertyId && rooms.length
      ? rowsIn('tenants', 'room_id', rooms.map((r) => r.id as string), 'id, name, room_id', (b: any) => b.eq('status', 'aktif'))
      : pages<Row>((from, to) => sb.from('tenants').select('id, name, room_id').eq('status', 'aktif').range(from, to)),
    q<Row[]>(sb.from('chore_reports').select('*').in('task_id', tasks.map((t) => t.id)).gte('due_date', from).lte('due_date', to)),
  ]);
  const rm = new Map(rooms.map((r) => [r.id, r]));
  const peopleOf = (pid: string) => (tenants || []).filter((t) => rm.get(t.room_id)?.propertyId === pid)
    .map((t) => ({ id: t.id, name: t.name, roomCode: rm.get(t.room_id)?.code || '' }))
    .sort((a, b) => a.roomCode.localeCompare(b.roomCode, 'id', { numeric: true }) || a.name.localeCompare(b.name));
  const repMap = new Map((reports || []).map((r) => [`${r.task_id}|${r.due_date}`, toCamel(r)!]));
  const items: Row[] = [];
  for (const t of tasks) {
    const people = peopleOf(t.propertyId);
    for (const { date, k } of choreDates(t, from, to)) {
      items.push({ taskId: t.id, name: t.name, propertyId: t.propertyId, mode: t.mode, date, assigned: choreAssigned(t, k, people), report: repMap.get(`${t.id}|${date}`) || null });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return { tasks, items };
}

// ---------------------------------------------------------------- daftar tunggu: cocokkan saat kamar kosong
async function matchWaitlist(roomId: string) {
  const room = await one('rooms', roomId);
  if (!room || room.hidden || room.status !== 'kosong' || (await activeInRoom(room.id))) return 0;
  const { data, error } = await sb.from('waitlist').update({ status: 'perlu_dikabari', matched_room_id: room.id, matched_at: new Date().toISOString() })
    .eq('status', 'menunggu').or(`property_id.is.null,property_id.eq.${room.propertyId}`).select('id, name, email');
  if (error) { console.error(error); return 0; }
  const withEmail = ((data as Row[]) || []).filter((w) => w.email);
  if (withEmail.length) {
    const prop = await one('properties', room.propertyId);
    for (const w of withEmail) mail.send({
      to: w.email, kind: 'waitlist.match', dedupeKey: `waitlist.match:${w.id}:${room.id}`,
      subject: `Kamar ${room.code} di ${prop?.name || 'Bonaasina'} sekarang kosong`, title: 'Ada kamar kosong untuk Anda',
      intro: `Horas ${w.name}, kamar yang Anda tunggu sekarang tersedia. Pesan cepat sebelum diambil orang lain.`,
      rows: [['Kos', prop?.name || '-'], ['Kamar', `${room.code}${room.type ? ` (${room.type})` : ''}`], ['Harga', priceText(room)]],
      cta: { label: 'Pesan sekarang', url: prop?.kind === 'mitra' && prop?.slug ? `${SITE_URL}/kos/?k=${prop.slug}` : `${SITE_URL}/#kamar` },
    });
  }
  return (data || []).length;
}

on('GET', '/penghuni/me', async ({ tenant: t }, log) => {
  log({ action: 'tenant.open', summary: 'Membuka dashboard penghuni', dedupeMinutes: 30 });
  await generateInvoices(t!.id);
  const today = todayStr();
  const from = fmt(new Date(parse(today).getTime() - 14 * DAY)); const to = fmt(new Date(parse(today).getTime() + 21 * DAY));
  const room = await one('rooms', t!.roomId);
  const [s, prop, invoices, issues, contracts, inspections, anns, reads, chores] = await Promise.all([
    getSettings(), room ? one('properties', room.propertyId) : null,
    q<Row[]>(sb.from('invoices').select('*').eq('tenant_id', t!.id).order('due_date', { ascending: false })),
    q<Row[]>(sb.from('issues').select('*').eq('tenant_id', t!.id).order('created_at', { ascending: false })),
    q<Row[]>(sb.from('contracts').select('*').eq('tenant_id', t!.id).neq('status', 'dibatalkan').order('start_date', { ascending: false })),
    q<Row[]>(sb.from('room_inspections').select('*').eq('tenant_id', t!.id).order('date')),
    // Hanya pengumuman yang masih berlaku, disematkan lebih dulu; tanpa potongan 50 terbaru supaya
    // pengumuman lama yang masih aktif (atau disematkan) tidak hilang.
    q<Row[]>(sb.from('announcements').select('*')
      .or(`property_id.is.null${room ? `,property_id.eq.${room.propertyId}` : ''}`)
      .or(`expires_on.is.null,expires_on.gte.${today}`)
      .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(200)),
    q<Row[]>(sb.from('announcement_reads').select('announcement_id').eq('tenant_id', t!.id)),
    room ? choreSchedule(room.propertyId, from, to) : Promise.resolve({ tasks: [], items: [] as Row[] }),
  ]);
  const code = await ensureCardCode(t!);
  const insp = (inspections || []).map((r) => toCamel(r)!);
  const choreItems = chores.items.filter((i) => i.mode === 'bersama' || i.assigned.some((p: Row) => p.id === t!.id) || i.report);
  const signed = await signMany([t!.photoPath, ...insp.flatMap((i) => (i.items || []).flatMap((x: Row) => x.photos || [])), ...choreItems.flatMap((i) => i.report?.photos || [])]);
  const readSet = new Set((reads || []).map((r) => r.announcement_id));
  const annList = (anns || []).map((r) => toCamel(r)!).filter((a) => !a.expiresOn || a.expiresOn >= today)
    .map((a): Row => ({ ...pick(a, ['id', 'title', 'body', 'priority', 'pinned', 'createdAt', 'expiresOn']), read: readSet.has(a.id) }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
  const inv = (invoices || []).map((r) => decorate(toCamel(r)!, today));
  const ctr = (contracts || []).map((r) => contractOut(toCamel(r)!));
  const myChores = choreItems.map((i) => ({
    taskId: i.taskId, name: i.name, mode: i.mode, date: i.date,
    assigned: i.assigned.map((p: Row) => p.name), mine: i.mode === 'bersama' || i.assigned.some((p: Row) => p.id === t!.id),
    report: i.report ? { id: i.report.id, note: i.report.note, by: i.report.tenantId === t!.id ? 'Anda' : (await_name(i.report.tenantId, chores.items)), at: i.report.createdAt, photos: (i.report.photos || []).map((p: string) => signed.get(p)).filter(Boolean) } : null,
  }));
  const taskDesc = new Map(chores.tasks.map((x: Row) => [x.id, x.description]));

  // Notifikasi di beranda
  const notes: Row[] = [];
  const pending = ctr.find((c) => c.phase === 'menunggu');
  if (pending) notes.push({ kind: 'kontrak', urgent: true, view: 'kontrak', text: `Kontrak sewa ${pending.number} menunggu persetujuan Anda.` });
  const ending = ctr.find((c) => c.phase === 'akan_habis' && !c.decision);
  if (ending) notes.push({ kind: 'kontrak', urgent: true, view: 'kontrak', text: `Kontrak Anda berakhir ${tanggal(ending.endDate)} (${ending.daysLeft} hari lagi). Pilih perpanjang atau berhenti.` });
  for (const i of inv.filter((x) => x.status === 'belum')) {
    if (i.proofStatus === 'ditolak') notes.push({ kind: 'tagihan', urgent: true, view: 'tagihan', text: `Bukti bayar ${i.periodLabel} ditolak: ${i.proofNote}. Unggah ulang bukti yang benar.` });
    else if (i.overdue) notes.push({ kind: 'tagihan', urgent: true, view: 'tagihan', text: `Tagihan ${i.periodLabel} (${rupiah(i.amount)}) sudah lewat ${i.overdueDays} hari.` });
    else if (i.proofStatus !== 'menunggu') notes.push({ kind: 'tagihan', urgent: false, view: 'tagihan', text: `Tagihan ${i.periodLabel} (${rupiah(i.amount)}) jatuh tempo ${tanggal(i.dueDate)}.` });
  }
  for (const x of insp.filter((x) => !x.tenantAckAt)) notes.push({ kind: 'kondisi', urgent: true, view: 'kondisi', text: `Catatan kondisi kamar saat ${x.kind} perlu Anda periksa dan setujui.` });
  for (const a of annList.filter((a) => !a.read)) notes.push({ kind: 'pengumuman', urgent: a.priority === 'penting', view: 'pengumuman', text: `Pengumuman: ${a.title}` });
  for (const c of myChores.filter((c) => c.mine && !c.report && c.date <= today && c.date >= fmt(new Date(parse(today).getTime() - 7 * DAY)))) notes.push({ kind: 'piket', urgent: c.date < today, view: 'piket', text: `Piket "${c.name}" ${c.date === today ? 'hari ini' : `tanggal ${tanggal(c.date)}`}: kirim foto buktinya.` });

  return {
    today,
    tenant: { ...pick(t!, ['id', 'name', 'phone', 'email', 'occupation', 'origin', 'rentCycle', 'rentAmount', 'startDate', 'endDate', 'deposit', 'username', 'emergencyName', 'emergencyPhone']), cardCode: code, photoUrl: t!.photoPath ? signed.get(t!.photoPath) || null : null },
    room: room ? pick(room, ['code', 'type', 'sizeM2', 'floor', 'facilities']) : null,
    property: prop ? pick(prop, ['id', 'name', 'logo', 'address', 'rules', 'facilities']) : null,
    owner: { name: s.ownerName || '', whatsapp: normalizePhone(s.whatsapp) },
    paymentInfo: s.paymentInfo || '', paymentMethods: s.paymentMethods || '',
    invoices: inv.map((i) => ({ ...pick(i, ['id', 'periodLabel', 'cycle', 'dueDate', 'amount', 'status', 'paidAt', 'paidAmount', 'method', 'overdue', 'overdueDays', 'proofStatus', 'proofNote', 'proofUploadedAt', 'receiptNo']) })),
    issues: (issues || []).map((r) => pick(toCamel(r)!, ['id', 'category', 'title', 'description', 'status', 'ownerNote', 'createdAt', 'updatedAt', 'photoPath'])).map((i) => ({ ...i, hasPhoto: !!i.photoPath, photoPath: undefined })),
    contracts: ctr,
    inspections: insp.map((x) => ({ ...pick(x, ['id', 'kind', 'date', 'note', 'depositDeduction', 'deductionNote', 'tenantAckAt', 'tenantNote', 'updatedAt']), items: (x.items || []).map((it: Row) => ({ ...it, photos: (it.photos || []).map((p: string) => signed.get(p)).filter(Boolean) })) })),
    announcements: annList,
    chores: myChores.map((c) => ({ ...c, description: taskDesc.get(c.taskId) || '' })),
    card: { code, qrSvg: qrSvg(`${SITE_URL}/cek/?k=${code}`, 132), validUntil: ctr.find((c) => ['aktif', 'akan_habis'].includes(c.phase))?.endDate || null },
    notifications: notes,
  };
});
// Nama pelapor piket (dari daftar peserta yang sudah dimuat).
function await_name(tenantId: string | null, items: Row[]) {
  for (const i of items) for (const p of i.assigned) if (p.id === tenantId) return p.name;
  return 'Penghuni lain';
}

// Unggah berkas oleh penghuni: foto bukti piket (privat). Mengembalikan path untuk dikirim bersama laporan.
on('POST', '/penghuni/upload', async ({ req, url, tenant: t }) => {
  const kind = url.searchParams.get('kind');
  if (kind !== 'piket') throw bad('Jenis unggahan tidak dikenal.');
  const { buf, type, ext } = await readImage(req);
  const path = `chores/${t!.id}/${Date.now()}-${randomToken(4).replace(/[^\w]/g, '')}.${ext}`;
  await putFile('private', path, buf, type);
  return created({ path, url: await signedUrl(path) });
}, { raw: true });

on('POST', '/penghuni/photo', async ({ req, tenant: t }, log) => {
  const { buf, type, ext } = await readImage(req);
  if (ext === 'webp') throw bad('Unggah foto JPG atau PNG.');
  const path = `faces/${t!.id}/${Date.now()}.${ext}`;
  await putFile('private', path, buf, type);
  await q(sb.from('tenants').update({ photo_path: path }).eq('id', t!.id));
  tenantCache.clear();
  log({ action: 'tenant.photo', summary: 'Mengganti foto profil untuk kartu penghuni' });
  return { url: await signedUrl(path) };
}, { raw: true });

on('GET', '/penghuni/card.pdf', async ({ tenant: t }, log) => {
  log({ action: 'tenant.card', summary: 'Mengunduh kartu penghuni (PDF)' });
  return pdfOut(await buildCard(t!), `kartu-penghuni-${fileSafe(t!.name)}.pdf`);
});
async function buildCard(t: Row) {
  const [room, code, contracts, photo] = await Promise.all([one('rooms', t.roomId), ensureCardCode(t),
    q<Row[]>(sb.from('contracts').select('*').eq('tenant_id', t.id).eq('status', 'disetujui').order('end_date', { ascending: false }).limit(1)), readPrivate(t.photoPath)]);
  const prop = room ? await one('properties', room.propertyId) : null;
  const c = contracts?.[0] ? toCamel(contracts[0])! : null;
  return await cardPdf({ name: t.name, propertyName: prop?.name || 'Bonaasina', roomCode: room?.code || '-', since: t.startDate, validUntil: c && c.endDate >= todayStr() ? c.endDate : null, cardCode: code, photo, status: t.status });
}

// ---------------------------------------------------------------- penghuni: kontrak
async function myContract(id: string, t: Row) {
  const c = await one('contracts', id);
  if (!c || c.tenantId !== t.id || c.status === 'dibatalkan') throw notFound('Kontrak tidak ditemukan.');
  return c;
}
on('GET', '/penghuni/contracts/:id', async ({ params, tenant: t }) => {
  const c = await myContract(params.id, t!);
  return { ...contractOut(c), body: c.body };
});
on('POST', '/penghuni/contracts/:id/accept', async ({ req, params, body: b, tenant: t }, log) => {
  const c = await myContract(params.id, t!);
  if (c.status !== 'menunggu') throw bad('Kontrak ini sudah disetujui.');
  if (b.agree !== true) throw bad('Centang pernyataan setuju terlebih dahulu.');
  const name = str(b.name, 120);
  if (name.length < 3) throw bad('Ketik nama lengkap Anda sebagai tanda persetujuan.');
  const { ip, ua } = clientInfo(req);
  const now = new Date().toISOString();
  const doc = await contractDocData({ ...c, status: 'disetujui', acceptedAt: now, acceptedName: name, acceptedIp: ip, acceptedDevice: ua });
  const bytes = await contractPdf(doc);
  const path = `contracts/${t!.id}/${c.id}-${Date.now()}.pdf`;
  const { error } = await sb.storage.from('private').upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (error) { console.error(error); throw new HttpError(500, 'Gagal menyimpan PDF kontrak.'); }
  const rec = await update('contracts', c.id, { status: 'disetujui', acceptedAt: now, acceptedName: name, acceptedIp: ip, acceptedDevice: ua, pdfPath: path });
  mail.sendAdmin({
    kind: 'contract.accepted', dedupeKey: `contract.accepted:${c.id}`, subject: `Kontrak ${c.number} disetujui ${t!.name}`,
    title: 'Kontrak disetujui penghuni', rows: [['Penghuni', t!.name], ['Nomor', c.number], ['Masa sewa', `${tanggal(c.startDate)} s.d. ${tanggal(c.endDate)}`], ['Nama yang diketik', name]],
    cta: { label: 'Buka admin', url: ADMIN_URL },
  });
  if (t!.email) mail.send({
    to: t!.email, kind: 'contract.accepted_tenant', dedupeKey: `contract.accepted_tenant:${c.id}`, subject: `Kontrak ${c.number} sudah Anda setujui`,
    title: 'Kontrak sudah disetujui', intro: `Horas ${t!.name}, terima kasih. Kontrak sewa Anda tercatat disetujui pada ${tanggal(now.slice(0, 10))}.`,
    note: 'PDF kontrak final bisa diunduh kapan saja di dashboard penghuni, menu Kontrak.', cta: { label: 'Unduh kontrak', url: PENGHUNI_URL },
  });
  log({ action: 'contract.accept', summary: `Menyetujui kontrak ${c.number} (${tanggal(c.startDate)} s.d. ${tanggal(c.endDate)})` });
  return contractOut(rec);
});
on('GET', '/penghuni/contracts/:id/pdf', async ({ params, tenant: t }, log) => {
  const c = await myContract(params.id, t!);
  log({ action: 'contract.download', summary: `Mengunduh PDF kontrak ${c.number}`, dedupeMinutes: 10 });
  return pdfOut(await contractBytes(c), `kontrak-${fileSafe(c.number)}.pdf`);
});
on('POST', '/penghuni/contracts/:id/decision', async ({ params, body: b, tenant: t }, log) => {
  const c = await myContract(params.id, t!);
  if (c.status !== 'disetujui') throw bad('Kontrak ini belum disetujui.');
  const { daysLeft } = contractPhase(c);
  if (daysLeft !== null && daysLeft > 60) throw bad('Pilihan perpanjang/berhenti bisa dikirim mulai 60 hari sebelum kontrak berakhir.');
  if (!['perpanjang', 'berhenti'].includes(b.decision)) throw bad('Pilih perpanjang atau berhenti.');
  const rec = await update('contracts', c.id, { decision: b.decision, decisionNote: str(b.note, 600), decisionAt: new Date().toISOString(), decisionHandledAt: null });
  mail.sendAdmin({
    kind: 'contract.decision', dedupeKey: `contract.decision:${c.id}:${rec.decisionAt}`, subject: `${t!.name} memilih ${b.decision === 'perpanjang' ? 'PERPANJANG' : 'BERHENTI'} (${c.number})`,
    title: 'Keputusan kontrak dari penghuni', rows: [['Penghuni', t!.name], ['Kontrak', c.number], ['Berakhir', tanggal(c.endDate)], ['Pilihan', b.decision === 'perpanjang' ? 'Perpanjang' : 'Berhenti di akhir kontrak'], ['Catatan', rec.decisionNote || '']],
    cta: { label: 'Buka admin', url: ADMIN_URL },
  });
  log({ action: 'contract.decision', summary: `Memilih ${b.decision === 'perpanjang' ? 'MEMPERPANJANG' : 'BERHENTI di akhir'} kontrak ${c.number}${b.note ? `: ${str(b.note, 120)}` : ''}` });
  return contractOut(rec);
});

// ---------------------------------------------------------------- penghuni: kondisi kamar, pengumuman, piket, kuitansi
on('POST', '/penghuni/inspections/:id/ack', async ({ params, body: b, tenant: t }, log) => {
  const x = await one('room_inspections', params.id);
  if (!x || x.tenantId !== t!.id) throw notFound('Catatan kondisi tidak ditemukan.');
  const rec = await update('room_inspections', x.id, { tenantAckAt: new Date().toISOString(), tenantNote: str(b.note, 800) });
  log({ action: 'inspection.ack', summary: `Menyetujui catatan kondisi kamar saat ${x.kind}${b.note ? ` dengan catatan: ${str(b.note, 120)}` : ''}` });
  return pick(rec, ['id', 'tenantAckAt', 'tenantNote']);
});
on('POST', '/penghuni/announcements/:id/read', async ({ params, tenant: t }) => {
  await q(sb.from('announcement_reads').upsert({ announcement_id: params.id, tenant_id: t!.id }, { onConflict: 'announcement_id,tenant_id', ignoreDuplicates: true }));
  return { ok: true };
});
on('POST', '/penghuni/chores/report', async ({ body: b, tenant: t }, log) => {
  const task = await one('chore_tasks', str(b.taskId, 40));
  const room = await one('rooms', t!.roomId);
  if (!task || !task.active || task.propertyId !== room?.propertyId) throw notFound('Jadwal piket tidak ditemukan.');
  if (!isDate(b.date)) throw bad('Tanggal piket tidak valid.');
  const today = todayStr();
  if (b.date > today) throw bad('Laporan piket dikirim setelah piketnya dikerjakan.');
  if (b.date < fmt(new Date(parse(today).getTime() - 14 * DAY))) throw bad('Laporan untuk piket lebih dari 14 hari lalu tidak bisa dikirim lagi.');
  const sched = await choreSchedule(task.propertyId, b.date, b.date);
  const occ = sched.items.find((i) => i.taskId === task.id && i.date === b.date);
  if (!occ) throw bad('Tidak ada jadwal piket ini pada tanggal tersebut.');
  if (task.mode !== 'bersama' && !occ.assigned.some((p: Row) => p.id === t!.id)) throw bad('Piket ini bukan giliran Anda.');
  const photos = (Array.isArray(b.photos) ? b.photos : []).map((p: unknown) => str(p, 200)).filter((p: string) => p.startsWith(`chores/${t!.id}/`));
  if (!photos.length) throw bad('Lampirkan minimal satu foto keadaan setelah piket.');
  const row = { task_id: task.id, due_date: b.date, tenant_id: t!.id, assigned: occ.assigned.map((p: Row) => p.name), photos, note: str(b.note, 600) };
  // Gabung laporan dengan aman untuk dua penghuni yang mengirim bersamaan: baca ulang data terbaru,
  // tulis dengan syarat updated_at belum berubah, lalu ulangi sekali bila ada penulis lain.
  const mergeReport = async (attempt = 0): Promise<Row> => {
    const hdr = await q<Row | null>(sb.from('chore_reports').select('*').eq('task_id', task.id).eq('due_date', b.date).maybeSingle());
    if (!hdr) {
      const { data, error } = await sb.from('chore_reports').insert(toSnake(row)).select().single();
      if (error?.code === '23505' && attempt < 3) return mergeReport(attempt + 1);
      if (error) { console.error(error); throw new HttpError(500, 'Gagal menyimpan bukti piket.'); }
      return toCamel(data)!;
    }
    const ex = toCamel(hdr)!;
    const kept = (ex.photos || []) as string[];
    const merged = [...new Set([...kept, ...photos])];
    if (merged.length > MAX_CHORE_PHOTOS) throw bad(`Bukti piket maksimal ${MAX_CHORE_PHOTOS} foto (sudah ada ${kept.length}). Hapus foto lama dulu.`);
    // Catatan penghuni kedua tidak menimpa catatan penghuni pertama dan tidak tampil atas namanya.
    const noteText = ex.tenantId === t!.id ? (row.note || ex.note)
      : row.note ? (ex.note ? `${ex.note}
${t!.name}: ${row.note}` : `${t!.name}: ${row.note}`) : ex.note;
    const { data: updated } = await sb.from('chore_reports')
      .update({ photos: merged, note: noteText, tenant_id: ex.tenantId || t!.id })
      .eq('id', ex.id).eq('updated_at', ex.updatedAt).select('*').maybeSingle();
    if (updated) return toCamel(updated)!;
    if (attempt >= 3) throw bad('Laporan piket ini sedang diperbarui penghuni lain. Coba kirim lagi.');
    return mergeReport(attempt + 1);
  };
  const rec = await mergeReport();
  log({ action: 'chore.report', summary: `Mengirim bukti piket "${task.name}" ${tanggal(b.date)} (${photos.length} foto)` });
  return pick(rec, ['id']);
});
async function receiptFor(inv: Row) {
  if (inv.status !== 'lunas') throw bad('Kuitansi hanya tersedia untuk tagihan yang sudah lunas.');
  if (!inv.receiptNo) inv = await issueReceipt(inv);
  const [t, room, s] = await Promise.all([one('tenants', inv.tenantId), one('rooms', inv.roomId), getSettings()]);
  const prop = room ? await one('properties', room.propertyId) : null;
  return await receiptPdf({
    receiptNo: inv.receiptNo, issuedAt: inv.receiptIssuedAt || new Date().toISOString(), tenantName: t?.name || '-', amount: inv.paidAmount ?? inv.amount, invoiceAmount: inv.amount,
    periodLabel: inv.periodLabel, propertyName: prop?.name || 'Bonaasina', roomCode: room?.code || '-', method: inv.method || '', paidAt: inv.paidAt, ownerName: s.ownerName || '', verifyCode: inv.receiptCode,
  });
}
async function issueReceipt(inv: Row) {
  const { data, error } = await sb.rpc('next_doc_no', { kind: 'kuitansi' });
  if (error || !data) { console.error(error); throw new HttpError(500, 'Gagal membuat nomor kuitansi.'); }
  return await update('invoices', inv.id, { receiptNo: data as string, receiptCode: cardCode(12), receiptIssuedAt: new Date().toISOString() });
}
on('GET', '/penghuni/invoices/:id/receipt.pdf', async ({ params, tenant: t }, log) => {
  const inv = await one('invoices', params.id);
  if (!inv || inv.tenantId !== t!.id) throw notFound('Tagihan tidak ditemukan.');
  const bytes = await receiptFor(inv);
  log({ action: 'receipt.download', summary: `Mengunduh kuitansi ${inv.periodLabel}`, dedupeMinutes: 10 });
  return pdfOut(bytes, `kuitansi-${fileSafe(inv.periodLabel)}.pdf`);
});

// ---------------------------------------------------------------- publik: cek keaslian kartu/kuitansi, daftar tunggu
on('GET', '/public/verify/:code', async ({ params }) => {
  const code = str(params.code, 20).toLowerCase();
  if (!/^[a-z0-9]{8,16}$/.test(code)) throw notFound('Kode tidak dikenal.');
  const t = toCamel(await q(sb.from('tenants').select('*').eq('card_code', code).maybeSingle()));
  if (t) {
    const room = await one('rooms', t.roomId); const prop = room ? await one('properties', room.propertyId) : null;
    const c = (await q<Row[]>(sb.from('contracts').select('end_date').eq('tenant_id', t.id).eq('status', 'disetujui').order('end_date', { ascending: false }).limit(1)))?.[0];
    return { type: 'kartu', valid: t.status === 'aktif', name: t.name, propertyName: prop?.name || '', roomCode: room?.code || '', since: t.startDate, until: t.status === 'aktif' ? c?.end_date || null : t.endDate, photoUrl: t.status === 'aktif' && t.photoPath ? await signedUrl(t.photoPath) : null };
  }
  const inv = toCamel(await q(sb.from('invoices').select('*').eq('receipt_code', code).maybeSingle()));
  if (inv) {
    const tn = await one('tenants', inv.tenantId); const room = await one('rooms', inv.roomId);
    return { type: 'kuitansi', valid: inv.status === 'lunas', receiptNo: inv.receiptNo, name: tn?.name || '', roomCode: room?.code || '', periodLabel: inv.periodLabel, amount: inv.paidAmount ?? inv.amount, paidAt: inv.paidAt };
  }
  const bk = await market.verifyBooking(code);
  if (bk) return bk;
  throw notFound('Kode tidak dikenal. Kartu, kuitansi, atau bukti booking ini tidak terdaftar di Bonaasina.');
});

on('POST', '/waitlist', async ({ body: b }, log) => {
  if (b.website) return { ok: true }; // honeypot
  const name = str(b.name, 80), phone = str(b.phone, 20), email = emailField(b.email);
  if (!name) throw bad('Isi nama Anda.');
  if (normalizePhone(phone).length < 10) throw bad('Nomor WhatsApp belum benar. Contoh: 0812 3456 7890.');
  const propertyId = b.propertyId && (await one('properties', str(b.propertyId, 60))) ? str(b.propertyId, 60) : null;
  if (b.moveDate && !isDate(b.moveDate)) throw bad('Tanggal rencana masuk tidak valid.');
  const since = new Date(Date.now() - 3600e3).toISOString();
  const { count } = await sb.from('waitlist').select('id', { count: 'exact', head: true }).eq('phone', phone).gte('created_at', since);
  if ((count ?? 0) >= 3) throw new HttpError(429, 'Nomor ini sudah terdaftar. Kami akan menghubungi Anda lewat WhatsApp.');
  // Kalau sudah ada kamar kosong yang cocok, langsung ditandai untuk dikabari.
  let rq = sb.from('rooms').select('id, property_id').eq('status', 'kosong').eq('hidden', false); if (propertyId) rq = rq.eq('property_id', propertyId);
  const free = (await q<Row[]>(rq)) || [];
  // Yang perlu diperiksa hanya kamar kosong yang baru dibaca, bukan seluruh penghuni aktif.
  const active = free.length ? await rowsIn('tenants', 'room_id', free.map((r) => r.id), 'room_id', (x: any) => x.eq('status', 'aktif')) : [];
  const occ = new Set(active.map((x) => x.room_id));
  const match = free.find((r) => !occ.has(r.id));
  const rec = await insert('waitlist', {
    name, phone, email, propertyId, roomPref: str(b.roomPref, 120), budget: b.budget ? num(b.budget) : null, moveDate: b.moveDate || null, note: str(b.note, 600),
    status: match ? 'perlu_dikabari' : 'menunggu', matchedRoomId: match?.id ?? null, matchedAt: match ? new Date().toISOString() : null,
  });
  // Hitung ulang setelah insert supaya kiriman bersamaan tidak melewati batas.
  const { count: waitAfter } = await sb.from('waitlist').select('id', { count: 'exact', head: true }).eq('phone', phone).gte('created_at', since);
  if ((waitAfter ?? 0) > 3) {
    await q(sb.from('waitlist').delete().eq('id', rec.id));
    throw new HttpError(429, 'Nomor ini sudah terdaftar. Kami akan menghubungi Anda lewat WhatsApp.');
  }
  const prop = propertyId ? await one('properties', propertyId) : null;
  mail.send({
    to: email, kind: 'waitlist.received', dedupeKey: `waitlist.received:${rec.id}`,
    subject: `Anda masuk daftar tunggu ${prop?.name || 'Bonaasina'}`, title: 'Anda sudah masuk daftar tunggu',
    intro: match ? `Horas ${name}, kabar baik: saat ini ada kamar kosong. Pengelola akan segera menghubungi Anda.` : `Horas ${name}, kami akan mengabari Anda lewat email ini dan WhatsApp begitu ada kamar kosong yang cocok.`,
    rows: [['Kos', prop?.name || 'Kos mana saja'], ['Rencana masuk', tanggal(rec.moveDate)], ['Anggaran', rec.budget ? rupiah(rec.budget) : '']],
    cta: { label: 'Lihat kamar', url: `${SITE_URL}/` },
  });
  log({ action: 'waitlist.create', summary: `Mendaftar di daftar tunggu ${prop?.name || '(kos mana saja)'}` });
  return created({ ok: true, id: rec.id, available: !!match });
});

// ================================================================ ADMIN — akun login, detail, foto & kartu penghuni
on('POST', '/admin/tenants/:id/account', async ({ body: b, params }, log) => {
  const t = await one('tenants', params.id); if (!t) throw notFound('Penghuni tidak ditemukan.');
  const out = await setAccount(t, b);
  log({ action: 'tenant.account', summary: `${out.passwordChanged ? 'Mengatur username & kata sandi' : 'Mengubah akun login'} ${t.name} (${out.username}${out.enabled ? '' : ', dinonaktifkan'})` });
  return { username: out.username, loginEnabled: out.enabled };
});
async function setAccount(t: Row, b: Row) {
  const username = str(b.username ?? t.username, 60).toLowerCase();
  if (!USERNAME_RE.test(username)) throw bad('Username 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda minus. Tanpa spasi.');
  const takenBy = await usernameTakenAnywhere(username, { table: 'tenants', id: t.id });
  if (takenBy) throw bad(`Username "${username}" sudah dipakai akun ${takenBy} lain. Pilih username lain.`);
  const patch: Row = { username, login_enabled: b.enabled === undefined ? true : !!b.enabled };
  const pw = b.password === undefined || b.password === null ? '' : String(b.password);
  if (pw) {
    if (pw.length < 8) throw bad('Kata sandi minimal 8 karakter.');
    patch.password_hash = await bcrypt.hash(pw, 10); patch.password_set_at = new Date().toISOString();
  } else if (!t.passwordHash) throw bad('Isi kata sandi untuk akun baru.');
  await q(sb.from('tenants').update(patch).eq('id', t.id));
  if (pw || !patch.login_enabled || username !== t.username) { await q(sb.from('tenant_sessions').delete().eq('tenant_id', t.id)); tenantCache.clear(); }
  await ensureCardCode({ ...t });
  if (pw && t.email && t.passwordHash) mail.send({
    to: t.email, kind: 'tenant.account', dedupeKey: `tenant.account:${t.id}:${patch.password_set_at}`,
    subject: 'Kata sandi dashboard penghuni diatur ulang', title: 'Kata sandi Anda diatur ulang pengelola',
    intro: `Horas ${t.name}, pengelola baru saja mengatur kata sandi baru untuk akun dashboard penghuni Anda. Semua perangkat yang sedang masuk sudah dikeluarkan.`,
    rows: [['Username', username]], note: 'Kata sandi baru diberikan langsung oleh pengelola. Bila Anda tidak memintanya, hubungi pengelola.',
    cta: { label: 'Masuk ke dashboard penghuni', url: PENGHUNI_URL },
  });
  return { username, enabled: patch.login_enabled as boolean, passwordChanged: !!pw };
}
const tenantPublic = (t: Row): Row => {
  const { passwordHash, portalTokenHash, portalCreatedAt, ...rest } = t;
  return { ...rest, hasPassword: !!passwordHash, hasPhoto: !!t.photoPath };
};
on('GET', '/admin/tenants/:id/detail', async ({ params }) => {
  const t = await one('tenants', params.id); if (!t) throw notFound('Penghuni tidak ditemukan.');
  const today = todayStr();
  const [room, contracts, inspections, invoices] = await Promise.all([
    one('rooms', t.roomId),
    q<Row[]>(sb.from('contracts').select('*').eq('tenant_id', t.id).order('start_date', { ascending: false })),
    q<Row[]>(sb.from('room_inspections').select('*').eq('tenant_id', t.id).order('date')),
    q<Row[]>(sb.from('invoices').select('*').eq('tenant_id', t.id).order('due_date', { ascending: false })),
  ]);
  const prop = room ? await one('properties', room.propertyId) : null;
  const code = t.status === 'aktif' ? await ensureCardCode(t) : t.cardCode;
  const insp = (inspections || []).map((r) => toCamel(r)!);
  const signed = await signMany([t.photoPath, ...insp.flatMap((i) => (i.items || []).flatMap((x: Row) => x.photos || []))], 1800);
  return {
    tenant: tenantPublic(t), room: room ? pick(room, ['id', 'code', 'type', 'sizeM2', 'floor', 'propertyId']) : null, property: prop ? pick(prop, ['id', 'name']) : null,
    photoUrl: t.photoPath ? signed.get(t.photoPath) || null : null,
    contracts: (contracts || []).map((r) => contractOut(toCamel(r)!)),
    inspections: insp.map((x) => ({ ...x, items: (x.items || []).map((it: Row) => ({ ...it, photoUrls: (it.photos || []).map((p: string) => signed.get(p) || null) })) })),
    invoices: (invoices || []).map((r) => decorate(toCamel(r)!, today)),
    card: code ? { code, qrSvg: qrSvg(`${SITE_URL}/cek/?k=${code}`, 132) } : null,
  };
});
on('POST', '/admin/tenants/:id/photo', async ({ req, params }, log) => {
  const t = await one('tenants', params.id); if (!t) throw notFound('Penghuni tidak ditemukan.');
  const { buf, type, ext } = await readImage(req);
  if (ext === 'webp') throw bad('Unggah foto JPG atau PNG.');
  const path = `faces/${t.id}/${Date.now()}.${ext}`;
  await putFile('private', path, buf, type);
  await q(sb.from('tenants').update({ photo_path: path }).eq('id', t.id));
  log({ action: 'tenant.photo', summary: `Mengganti foto kartu penghuni ${t.name}` });
  return { url: await signedUrl(path) };
}, { raw: true });
on('GET', '/admin/tenants/:id/card.pdf', async ({ params }, log) => {
  const t = await one('tenants', params.id); if (!t) throw notFound('Penghuni tidak ditemukan.');
  log({ action: 'tenant.card', summary: `Mengunduh kartu penghuni ${t.name}`, dedupeMinutes: 10 });
  return pdfOut(await buildCard(t), `kartu-penghuni-${fileSafe(t.name)}.pdf`);
});
// Unggah foto privat oleh admin (foto kondisi kamar).
on('POST', '/admin/upload-private', async ({ req, url }) => {
  const tenantId = str(url.searchParams.get('tenant'), 40);
  if (url.searchParams.get('kind') !== 'kondisi' || !(await one('tenants', tenantId))) throw bad('Unggahan tidak valid.');
  const { buf, type, ext } = await readImage(req);
  const path = `inspections/${tenantId}/${Date.now()}-${randomToken(4).replace(/[^\w]/g, '')}.${ext}`;
  await putFile('private', path, buf, type);
  return created({ path, url: await signedUrl(path) });
}, { raw: true });

// ================================================================ ADMIN — kontrak
async function contractDocData(c: Row) {
  const [t, room, s] = await Promise.all([one('tenants', c.tenantId), c.roomId ? one('rooms', c.roomId) : null, getSettings()]);
  const prop = c.propertyId ? await one('properties', c.propertyId) : null;
  return {
    number: c.number, body: c.body, status: c.status, ownerName: s.ownerName || 'Pengelola Bonaasina', tenantName: t?.name || '-', propertyName: prop?.name || 'Bonaasina', roomCode: room?.code || '-',
    startDate: c.startDate, endDate: c.endDate, acceptedAt: c.acceptedAt, acceptedName: c.acceptedName, acceptedIp: c.acceptedIp, acceptedDevice: c.acceptedDevice, createdAt: c.createdAt,
  };
}
async function contractBytes(c: Row) {
  if (c.pdfPath) { const b = await readPrivate(c.pdfPath); if (b) return b; }
  return await contractPdf(await contractDocData(c));
}
function renderContract(tpl: string, v: Record<string, string>) {
  return Object.entries(v).reduce((s, [k, val]) => s.replaceAll(`{${k}}`, val), tpl);
}
async function contractBody(t: Row, room: Row, prop: Row | null, d: Row) {
  const s = await getSettings();
  const rules = (prop?.rules || []) as string[];
  const tpl = String(s.contractTemplate || DEFAULT_CONTRACT_TEMPLATE);
  return renderContract(tpl, {
    tanggal_kontrak: tanggal(todayStr()), pemilik: s.ownerName || 'Pengelola Bonaasina', kos: prop?.name || 'Bonaasina', alamat_kos: prop?.address || '-',
    nama_penghuni: t.name, telepon_penghuni: t.phone || '-', asal: t.origin || '-', kamar: room.code, tipe_kamar: [room.type, room.sizeM2].filter(Boolean).join(', ') || '-',
    mulai: tanggal(d.startDate), selesai: tanggal(d.endDate), harga: rupiah(d.rentAmount), siklus: CYCLE_WORD[d.rentCycle] || 'bulan',
    deposit: d.deposit ? `${rupiah(d.deposit)} (${terbilang(d.deposit).toLowerCase()})` : 'Rp0 (tanpa deposit)',
    aturan: rules.length ? rules.map((r, i) => `   ${String.fromCharCode(97 + (i % 26))}. ${r}`).join('\n') : '   (aturan kos yang berlaku dan diumumkan pengelola)',
    cara_bayar: (s.paymentInfo || s.paymentMethods || 'transfer ke rekening pengelola').replace(/\n+/g, '; '),
  });
}
on('GET', '/admin/contracts', async () => {
  const [list, tenants, rooms, props] = await Promise.all([all('contracts'), all('tenants'), all('rooms'), all('properties')]);
  const tm = new Map(tenants.map((t) => [t.id, t])); const rm = new Map(rooms.map((r) => [r.id, r])); const pm = new Map(props.map((p) => [p.id, p.name]));
  return list.map((c): Row => {
    const t = tm.get(c.tenantId);
    return { ...contractOut(c), tenantName: t?.name || '(dihapus)', tenantPhone: t?.phone || '', tenantStatus: t?.status, roomCode: rm.get(c.roomId)?.code || '-', propertyName: pm.get(c.propertyId) || '-' };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
});
on('GET', '/admin/contracts/:id', async ({ params }) => {
  const c = await one('contracts', params.id); if (!c) throw notFound('Kontrak tidak ditemukan.');
  return { ...contractOut(c), body: c.body };
});
on('POST', '/admin/contracts/preview-body', async ({ body: b }) => {
  const t = await one('tenants', str(b.tenantId, 40)); if (!t) throw bad('Pilih penghuni.');
  const room = await one('rooms', t.roomId); if (!room) throw bad('Penghuni belum punya kamar.');
  const prop = await one('properties', room.propertyId);
  return { body: await contractBody(t, room, prop, contractInput(b, t)) };
});
function contractInput(b: Row, t: Row) {
  const d = {
    startDate: b.startDate || t.startDate, endDate: b.endDate, rentCycle: b.rentCycle || t.rentCycle,
    rentAmount: b.rentAmount !== undefined && b.rentAmount !== '' ? num(b.rentAmount) : t.rentAmount, deposit: b.deposit !== undefined && b.deposit !== '' ? num(b.deposit) : (t.deposit || 0),
  };
  if (!isDate(d.startDate) || !isDate(d.endDate)) throw bad('Isi tanggal mulai dan selesai kontrak.');
  if (d.endDate <= d.startDate) throw bad('Tanggal selesai harus setelah tanggal mulai.');
  if (!CYCLES.includes(d.rentCycle)) throw bad('Pilih periode sewa yang benar.');
  return d;
}
on('POST', '/admin/contracts', async ({ body: b }, log) => {
  const t = await one('tenants', str(b.tenantId, 40)); if (!t) throw bad('Pilih penghuni.');
  if (t.status !== 'aktif') throw bad('Penghuni ini sudah keluar.');
  const room = await one('rooms', t.roomId); if (!room) throw bad('Penghuni belum punya kamar.');
  const pend = await q<Row | null>(sb.from('contracts').select('id, number').eq('tenant_id', t.id).eq('status', 'menunggu').maybeSingle());
  if (pend) throw bad(`Masih ada kontrak ${pend.number} yang menunggu persetujuan. Batalkan dulu bila ingin membuat yang baru.`);
  const prop = await one('properties', room.propertyId);
  const d = contractInput(b, t);
  const body = str(b.body, 30000) || await contractBody(t, room, prop, d);
  const { data: number, error } = await sb.rpc('next_doc_no', { kind: 'kontrak' });
  if (error || !number) { console.error(error); throw new HttpError(500, 'Gagal membuat nomor kontrak.'); }
  const renewedFrom = b.renewedFrom ? str(b.renewedFrom, 40) : null;
  const rec = await insert('contracts', { number, tenantId: t.id, roomId: room.id, propertyId: room.propertyId, ...d, body, status: 'menunggu', renewedFrom });
  if (renewedFrom) await q(sb.from('contracts').update({ decision_handled_at: new Date().toISOString() }).eq('id', renewedFrom).eq('tenant_id', t.id));
  if (t.email) mail.send({
    to: t.email, kind: 'contract.new', dedupeKey: `contract.new:${rec.id}`,
    subject: `Kontrak sewa ${number} menunggu persetujuan Anda`, title: renewedFrom ? 'Kontrak perpanjangan siap disetujui' : 'Kontrak sewa siap disetujui',
    intro: `Horas ${t.name}, kontrak sewa kamar Anda sudah dibuat. Baca isinya lalu setujui di dashboard penghuni.`,
    rows: [['Nomor', number], ['Kamar', room.code], ['Masa sewa', `${tanggal(d.startDate)} s.d. ${tanggal(d.endDate)}`], ['Sewa', `${rupiah(d.rentAmount)} per ${CYCLE_WORD[d.rentCycle] || 'bulan'}`]],
    cta: { label: 'Baca & setujui kontrak', url: PENGHUNI_URL },
  });
  log({ action: 'contract.create', summary: `Membuat kontrak ${number} untuk ${t.name} (${tanggal(d.startDate)} s.d. ${tanggal(d.endDate)})${renewedFrom ? ', perpanjangan' : ''}`, target: room.code });
  return created(contractOut(rec));
});
on('PUT', '/admin/contracts/:id', async ({ params, body: b }, log) => {
  const c = await one('contracts', params.id); if (!c) throw notFound('Kontrak tidak ditemukan.');
  if (c.status !== 'menunggu') throw bad('Kontrak yang sudah disetujui tidak bisa diubah. Buat kontrak baru bila perlu.');
  const t = await one('tenants', c.tenantId);
  const d = contractInput({ ...pick(c, ['startDate', 'endDate', 'rentCycle', 'rentAmount', 'deposit']), ...b }, t!);
  const body = str(b.body, 30000) || c.body;
  const rec = await update('contracts', c.id, { ...d, body });
  log({ action: 'contract.update', summary: `Mengubah kontrak ${c.number} (${t?.name})` });
  return contractOut(rec);
});
on('POST', '/admin/contracts/:id/cancel', async ({ params }, log) => {
  const c = await one('contracts', params.id); if (!c) throw notFound('Kontrak tidak ditemukan.');
  if (c.status !== 'menunggu') throw bad('Hanya kontrak yang belum disetujui yang bisa dibatalkan.');
  const rec = await update('contracts', c.id, { status: 'dibatalkan' });
  log({ action: 'contract.cancel', summary: `Membatalkan kontrak ${c.number}` });
  return contractOut(rec);
});
on('POST', '/admin/contracts/:id/handled', async ({ params }, log) => {
  const c = await one('contracts', params.id); if (!c) throw notFound('Kontrak tidak ditemukan.');
  const rec = await update('contracts', c.id, { decisionHandledAt: new Date().toISOString() });
  log({ action: 'contract.handled', summary: `Menandai keputusan "${c.decision}" pada kontrak ${c.number} sudah ditindaklanjuti` });
  return contractOut(rec);
});
on('GET', '/admin/contracts/:id/pdf', async ({ params }, log) => {
  const c = await one('contracts', params.id); if (!c) throw notFound('Kontrak tidak ditemukan.');
  log({ action: 'contract.download', summary: `Mengunduh PDF kontrak ${c.number}`, dedupeMinutes: 10 });
  return pdfOut(await contractBytes(c), `kontrak-${fileSafe(c.number)}.pdf`);
});

// ================================================================ ADMIN — kondisi kamar
const CONDITIONS = ['baik', 'kurang', 'rusak', 'tidak_ada'];
const MAX_INSPECTION_ITEMS = 100;
const MAX_INSPECTION_PHOTOS = 12;
on('POST', '/admin/inspections', async ({ body: b }, log) => {
  const t = await one('tenants', str(b.tenantId, 40)); if (!t) throw bad('Pilih penghuni.');
  if (!['masuk', 'keluar'].includes(b.kind)) throw bad('Pilih kondisi saat masuk atau keluar.');
  if (!isDate(b.date)) throw bad('Isi tanggal pemeriksaan.');
  if (!Array.isArray(b.items) || !b.items.length) throw bad('Isi minimal satu barang/bagian kamar.');
  if (b.items.length > MAX_INSPECTION_ITEMS) throw bad(`Maksimal ${MAX_INSPECTION_ITEMS} bagian kamar dalam satu catatan kondisi.`);
  // Jumlah foto & bagian tidak lagi dipotong diam-diam: bila terlalu banyak, admin diberi tahu.
  const items = b.items.map((it: Row) => {
    const photos = (Array.isArray(it.photos) ? it.photos : []).map((p: unknown) => str(p, 200)).filter((p: string) => p.startsWith(`inspections/${t.id}/`));
    if (photos.length > MAX_INSPECTION_PHOTOS) throw bad(`Foto per bagian kamar maksimal ${MAX_INSPECTION_PHOTOS}: ${str(it.name, 80)}.`);
    return {
      name: str(it.name, 80), condition: CONDITIONS.includes(it.condition) ? it.condition : 'baik', note: str(it.note, 300),
      photos,
    };
  }).filter((it: Row) => it.name);
  const patch = { tenantId: t.id, roomId: t.roomId, kind: b.kind, date: b.date, items, note: str(b.note, 1500), depositDeduction: depositDeduction(b.depositDeduction), deductionNote: str(b.deductionNote, 600), tenantAckAt: null, tenantNote: '' };
  const existing = toCamel(await q(sb.from('room_inspections').select('id').eq('tenant_id', t.id).eq('kind', b.kind).maybeSingle()));
  const rec = existing ? await update('room_inspections', existing.id, patch) : await insert('room_inspections', patch);
  const bad_ = items.filter((i: Row) => i.condition !== 'baik').length;
  log({ action: existing ? 'inspection.update' : 'inspection.create', summary: `${existing ? 'Memperbarui' : 'Mencatat'} kondisi kamar saat ${b.kind} untuk ${t.name}: ${items.length} bagian, ${bad_} bermasalah${patch.depositDeduction ? `, potongan deposit ${rupiah(patch.depositDeduction)}` : ''}`, target: (await one('rooms', t.roomId))?.code });
  return existing ? rec : created(rec);
});
on('DELETE', '/admin/inspections/:id', async ({ params }, log) => {
  const x = await one('room_inspections', params.id); if (!x) throw notFound('Catatan tidak ditemukan.');
  const paths = (x.items || []).flatMap((i: Row) => i.photos || []);
  await remove('room_inspections', x.id);
  if (paths.length) background(Promise.resolve(sb.storage.from('private').remove(paths)));
  log({ action: 'inspection.delete', summary: `Menghapus catatan kondisi kamar saat ${x.kind}` });
  return { ok: true };
});

// ================================================================ ADMIN — kuitansi, daftar tunggu
on('GET', '/admin/invoices/:id/receipt.pdf', async ({ params }, log) => {
  const inv = await one('invoices', params.id); if (!inv) throw notFound('Tagihan tidak ditemukan.');
  const bytes = await receiptFor(inv);
  const d = await invoiceDesc(inv.id);
  log({ action: 'receipt.download', summary: `Mengunduh kuitansi ${d.text}`, target: d.target, dedupeMinutes: 10 });
  return pdfOut(bytes, `kuitansi-${fileSafe(d.text)}.pdf`);
});
function priceText(r: Row) {
  const parts = CYCLES.filter((c) => roomPrice(r, c)).map((c) => `${rupiah(roomPrice(r, c))} per ${CYCLE_WORD[c]}`);
  return parts.length ? `Harga ${parts.join(' atau ')}.` : '';
}
on('GET', '/admin/waitlist', async () => {
  const [list, props, rooms] = await Promise.all([all('waitlist'), all('properties'), all('rooms')]);
  const pm = new Map(props.map((p) => [p.id, p.name])); const rm = new Map(rooms.map((r) => [r.id, r]));
  const s = await getSettings();
  return list.map((w) => {
    const r = w.matchedRoomId ? rm.get(w.matchedRoomId) : null;
    const msg = r
      ? `Horas ${w.name}, kabar baik dari ${pm.get(r.propertyId) || 'Bonaasina'}: kamar ${r.code}${r.type ? ` (${r.type})` : ''} sekarang kosong. ${priceText(r)} Masih berminat? Balas pesan ini untuk atur jadwal survei.`
      : `Horas ${w.name}, terima kasih sudah mendaftar di daftar tunggu ${w.propertyId ? pm.get(w.propertyId) : 'Bonaasina'}. `;
    return { ...w, propertyName: w.propertyId ? pm.get(w.propertyId) || '-' : 'Kos mana saja', matchedRoom: r ? { code: r.code, propertyName: pm.get(r.propertyId), status: r.status } : null, waUrl: waLink(w.phone, msg), ownerName: s.ownerName };
  }).sort((a, b) => (a.status === 'perlu_dikabari') === (b.status === 'perlu_dikabari') ? a.createdAt.localeCompare(b.createdAt) : a.status === 'perlu_dikabari' ? -1 : 1);
});
on('PUT', '/admin/waitlist/:id', async ({ params, body: b }, log) => {
  const w = await one('waitlist', params.id); if (!w) throw notFound('Data tidak ditemukan.');
  const patch: Row = {};
  if (b.status !== undefined) {
    if (!['menunggu', 'perlu_dikabari', 'dikabari', 'selesai', 'batal'].includes(b.status)) throw bad('Status tidak dikenal.');
    patch.status = b.status; if (b.status === 'dikabari') patch.notifiedAt = new Date().toISOString();
    if (b.status === 'menunggu') { patch.matchedRoomId = null; patch.matchedAt = null; }
  }
  if (b.note !== undefined) patch.note = str(b.note, 600);
  const rec = await update('waitlist', w.id, patch);
  log({ action: 'waitlist.update', summary: `Mengubah daftar tunggu ${w.name} menjadi ${WAITLIST_LABEL[rec.status] || rec.status}` });
  return rec;
});
on('DELETE', '/admin/waitlist/:id', async ({ params }, log) => {
  const w = await one('waitlist', params.id); const out = await remove('waitlist', params.id);
  log({ action: 'waitlist.delete', summary: `Menghapus ${w?.name || ''} dari daftar tunggu`.trim() });
  return out;
});
const WAITLIST_LABEL: Record<string, string> = { menunggu: 'Menunggu', perlu_dikabari: 'Perlu dikabari', dikabari: 'Sudah dikabari', selesai: 'Selesai', batal: 'Batal' };

// ================================================================ ADMIN — pengumuman
on('GET', '/admin/announcements', async () => {
  const [list, tenants, rooms, props] = await Promise.all([
    all('announcements'), q<Row[]>(sb.from('tenants').select('id, name, phone, room_id').eq('status', 'aktif')), all('rooms'), all('properties'),
  ]);
  // Dibaca per pengumuman, dipotong per 100 id lalu per halaman: pembacaan di atas 1000 baris tidak lagi hilang.
  const reads = await rowsIn('announcement_reads', 'announcement_id', list.map((a) => a.id));
  const rm = new Map(rooms.map((r) => [r.id, r])); const pm = new Map(props.map((p) => [p.id, p.name]));
  return list.map((a) => {
    const audience = (tenants || []).filter((t) => !a.propertyId || rm.get(t.room_id)?.propertyId === a.propertyId);
    const readers = new Map((reads || []).filter((r) => r.announcement_id === a.id).map((r) => [r.tenant_id, r.read_at]));
    return {
      ...a, propertyName: a.propertyId ? pm.get(a.propertyId) || '-' : 'Semua kos', audienceCount: audience.length,
      read: audience.filter((t) => readers.has(t.id)).map((t) => ({ name: t.name, readAt: readers.get(t.id) })),
      unread: audience.filter((t) => !readers.has(t.id)).map((t) => ({ name: t.name, waUrl: t.phone ? waLink(t.phone, `Horas ${t.name}, ada pengumuman baru di dashboard penghuni Bonaasina: "${a.title}". Mohon dibaca ya. Terima kasih.`) : null })),
    };
  }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
});
function annFromBody(b: Row) {
  const a: Row = {};
  if (b.title !== undefined) a.title = str(b.title, 120);
  if (b.body !== undefined) a.body = str(b.body, 4000);
  if (b.priority !== undefined) a.priority = b.priority === 'penting' ? 'penting' : 'biasa';
  if (b.propertyId !== undefined) a.propertyId = b.propertyId ? str(b.propertyId, 60) : null;
  if (b.pinned !== undefined) a.pinned = !!b.pinned;
  if (b.expiresOn !== undefined) { if (b.expiresOn && !isDate(b.expiresOn)) throw bad('Tanggal berakhir tidak valid.'); a.expiresOn = b.expiresOn || null; }
  return a;
}
on('POST', '/admin/announcements', async ({ body: b }, log) => {
  const a = annFromBody(b); if (!a.title) throw bad('Isi judul pengumuman.');
  const rec = await insert('announcements', a);
  background((async () => {
    const [ts, rooms] = await Promise.all([q<Row[]>(sb.from('tenants').select('id, name, email, room_id').eq('status', 'aktif').neq('email', '')), all('rooms')]);
    const rm = new Map(rooms.map((r) => [r.id, r.propertyId]));
    for (const t of (ts || []).filter((x) => !rec.propertyId || rm.get(x.room_id) === rec.propertyId)) {
      mail.send({
        to: t.email, kind: 'announcement', dedupeKey: `announcement:${rec.id}:${t.id}`, subject: `${rec.priority === 'penting' ? '[Penting] ' : ''}Pengumuman: ${rec.title}`,
        title: rec.title, intro: rec.body || '', cta: { label: 'Buka dashboard penghuni', url: PENGHUNI_URL },
      });
    }
  })());
  log({ action: 'announcement.create', summary: `Membuat pengumuman${rec.priority === 'penting' ? ' PENTING' : ''}: ${rec.title}` });
  return created(rec);
});
on('PUT', '/admin/announcements/:id', async ({ params, body: b }, log) => {
  const a = annFromBody(b); if (a.title === '') throw bad('Isi judul pengumuman.');
  const rec = await update('announcements', params.id, a);
  // Isi berubah → minta dibaca ulang.
  if (b.resetReads) await q(sb.from('announcement_reads').delete().eq('announcement_id', rec.id));
  log({ action: 'announcement.update', summary: `Mengubah pengumuman: ${rec.title}` });
  return rec;
});
on('DELETE', '/admin/announcements/:id', async ({ params }, log) => {
  const a = await one('announcements', params.id); const out = await remove('announcements', params.id);
  log({ action: 'announcement.delete', summary: `Menghapus pengumuman: ${a?.title || ''}` });
  return out;
});

// ================================================================ ADMIN — piket
on('GET', '/admin/chores', async () => {
  const today = todayStr();
  const from = fmt(new Date(parse(today).getTime() - 21 * DAY)); const to = fmt(new Date(parse(today).getTime() + 21 * DAY));
  const [tasks, props] = await Promise.all([all('chore_tasks'), all('properties')]);
  const pm = new Map(props.map((p) => [p.id, p.name]));
  const sched = await choreSchedule(null, from, to);
  const signed = await signMany(sched.items.flatMap((i) => i.report?.photos || []), 1800);
  const nameOf = new Map<string, string>(); for (const i of sched.items) for (const p of i.assigned) nameOf.set(p.id, p.name);
  return {
    today,
    tasks: tasks.map((t) => ({ ...t, propertyName: pm.get(t.propertyId) || '-' })).sort((a, b) => a.propertyName.localeCompare(b.propertyName) || a.name.localeCompare(b.name)),
    items: sched.items.map((i) => ({
      ...i, propertyName: pm.get(i.propertyId) || '-', assigned: i.assigned.map((p: Row) => `${p.name}${p.roomCode ? ` (${p.roomCode})` : ''}`),
      status: i.report ? 'selesai' : i.date < today ? 'terlewat' : i.date === today ? 'hari_ini' : 'akan_datang',
      report: i.report ? { id: i.report.id, note: i.report.note, by: nameOf.get(i.report.tenantId) || 'Penghuni', at: i.report.createdAt, photos: (i.report.photos || []).map((p: string) => signed.get(p)).filter(Boolean) } : null,
    })),
  };
});
function choreFromBody(b: Row) {
  const c: Row = {};
  if (b.propertyId !== undefined) c.propertyId = str(b.propertyId, 60);
  if (b.name !== undefined) c.name = str(b.name, 100);
  if (b.description !== undefined) c.description = str(b.description, 600);
  if (b.frequency !== undefined) { if (!['harian', 'mingguan', 'dua_mingguan', 'bulanan'].includes(b.frequency)) throw bad('Pilih frekuensi piket.'); c.frequency = b.frequency; }
  if (b.mode !== undefined) { if (!['bergilir', 'bersama'].includes(b.mode)) throw bad('Pilih cara piket.'); c.mode = b.mode; }
  if (b.peoplePerTurn !== undefined) c.peoplePerTurn = Math.min(20, Math.max(1, num(b.peoplePerTurn) || 1));
  if (b.startDate !== undefined) { if (!isDate(b.startDate)) throw bad('Isi tanggal mulai piket.'); c.startDate = b.startDate; }
  if (b.active !== undefined) c.active = !!b.active;
  return c;
}
on('POST', '/admin/chores', async ({ body: b }, log) => {
  const c = choreFromBody(b);
  if (!c.name) throw bad('Isi nama tugas piket.');
  const prop = await one('properties', c.propertyId); if (!prop) throw bad('Pilih kos.');
  if (!c.startDate) throw bad('Isi tanggal mulai piket.');
  const rec = await insert('chore_tasks', { frequency: 'mingguan', mode: 'bergilir', peoplePerTurn: 1, active: true, ...c });
  log({ action: 'chore.create', summary: `Membuat jadwal piket "${rec.name}" di ${prop.name}` });
  return created(rec);
});
on('PUT', '/admin/chores/:id', async ({ params, body: b }, log) => {
  const cur = await one('chore_tasks', params.id); if (!cur) throw notFound('Jadwal piket tidak ditemukan.');
  const c = choreFromBody(b); delete c.propertyId;
  // Mengubah tanggal mulai atau frekuensi memindahkan tanggal giliran, sehingga laporan yang sudah
  // dikirim (foto bukti) tidak lagi punya jadwal. Perubahan ditahan dengan pesan jelas kecuali admin
  // mengirim force: true.
  const shifting = (c.startDate && c.startDate !== cur.startDate) || (c.frequency && c.frequency !== cur.frequency);
  if (shifting && b.force !== true && b.force !== 'true') {
    const reports = await pages<Row>((from, to) => sb.from('chore_reports').select('due_date').eq('task_id', cur.id).range(from, to));
    if (reports.length) {
      const from = fmt(new Date(parse(todayStr()).getTime() - 730 * DAY));
      const to = fmt(new Date(parse(todayStr()).getTime() + 730 * DAY));
      const valid = new Set(choreDates({ ...cur, ...c }, from, to).map((d) => d.date));
      const lost = reports.filter((r) => !valid.has(r.due_date));
      if (lost.length) throw bad(`Perubahan ini membuat ${lost.length} laporan piket yang sudah dikirim (mis. ${tanggal(lost[0].due_date)}) tidak lagi punya jadwal, jadi bukti fotonya tidak akan tampil. Kirim ulang dengan force: true bila tetap ingin mengubahnya.`);
    }
  }
  const rec = await update('chore_tasks', params.id, c);
  log({ action: 'chore.update', summary: `Mengubah jadwal piket "${rec.name}"${c.active === false ? ' (dinonaktifkan)' : ''}` });
  return rec;
});
on('DELETE', '/admin/chores/:id', async ({ params }, log) => {
  const c = await one('chore_tasks', params.id); const out = await remove('chore_tasks', params.id);
  log({ action: 'chore.delete', summary: `Menghapus jadwal piket "${c?.name || ''}"` });
  return out;
});

// ================================================================ KOS SEKITAR (market.ts)
const market = createMarket({
  sb, q, one, insert, update, str, num, strList, isDate, pick, toCamel, bad, notFound, HttpError, on, created,
  all, pages, rowsIn,
  readImage, putFile, signedUrl, signMany, readPrivate, pdfOut, fileSafe, sha256, randomToken, bcrypt, writeLog, clientInfo,
  background, getSettings, normalizePhone, rupiah, tanggal, todayStr, addMonths, DAY, roomFromBody, propertyPatch,
  PUBLIC_PROPERTY_FIELDS, PUBLIC_ROOM_FIELDS, PHOTO_PREFIX, SITE_URL, matchWaitlist, routes, CYCLES, roomPrice, extraFee, waLink, byCode, bySort, createProperty,
  mail, emailField,
});

// ================================================================ TITIP JUALAN & TEMPAT SEKITAR (community.ts)
const community = createCommunity({
  sb, q, one, insert, update, str, num, isDate, pick, toCamel, bad, notFound, HttpError, on, created, readImage, putFile, randomToken, clientInfo,
  all, pages, rowsIn,
  normalizePhone, todayStr, PHOTO_PREFIX, SITE_URL,
});

// ---------------------------------------------------------------- server
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tenant-session, x-owner-session, x-lead-session',
  'Access-Control-Expose-Headers': 'x-sb-edge-region',
  'Access-Control-Max-Age': '86400',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

// Token yang sudah diverifikasi disimpan sebentar (60 detik) di memori instance, supaya setiap klik menu
// tidak perlu dua perjalanan tambahan ke server Auth dan tabel admins.
const adminCache = new Map<string, { email: string; until: number }>();
async function requireAdmin(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Silakan masuk dulu.');
  const hit = adminCache.get(token);
  if (hit && hit.until > Date.now()) return hit.email;
  const { data, error } = await sb.auth.getUser(token);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) throw new HttpError(401, 'Sesi berakhir. Silakan masuk lagi.');
  if (!(await q<Row | null>(sb.from('admins').select('email').eq('email', email).maybeSingle()))) {
    writeLog(req, 'admin', email, { action: 'access.denied', summary: 'Akun yang bukan admin mencoba membuka admin', ok: false, dedupeMinutes: 10 });
    throw new HttpError(403, 'Akun ini bukan admin Bonaasina.');
  }
  if (adminCache.size > 200) adminCache.clear();
  adminCache.set(token, { email, until: Date.now() + 60e3 });
  return email;
}
// Sesi penghuni: token acak di header X-Tenant-Session (disimpan sebagai hash). Hasil verifikasi disimpan 60 detik.
const tenantCache = new Map<string, { t: Row; until: number }>();
async function requireTenant(req: Request) {
  const token = req.headers.get('x-tenant-session') || '';
  if (token.length < 20) throw new HttpError(401, 'Silakan masuk dulu.');
  const hit = tenantCache.get(token);
  if (hit && hit.until > Date.now()) return hit.t;
  const sess = await q<Row | null>(sb.from('tenant_sessions').select('*').eq('token_hash', await sha256(token)).maybeSingle());
  if (!sess || sess.expires_at < new Date().toISOString()) throw new HttpError(401, 'Sesi berakhir. Silakan masuk lagi.');
  const t = await one('tenants', sess.tenant_id);
  if (!t || t.status !== 'aktif' || !t.loginEnabled) throw new HttpError(401, 'Akun tidak aktif. Hubungi pengelola.');
  // Sesi diperpanjang paling sering sekali per jam.
  if (Date.now() - new Date(sess.last_seen_at).getTime() > 3600e3) {
    background(Promise.resolve(sb.from('tenant_sessions').update({ last_seen_at: new Date().toISOString(), expires_at: new Date(Date.now() + SESSION_DAYS * DAY).toISOString() }).eq('token_hash', sess.token_hash)));
  }
  if (tenantCache.size > 500) tenantCache.clear();
  tenantCache.set(token, { t, until: Date.now() + 60e3 });
  return t;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  // Path setelah nama fungsi: /functions/v1/api/admin/summary → /admin/summary
  const path = url.pathname.replace(/^.*?\/api(?=\/|$)/, '') || '/';
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = path.match(r.re); if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const ctx: Ctx = { req, url, params, body: {} };
      if (r.area === 'admin') ctx.adminEmail = await requireAdmin(req);
      if (r.area === 'penghuni') ctx.tenant = await requireTenant(req);
      if (r.area === 'pemilik') ctx.owner = await market.requireOwner(req);
      if (r.area === 'akun') ctx.lead = await market.requireLead(req);
      if (!r.raw && ['POST', 'PUT'].includes(req.method)) {
        const text = await req.text();
        if (text.length > 200_000) throw new HttpError(413, 'Data terlalu besar.');
        try { ctx.body = text ? JSON.parse(text) : {}; } catch { throw bad('Data yang dikirim tidak bisa dibaca.'); }
      }
      const out = await r.fn(ctx, (e) => { ctx.log = e; });
      if (ctx.log) {
        const type: ActorType = path.startsWith('/admin') ? 'admin' : path.startsWith('/penghuni') || (path === '/masuk' && ctx.log.action.startsWith('tenant')) ? 'penghuni'
          : path.startsWith('/pemilik') ? 'pemilik' : path.startsWith('/akun') ? 'customer' : 'publik';
        const actor = ctx.adminEmail || ctx.tenant?.name || ctx.owner?.name || (ctx.lead ? `${ctx.lead.name} (${ctx.lead.username})` : '') || str(ctx.body.name, 80) || str(ctx.body.email, 200).toLowerCase() || str(ctx.body.username, 60) || 'Pengunjung';
        writeLog(req, type, actor, ctx.log, type === 'penghuni' ? ctx.tenant?.roomId : undefined);
      }
      // Perubahan data oleh admin bisa memengaruhi tagihan otomatis: buat ulang pada permintaan berikutnya.
      if (req.method !== 'GET' && r.area === 'admin') lastAutoGen = 0;
      if (out instanceof Response) { for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v); return out; }
      if (out && typeof out === 'object' && (out as Row).__status) return json((out as Row).__status, (out as Row).body);
      return json(200, out ?? { ok: true });
    }
    return json(404, { error: 'Alamat API tidak ditemukan.' });
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error(e);
    return json(500, { error: 'Terjadi kesalahan di server. Coba lagi.' });
  }
});
