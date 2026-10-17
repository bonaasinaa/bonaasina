// Bonaasina API — Supabase Edge Function (Deno).
// Satu fungsi melayani tiga kelompok:
//   /public, /surveys          → calon penyewa (tanpa login)
//   /portal/...                → penghuni (token pribadi di header X-Portal-Token)
//   /admin/...                 → pemilik (token login Supabase Auth, email harus terdaftar di tabel admins)
// Fungsi ini memakai kunci rahasia (melewati RLS); tabel tidak bisa diakses dari browser secara langsung.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const secretKeys = safeJson(Deno.env.get('SUPABASE_SECRET_KEYS'));
const publishableKeys = safeJson(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'));
const SECRET = secretKeys?.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUBLISHABLE = publishableKeys?.default ?? Deno.env.get('SUPABASE_ANON_KEY')!;
const PHOTO_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/photos/`;
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
const strList = (v: unknown, max = 40) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : []).map((x) => str(x, 200)).filter(Boolean).slice(0, max);
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
const all = async (table: string, order = 'created_at') => ((await q<Row[]>(sb.from(table).select('*').order(order))) || []).map((r) => toCamel(r)!);
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
const tanggal = (s?: string | null) => { if (!s) return ''; const d = parse(s); return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
function periodLabel(t: Row, start: string) {
  const s = parse(start);
  if (t.rentCycle === 'tahunan') {
    const e = parse(addMonths(start, 12)); e.setUTCDate(e.getUTCDate() - 1);
    return `${s.getUTCDate()} ${BULAN[s.getUTCMonth()]} ${s.getUTCFullYear()} – ${e.getUTCDate()} ${BULAN[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
  }
  return `${BULAN[s.getUTCMonth()]} ${s.getUTCFullYear()}`;
}
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

// Buat tagihan yang sudah waktunya (idempoten: unik per penghuni + awal periode).
async function generateInvoices(tenantId?: string) {
  const settings = await getSettings();
  const lead = Number(settings.invoiceLeadDays ?? 7);
  const limit = fmt(new Date(parse(todayStr()).getTime() + lead * DAY));
  let tq = sb.from('tenants').select('*').eq('status', 'aktif');
  if (tenantId) tq = tq.eq('id', tenantId);
  const tenants = ((await q<Row[]>(tq)) || []).map((r) => toCamel(r)!);
  if (!tenants.length) return 0;
  const existing = ((await q<Row[]>(sb.from('invoices').select('tenant_id, period_start').in('tenant_id', tenants.map((t) => t.id)))) || [])
    .map((r) => `${r.tenant_id}|${r.period_start}`);
  const seen = new Set(existing);
  const rooms = new Map(((await q<Row[]>(sb.from('rooms').select('id, property_id'))) || []).map((r) => [r.id, r.property_id]));
  const rows: Row[] = [];
  for (const t of tenants) {
    if (!t.startDate || !t.rentAmount) continue;
    for (let k = 0; k < 600; k++) {
      const start = t.rentCycle === 'tahunan' ? addMonths(t.startDate, 12 * k) : addMonths(t.startDate, k);
      if (start > limit || (t.endDate && start >= t.endDate)) break;
      if (seen.has(`${t.id}|${start}`) || (t.billFrom && start < t.billFrom)) continue;
      rows.push({ tenant_id: t.id, room_id: t.roomId, property_id: rooms.get(t.roomId) ?? null, period_start: start, period_label: periodLabel(t, start), cycle: t.rentCycle, due_date: start, amount: t.rentAmount, status: 'belum' });
      seen.add(`${t.id}|${start}`);
    }
  }
  if (rows.length) await q(sb.from('invoices').upsert(rows, { onConflict: 'tenant_id,period_start', ignoreDuplicates: true }));
  return rows.length;
}

const DEFAULT_TEMPLATE =
  'Horas {nama}, ini pengingat dari {kos}.\n\nTagihan sewa kamar {kamar} untuk periode {periode} sebesar {jumlah} jatuh tempo {jatuh_tempo}.{keterlambatan}\n\n' +
  'Pembayaran bisa ditransfer ke:\n{rekening}\n\nSetelah bayar, unggah bukti transfer di portal penghuni Anda:\n{portal}\n\nTerima kasih.';

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
// akses portal penghuni, permintaan survei, dan percobaan akses yang gagal.
// Kunjungan halaman publik tidak dicatat di sini (itu tugas Google Analytics).
type ActorType = 'admin' | 'penghuni' | 'publik';
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
const STATUS_LABEL: Record<string, string> = { kosong: 'Kosong', terisi: 'Terisi', dipesan: 'Dipesan', perbaikan: 'Perbaikan', baru: 'Baru', dikonfirmasi: 'Dikonfirmasi', selesai: 'Selesai', batal: 'Batal', dikerjakan: 'Sedang dikerjakan' };
async function invoiceDesc(id: string) {
  const r = await q<Row | null>(sb.from('invoices').select('period_label, amount, tenants(name), rooms(code)').eq('id', id).maybeSingle());
  return r ? { text: `${r.tenants?.name || 'penghuni'}, ${r.period_label} (${rupiah(r.amount)})`, target: r.rooms?.code || null } : { text: 'tagihan', target: null };
}

// ---------------------------------------------------------------- router
type Ctx = { req: Request; url: URL; params: Record<string, string>; body: Row; tenant?: Row; adminEmail?: string; log?: LogEntry | null };
// Handler memanggil log({...}) untuk mencatat aktivitasnya; catatan ditulis setelah handler berhasil.
type Handler = (c: Ctx, log: (e: LogEntry) => void) => Promise<unknown> | unknown;
const routes: { method: string; re: RegExp; keys: string[]; area: 'public' | 'portal' | 'admin'; raw: boolean; fn: Handler }[] = [];
function on(method: string, path: string, fn: Handler, opts: { raw?: boolean } = {}) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  const area = path.startsWith('/admin') && !/^\/admin\/(login|refresh|setup)$/.test(path) ? 'admin' : path.startsWith('/portal') ? 'portal' : 'public';
  routes.push({ method, re, keys, area, raw: !!opts.raw, fn });
}
const created = (body: unknown) => ({ __status: 201, body });

// ================================================================ PUBLIK
on('GET', '/public', async () => {
  const [s, props, rooms, active] = await Promise.all([
    getSettings(), all('properties'), all('rooms'),
    q<Row[]>(sb.from('tenants').select('room_id').eq('status', 'aktif')),
  ]);
  const occ = new Set((active || []).map((t) => t.room_id));
  return {
    site: pick(s, ['siteName', 'tagline', 'ownerName', 'whatsapp', 'depositInfo', 'paymentMethods', 'faq', 'heroWords', 'surveyHours']),
    whatsappNormalized: normalizePhone(s.whatsapp),
    properties: props.sort(bySort).map((p) => pick(p, ['id', 'slug', 'name', 'shortName', 'logo', 'gender', 'tagline', 'description', 'address', 'mapsQuery', 'facilities', 'rules', 'nearby', 'photos'])),
    rooms: rooms.filter((r) => !r.hidden).map((r) => ({
      ...pick(r, ['id', 'propertyId', 'code', 'type', 'sizeM2', 'floor', 'priceMonthly', 'priceYearly', 'facilities', 'photos', 'note']),
      status: occ.has(r.id) ? 'terisi' : r.status,
    })).sort(byCode),
  };
});

on('POST', '/surveys', async ({ body: b }, log) => {
  if (b.website) return { ok: true }; // honeypot
  const name = str(b.name, 80), phone = str(b.phone, 20), propertyId = str(b.propertyId, 40);
  if (!name) throw bad('Isi nama Anda.');
  if (normalizePhone(phone).length < 10) throw bad('Nomor WhatsApp belum benar. Contoh: 0812 3456 7890.');
  if (!(await one('properties', propertyId))) throw bad('Pilih kos yang ingin disurvei.');
  if (!isDate(b.date) || b.date < todayStr()) throw bad('Pilih tanggal survei hari ini atau setelahnya.');
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count } = await sb.from('surveys').select('id', { count: 'exact', head: true }).eq('phone', phone).gte('created_at', since);
  if ((count ?? 0) >= 3) throw new HttpError(429, 'Permintaan dari nomor ini sudah cukup banyak. Silakan hubungi lewat WhatsApp.');
  const roomId = b.roomId && (await one('rooms', str(b.roomId, 40))) ? str(b.roomId, 40) : null;
  const rec = await insert('surveys', {
    propertyId, roomId, name, phone, date: b.date, time: str(b.time, 20), occupation: str(b.occupation, 80),
    duration: ['bulanan', 'tahunan', 'belum tahu'].includes(b.duration) ? b.duration : 'belum tahu', note: str(b.note, 600),
  });
  const prop = await one('properties', propertyId);
  log({ action: 'survey.create', summary: `Mengirim permintaan survei ${prop?.name || ''} untuk ${tanggal(b.date)}`, target: rec.roomId ? (await one('rooms', rec.roomId))?.code : null, meta: { name } });
  return created({ ok: true, id: rec.id });
});

// ================================================================ PORTAL PENGHUNI (Fase 2)
on('GET', '/portal/me', async ({ tenant: t }, log) => {
  log({ action: 'portal.open', summary: 'Membuka portal penghuni', dedupeMinutes: 30 });
  await generateInvoices(t!.id);
  const [s, room, invoices, issues] = await Promise.all([
    getSettings(), one('rooms', t!.roomId),
    q<Row[]>(sb.from('invoices').select('*').eq('tenant_id', t!.id).order('due_date', { ascending: false })),
    q<Row[]>(sb.from('issues').select('*').eq('tenant_id', t!.id).order('created_at', { ascending: false })),
  ]);
  const prop = room ? await one('properties', room.propertyId) : null;
  const today = todayStr();
  return {
    tenant: pick(t!, ['name', 'rentCycle', 'rentAmount', 'startDate', 'deposit']),
    room: room ? pick(room, ['code', 'type', 'sizeM2', 'floor']) : null,
    property: prop ? pick(prop, ['name', 'logo', 'address', 'rules']) : null,
    owner: { name: s.ownerName || '', whatsapp: normalizePhone(s.whatsapp) },
    paymentInfo: s.paymentInfo || '', paymentMethods: s.paymentMethods || '',
    invoices: (invoices || []).map((r) => {
      const i = decorate(toCamel(r)!, today);
      return pick(i, ['id', 'periodLabel', 'cycle', 'dueDate', 'amount', 'status', 'paidAt', 'paidAmount', 'method', 'overdue', 'overdueDays', 'proofStatus', 'proofNote', 'proofUploadedAt']);
    }),
    issues: (issues || []).map((r) => pick(toCamel(r)!, ['id', 'category', 'title', 'description', 'status', 'ownerNote', 'createdAt', 'updatedAt', 'photoPath'])).map((i) => ({ ...i, hasPhoto: !!i.photoPath, photoPath: undefined })),
  };
});

on('POST', '/portal/invoices/:id/proof', async ({ req, params, tenant: t }, log) => {
  const inv = await one('invoices', params.id);
  if (!inv || inv.tenantId !== t!.id) throw notFound('Tagihan tidak ditemukan.');
  if (inv.status === 'lunas') throw bad('Tagihan ini sudah lunas.');
  const { buf, type, ext } = await readImage(req);
  const path = `proofs/${t!.id}/${inv.id}-${Date.now()}.${ext}`;
  await putFile('private', path, buf, type);
  const rec = await update('invoices', inv.id, { proofPath: path, proofStatus: 'menunggu', proofNote: null, proofUploadedAt: new Date().toISOString() });
  log({ action: 'portal.proof', summary: `Mengunggah bukti bayar ${inv.periodLabel} (${rupiah(inv.amount)})` });
  return pick(rec, ['id', 'proofStatus', 'proofUploadedAt']);
}, { raw: true });

const ISSUE_CATS = ['Listrik', 'Air & kamar mandi', 'Pintu & kunci', 'Perabot', 'WiFi', 'Kebersihan', 'Lainnya'];
on('POST', '/portal/issues', async ({ body: b, tenant: t }, log) => {
  const title = str(b.title, 120);
  if (!title) throw bad('Tulis singkat apa yang rusak.');
  const { count } = await sb.from('issues').select('id', { count: 'exact', head: true }).eq('tenant_id', t!.id).gte('created_at', new Date(Date.now() - DAY).toISOString());
  if ((count ?? 0) >= 10) throw new HttpError(429, 'Laporan hari ini sudah banyak. Hubungi pemilik lewat WhatsApp.');
  const room = await one('rooms', t!.roomId);
  const rec = await insert('issues', {
    tenantId: t!.id, roomId: t!.roomId, propertyId: room?.propertyId ?? null,
    category: ISSUE_CATS.includes(b.category) ? b.category : 'Lainnya', title, description: str(b.description, 1500),
  });
  log({ action: 'portal.issue', summary: `Melaporkan kerusakan: ${title}`, target: room?.code });
  return created(pick(rec, ['id', 'category', 'title', 'description', 'status', 'createdAt']));
});
on('POST', '/portal/issues/:id/photo', async ({ req, params, tenant: t }, log) => {
  const iss = await one('issues', params.id);
  if (!iss || iss.tenantId !== t!.id) throw notFound('Laporan tidak ditemukan.');
  const { buf, type, ext } = await readImage(req);
  const path = `issues/${t!.id}/${iss.id}-${Date.now()}.${ext}`;
  await putFile('private', path, buf, type);
  await update('issues', iss.id, { photoPath: path });
  log({ action: 'portal.issue_photo', summary: `Menambah foto laporan "${iss.title}"` });
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
  const row = toCamel(await q(sb.from('setup_codes').select('*').eq('email', email).maybeSingle()));
  if (!row || row.expiresAt < new Date().toISOString() || row.codeHash !== (await sha256(code))) {
    writeLog(req, 'admin', email || '(tanpa email)', { action: 'setup.failed', summary: 'Gagal mengatur kata sandi: kode penyiapan salah atau kedaluwarsa', ok: false });
    throw new HttpError(401, 'Kode penyiapan salah atau sudah kedaluwarsa.');
  }
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = list?.users.find((u) => (u.email || '').toLowerCase() === email);
  const res = user
    ? await sb.auth.admin.updateUserById(user.id, { password })
    : await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (res.error) { console.error(res.error); throw bad('Gagal menyimpan kata sandi. Coba kata sandi lain.'); }
  await q(sb.from('setup_codes').delete().eq('email', email));
  log({ action: 'setup', summary: 'Mengatur kata sandi admin dengan kode penyiapan' });
  return { ok: true };
});
function sessionOut(s: Row) { return { accessToken: s.access_token, refreshToken: s.refresh_token, expiresAt: s.expires_at }; }

// ================================================================ ADMIN — ringkasan
on('GET', '/admin/summary', async () => {
  const createdCount = await generateInvoicesThrottled();
  const today = todayStr(); const month = today.slice(0, 7);
  const [props, rooms, tenants, invs, exps, surveys, issues, s] = await Promise.all([
    all('properties'), all('rooms'), all('tenants'), all('invoices'), all('expenses'), all('surveys'), all('issues'), getSettings(),
  ]);
  const occ = new Set(tenants.filter((t) => t.status === 'aktif').map((t) => t.roomId));
  const eff = (r: Row) => (occ.has(r.id) ? 'terisi' : r.status);
  const inv = invs.map((i) => decorate(i, today)); const unpaid = inv.filter((i) => i.status === 'belum');
  return {
    today, month, newInvoices: createdCount, isSample: !!s.isSample,
    perProperty: props.sort(bySort).map((p) => {
      const st = rooms.filter((r) => r.propertyId === p.id).map(eff);
      return { id: p.id, name: p.name, total: st.length, terisi: st.filter((x) => x === 'terisi').length, kosong: st.filter((x) => x === 'kosong').length, dipesan: st.filter((x) => x === 'dipesan').length, perbaikan: st.filter((x) => x === 'perbaikan').length };
    }),
    overdue: unpaid.filter((i) => i.overdue).length, overdueAmount: unpaid.filter((i) => i.overdue).reduce((a, i) => a + i.amount, 0),
    dueSoon: unpaid.filter((i) => !i.overdue).length, dueSoonAmount: unpaid.filter((i) => !i.overdue).reduce((a, i) => a + i.amount, 0),
    incomeThisMonth: inv.filter((i) => i.status === 'lunas' && (i.paidAt || '').startsWith(month)).reduce((a, i) => a + (i.paidAmount ?? i.amount), 0),
    expensesThisMonth: exps.filter((e) => e.date.startsWith(month)).reduce((a, e) => a + e.amount, 0),
    newSurveys: surveys.filter((x) => x.status === 'baru').length,
    proofsPending: inv.filter((i) => i.status === 'belum' && i.proofStatus === 'menunggu').length,
    openIssues: issues.filter((x) => x.status !== 'selesai').length,
    endingSoon: tenants.filter((t) => t.status === 'aktif' && t.endDate && t.endDate <= addMonths(today, 1)).length,
  };
});

// ================================================================ ADMIN — kos & kamar
on('GET', '/admin/properties', async () => (await all('properties')).sort(bySort));
on('PUT', '/admin/properties/:id', async ({ params, body: b }, log) => {
  const patch: Row = pick(b, ['name', 'gender', 'tagline', 'description', 'address', 'mapsQuery']);
  for (const k of Object.keys(patch)) patch[k] = str(patch[k], k === 'description' ? 1500 : 300);
  for (const k of ['facilities', 'rules', 'nearby']) if (b[k] !== undefined) patch[k] = strList(b[k]);
  if (b.photos !== undefined) patch.photos = strList(b.photos, 12).filter(okPhoto);
  const rec = await update('properties', params.id, patch);
  log({ action: 'property.update', summary: `Mengubah info ${rec.name}`, target: rec.name });
  return rec;
});

const STATUS_KAMAR = ['kosong', 'terisi', 'dipesan', 'perbaikan'];
function roomFromBody(b: Row) {
  const r: Row = {};
  for (const [k, m] of [['propertyId', 40], ['code', 20], ['type', 60], ['floor', 20], ['sizeM2', 20], ['note', 300]] as const) if (b[k] !== undefined) r[k] = str(b[k], m);
  for (const k of ['priceMonthly', 'priceYearly']) if (b[k] !== undefined) r[k] = num(b[k]);
  if (b.facilities !== undefined) r.facilities = strList(b.facilities);
  if (b.photos !== undefined) r.photos = strList(b.photos, 12).filter(okPhoto);
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
  log({ action: 'room.create', summary: `Menambah kamar ${rec.code} di ${prop.name}`, target: rec.code });
  return created(rec);
});
on('PUT', '/admin/rooms/:id', async ({ params, body }, log) => {
  const r = roomFromBody(body); delete r.propertyId;
  const rec = await update('rooms', params.id, r);
  const keys = Object.keys(r);
  log(keys.length === 1 && keys[0] === 'status'
    ? { action: 'room.status', summary: `Mengubah status kamar ${rec.code} menjadi ${STATUS_LABEL[rec.status] || rec.status}`, target: rec.code }
    : { action: 'room.update', summary: `Mengubah data kamar ${rec.code}`, target: rec.code });
  return rec;
});
on('DELETE', '/admin/rooms/:id', async ({ params }, log) => {
  const cur = await one('rooms', params.id);
  const out = await remove('rooms', params.id);
  log({ action: 'room.delete', summary: `Menghapus kamar ${cur?.code || ''}`, target: cur?.code });
  return out;
});

// ================================================================ ADMIN — penghuni
function tenantFromBody(b: Row) {
  const t: Row = {};
  for (const k of ['name', 'phone', 'occupation', 'origin', 'emergencyName', 'emergencyPhone', 'emergencyRelation', 'note']) if (b[k] !== undefined) t[k] = str(b[k], k === 'note' ? 600 : 120);
  if (b.roomId !== undefined) t.roomId = str(b.roomId, 40);
  if (b.rentCycle !== undefined) { if (!['bulanan', 'tahunan'].includes(b.rentCycle)) throw bad('Pilih sewa bulanan atau tahunan.'); t.rentCycle = b.rentCycle; }
  if (b.rentAmount !== undefined) t.rentAmount = num(b.rentAmount);
  if (b.deposit !== undefined) t.deposit = num(b.deposit);
  for (const k of ['startDate', 'endDate', 'billFrom']) if (b[k] !== undefined) { if (b[k] && !isDate(b[k])) throw bad('Format tanggal tidak benar.'); t[k] = b[k] || null; }
  return t;
}
const activeInRoom = async (roomId: string) => !!(await q<Row | null>(sb.from('tenants').select('id').eq('room_id', roomId).eq('status', 'aktif').maybeSingle()));

on('GET', '/admin/tenants', async () => {
  const [tenants, rooms, invs] = await Promise.all([all('tenants'), all('rooms'), q<Row[]>(sb.from('invoices').select('tenant_id, amount, due_date, status').eq('status', 'belum'))]);
  const roomMap = new Map(rooms.map((r) => [r.id, r])); const today = todayStr();
  return tenants.map((t) => {
    const mine = (invs || []).filter((i) => i.tenant_id === t.id);
    const r = roomMap.get(t.roomId);
    return {
      ...t, portalTokenHash: undefined, hasPortal: !!t.portalTokenHash,
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
  if (!t.rentAmount) t.rentAmount = t.rentCycle === 'tahunan' ? room.priceYearly : room.priceMonthly;
  const rec = await insert('tenants', { status: 'aktif', ...t });
  await update('rooms', room.id, { status: 'terisi' });
  await generateInvoices(rec.id);
  log({ action: 'tenant.create', summary: `Menambah penghuni ${rec.name} di kamar ${room.code}`, target: room.code });
  return created({ ...rec, portalTokenHash: undefined });
});
on('PUT', '/admin/tenants/:id', async ({ params, body }, log) => {
  const t = tenantFromBody(body); const cur = await one('tenants', params.id);
  if (!cur) throw notFound('Penghuni tidak ditemukan.');
  if (t.roomId && t.roomId !== cur.roomId) {
    if (cur.status === 'aktif' && (await activeInRoom(t.roomId))) throw bad('Kamar tujuan masih ditempati.');
    await update('rooms', cur.roomId, { status: 'kosong' }); await update('rooms', t.roomId, { status: 'terisi' });
  }
  const rec = await update('tenants', params.id, t);
  log({ action: 'tenant.update', summary: `Mengubah data penghuni ${rec.name}` });
  return { ...rec, portalTokenHash: undefined };
});
on('POST', '/admin/tenants/:id/checkout', async ({ params, body }, log) => {
  const cur = await one('tenants', params.id); if (!cur) throw notFound('Penghuni tidak ditemukan.');
  const endDate = isDate(body.endDate) ? body.endDate : todayStr();
  await update('tenants', cur.id, { status: 'keluar', endDate, portalTokenHash: null });
  await update('rooms', cur.roomId, { status: 'kosong' });
  await q(sb.from('invoices').delete().eq('tenant_id', cur.id).eq('status', 'belum').gte('period_start', endDate));
  const room = await one('rooms', cur.roomId);
  log({ action: 'tenant.checkout', summary: `Mencatat ${cur.name} keluar per ${tanggal(endDate)}`, target: room?.code });
  return { ok: true };
});
// Buat link portal baru (link lama otomatis tidak berlaku)
on('POST', '/admin/tenants/:id/portal', async ({ params }, log) => {
  const t = await one('tenants', params.id); if (!t) throw notFound('Penghuni tidak ditemukan.');
  if (t.status !== 'aktif') throw bad('Penghuni ini sudah keluar.');
  const token = randomToken();
  await update('tenants', t.id, { portalTokenHash: await sha256(token), portalCreatedAt: new Date().toISOString() });
  log({ action: 'tenant.portal', summary: `Membuat link portal baru untuk ${t.name} (link lama tidak berlaku)` });
  return { token };
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
  log({ action: 'invoice.create', summary: `Membuat tagihan tambahan untuk ${t.name}: ${rec.periodLabel} (${rupiah(rec.amount)})`, target: room?.code });
  return created(rec);
});
on('POST', '/admin/invoices/:id/pay', async ({ params, body: b }, log) => {
  const inv = await one('invoices', params.id); if (!inv) throw notFound('Tagihan tidak ditemukan.');
  const d = await invoiceDesc(inv.id);
  log({ action: 'invoice.pay', summary: `Menandai lunas tagihan ${d.text}${inv.proofStatus === 'menunggu' ? ' (bukti diterima)' : ''}`, target: d.target });
  return update('invoices', inv.id, {
    status: 'lunas', paidAt: isDate(b.paidAt) ? b.paidAt : todayStr(),
    paidAmount: b.paidAmount !== undefined && b.paidAmount !== '' ? num(b.paidAmount) : inv.amount,
    method: ['tunai', 'transfer', 'qris', 'lainnya'].includes(b.method) ? b.method : 'transfer',
    note: b.note !== undefined ? str(b.note, 300) : inv.note,
    proofStatus: inv.proofPath ? 'diterima' : inv.proofStatus,
  });
});
on('POST', '/admin/invoices/:id/unpay', async ({ params }, log) => {
  const rec = await update('invoices', params.id, { status: 'belum', paidAt: null, paidAmount: null, method: null, proofStatus: null });
  const d = await invoiceDesc(params.id);
  log({ action: 'invoice.unpay', summary: `Membatalkan status lunas tagihan ${d.text}`, target: d.target });
  return rec;
});
on('POST', '/admin/invoices/:id/reject-proof', async ({ params, body }, log) => {
  const note = str(body.note, 300); if (!note) throw bad('Tulis alasan agar penghuni tahu apa yang perlu diperbaiki.');
  const rec = await update('invoices', params.id, { proofStatus: 'ditolak', proofNote: note });
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
  const out = await remove('invoices', params.id);
  log({ action: 'invoice.delete', summary: `Menghapus tagihan ${d.text}`, target: d.target });
  return out;
});
on('GET', '/admin/invoices/:id/reminder', async ({ params, url }, log) => {
  const inv = await one('invoices', params.id); if (!inv) throw notFound('Tagihan tidak ditemukan.');
  const [t, room, s] = await Promise.all([one('tenants', inv.tenantId), one('rooms', inv.roomId), getSettings()]);
  if (!t?.phone) throw bad('Penghuni ini belum punya nomor WhatsApp.');
  const prop = room ? await one('properties', room.propertyId) : null;
  const site = str(url.searchParams.get('site'), 200).replace(/\/$/, '');
  const d = decorate(inv);
  const text = String(s.reminderTemplate || DEFAULT_TEMPLATE)
    .replaceAll('{nama}', t.name || '').replaceAll('{kos}', prop?.name || 'Bonaasina').replaceAll('{kamar}', room?.code || '')
    .replaceAll('{periode}', inv.periodLabel || '').replaceAll('{jumlah}', rupiah(inv.amount)).replaceAll('{jatuh_tempo}', tanggal(inv.dueDate))
    .replaceAll('{keterlambatan}', d.overdue ? ` Saat ini sudah lewat ${d.overdueDays} hari.` : '')
    .replaceAll('{rekening}', s.paymentInfo || '-').replaceAll('{portal}', site ? `${site}/portal/` : '');
  await update('invoices', inv.id, { lastRemindedAt: new Date().toISOString() });
  log({ action: 'invoice.remind', summary: `Membuat pengingat WhatsApp untuk ${t.name}, ${inv.periodLabel}`, target: room?.code });
  return { text, url: waLink(t.phone, text) };
});
// Tautan sementara (5 menit) untuk melihat bukti bayar / foto kerusakan
on('GET', '/admin/file', async ({ url }, log) => {
  const path = str(url.searchParams.get('path'), 300);
  if (!/^(proofs|issues)\/[\w-]+\/[\w.-]+$/.test(path)) throw bad('Alamat file tidak valid.');
  const out = { url: await signedUrl(path) };
  const tenant = await one('tenants', path.split('/')[1]);
  log({ action: 'file.view', summary: `Melihat ${path.startsWith('proofs') ? 'bukti bayar' : 'foto kerusakan'} ${tenant?.name || ''}`.trim() });
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
  if (b.ownerNote !== undefined) patch.ownerNote = str(b.ownerNote, 600);
  const rec = await update('surveys', params.id, patch);
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
  if (b.ownerNote !== undefined) patch.ownerNote = str(b.ownerNote, 600);
  const rec = await update('issues', params.id, patch);
  log({ action: 'issue.update', summary: `Memperbarui laporan "${rec.title}" menjadi ${STATUS_LABEL[rec.status] || rec.status}` });
  return rec;
});

on('GET', '/admin/expenses', async () => (await all('expenses')).sort((a, b) => b.date.localeCompare(a.date)));
on('POST', '/admin/expenses', async ({ body: b }, log) => {
  if (!isDate(b.date)) throw bad('Isi tanggal pengeluaran.'); if (!num(b.amount)) throw bad('Isi jumlah pengeluaran.');
  const propertyId = b.propertyId && (await one('properties', str(b.propertyId, 40))) ? str(b.propertyId, 40) : null;
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
  const csv = '﻿' + [['Tanggal', 'Jenis', 'Kos', 'Kamar', 'Nama/Kategori', 'Keterangan', 'Metode', 'Masuk', 'Keluar'], ...rows].map((x) => x.map(esc).join(',')).join('\r\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="laporan-bonaasina-${year}.csv"` } });
});

// ================================================================ ADMIN — pengaturan, unggah, cadangan
const SETTING_FIELDS = ['siteName', 'tagline', 'ownerName', 'whatsapp', 'paymentInfo', 'paymentMethods', 'depositInfo', 'reminderTemplate', 'invoiceLeadDays', 'surveyHours'];
on('GET', '/admin/settings', async () => ({ ...(await getSettings()), defaultReminderTemplate: DEFAULT_TEMPLATE }));
on('PUT', '/admin/settings', async ({ body: b }, log) => {
  const cur = await getSettings(); const patch: Row = {};
  for (const k of SETTING_FIELDS) if (b[k] !== undefined) patch[k] = k === 'invoiceLeadDays' ? Math.min(num(b[k]), 60) : str(b[k], 2000);
  if (b.heroWords !== undefined) patch.heroWords = strList(b.heroWords, 8);
  if (b.isSample !== undefined) patch.isSample = !!b.isSample;
  if (b.faq !== undefined) {
    if (!Array.isArray(b.faq)) throw bad('Format tanya jawab tidak benar.');
    patch.faq = b.faq.map((f: Row) => ({ q: str(f.q, 200), a: str(f.a, 1200) })).filter((f: Row) => f.q && f.a).slice(0, 20);
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
  const tables = ['settings', 'properties', 'rooms', 'tenants', 'invoices', 'surveys', 'expenses', 'issues'];
  const out: Row = { exportedAt: new Date().toISOString() };
  for (const t of tables) out[t] = (await q<Row[]>(sb.from(t).select('*'))).map((r) => ({ ...r, portal_token_hash: undefined }));
  return out;
});

// ================================================================ ADMIN — log aktivitas
on('GET', '/admin/activity', async ({ url }) => {
  const type = url.searchParams.get('type') || 'semua';
  const term = str(url.searchParams.get('q'), 80).replace(/[%,()]/g, ' ').trim();
  const before = Number(url.searchParams.get('before')) || 0;
  const limit = 100;
  let query = sb.from('activity_log').select('*').order('id', { ascending: false }).limit(limit + 1);
  if (['admin', 'penghuni', 'publik'].includes(type)) query = query.eq('actor_type', type);
  if (type === 'gagal') query = query.eq('ok', false);
  if (before) query = query.lt('id', before);
  if (term) query = query.or(`summary.ilike.%${term}%,actor.ilike.%${term}%,target.ilike.%${term}%,ip.ilike.%${term}%`);
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const count = (f: (x: any) => any) => f(sb.from('activity_log').select('id', { count: 'exact', head: true }).gte('created_at', since)).then((r: any) => r.count ?? 0);
  const [rows, all30, admin, penghuni, publik, gagal] = await Promise.all([
    q<Row[]>(query), count((x) => x), count((x) => x.eq('actor_type', 'admin')), count((x) => x.eq('actor_type', 'penghuni')),
    count((x) => x.eq('actor_type', 'publik')), count((x) => x.eq('ok', false)),
  ]);
  const list = (rows || []).map((r) => toCamel(r)!);
  return { items: list.slice(0, limit), hasMore: list.length > limit, counts: { semua: all30, admin, penghuni, publik, gagal }, keepDays: LOG_KEEP_DAYS };
});

// ---------------------------------------------------------------- server
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-portal-token',
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
async function requireTenant(req: Request) {
  const token = req.headers.get('x-portal-token') || '';
  if (token.length < 20) throw new HttpError(401, 'Link portal tidak berlaku. Minta link baru ke pemilik lewat WhatsApp.');
  const t = toCamel(await q(sb.from('tenants').select('*').eq('portal_token_hash', await sha256(token)).eq('status', 'aktif').maybeSingle()));
  if (!t) {
    writeLog(req, 'publik', 'Pengunjung', { action: 'portal.denied', summary: 'Membuka portal dengan link yang tidak berlaku', ok: false, dedupeMinutes: 10 });
    throw new HttpError(401, 'Link portal tidak berlaku. Minta link baru ke pemilik lewat WhatsApp.');
  }
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
      if (r.area === 'portal') ctx.tenant = await requireTenant(req);
      if (!r.raw && ['POST', 'PUT'].includes(req.method)) {
        const text = await req.text();
        if (text.length > 200_000) throw new HttpError(413, 'Data terlalu besar.');
        try { ctx.body = text ? JSON.parse(text) : {}; } catch { throw bad('Data yang dikirim tidak bisa dibaca.'); }
      }
      const out = await r.fn(ctx, (e) => { ctx.log = e; });
      if (ctx.log) {
        const type: ActorType = path.startsWith('/admin') ? 'admin' : path.startsWith('/portal') ? 'penghuni' : 'publik';
        const actor = ctx.adminEmail || ctx.tenant?.name || str(ctx.body.email, 200).toLowerCase() || str(ctx.body.name, 80) || 'Pengunjung';
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
