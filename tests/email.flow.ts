// Uji notifikasi email (Resend dipalsukan: fetch ke api.resend.com ditangkap, tidak ada email sungguhan).
// cd tests && deno run -A --config deno.json email.flow.ts
import { db } from './fake-supabase.ts';
Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'secret'); Deno.env.set('SUPABASE_ANON_KEY', 'anon');
Deno.env.set('SITE_URL', 'https://bonaasina.my.id');
Deno.env.set('RESEND_API_KEY', 're_test_key');
Deno.env.set('EMAIL_FROM', 'Bonaasina <notifikasi@kabar.bonaasina.my.id>');

type Sent = { to: string[]; subject: string; html: string; text: string; from: string; tags: { name: string; value: string }[]; idem: string | null };
const sent: Sent[] = [];
let failNext = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith('https://api.resend.com/')) return realFetch(input, init);
  const h = new Headers(init?.headers);
  if (h.get('authorization') !== 'Bearer re_test_key') throw new Error('missing auth');
  if (failNext > 0) { failNext--; return new Response(JSON.stringify({ name: 'validation_error', message: 'domain not verified' }), { status: 403 }); }
  sent.push({ ...JSON.parse(String(init?.body)), idem: h.get('idempotency-key') });
  return new Response(JSON.stringify({ id: `em_${sent.length}` }), { status: 200 });
}) as typeof fetch;

let handler: (r: Request) => Promise<Response>;
(Deno as any).serve = (h: any) => { handler = h; return {}; };
await import('../supabase/functions/api/index.ts');

const BASE = 'https://test.supabase.co/functions/v1/api';
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, raw?: Uint8Array) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (raw) { init.body = raw as BodyInit; (init.headers as Record<string, string>)['content-type'] = 'image/jpeg'; }
  else if (body !== undefined) { init.body = JSON.stringify(body); (init.headers as Record<string, string>)['content-type'] = 'application/json'; }
  const res = await handler(new Request(BASE + path, init));
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  return { status: res.status, data: data as any };
}
const ok = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, raw?: Uint8Array) => {
  const r = await call(method, path, body, headers, raw);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
function assert(c: unknown, m: string) { if (!c) throw new Error('ASSERT: ' + m); }
const settle = () => new Promise((r) => setTimeout(r, 60));
const take = async () => { await settle(); const out = sent.splice(0); return out; };
const A = { authorization: 'Bearer admin-token' };
const plus = (n: number) => new Date(Date.now() + 7 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

db.admins = [{ email: 'bonaasinaa@gmail.com' }];
db.settings = [{ id: 1, data: { whatsapp: '081200000000', paymentInfo: 'BRI 123 a.n. Bonaasina' } }];
for (const t of ['properties', 'rooms', 'tenants', 'invoices', 'leads', 'owners', 'messages', 'notifications', 'activity_log', 'owner_sessions', 'lead_sessions', 'tenant_sessions', 'contracts', 'waitlist', 'surveys', 'issues', 'announcements', 'email_log', 'partner_applications']) db[t] = [];

const bona = await ok('POST', '/admin/properties', { name: 'Kos Bona', kind: 'sendiri', gender: 'Putri', periods: ['bulanan'], address: 'Jl. Bona' }, A);
const b01 = await ok('POST', '/admin/rooms', { propertyId: bona.id, code: 'B-01', priceMonthly: 600000 }, A);
await take();

// Email tidak valid ditolak, kosong boleh
assert((await call('POST', '/surveys', { name: 'Rina', phone: '081234567890', email: 'rina@', propertyId: bona.id, date: plus(1) })).status === 400, 'invalid email rejected');
await ok('POST', '/surveys', { name: 'Tanpa Email', phone: '081234567891', propertyId: bona.id, date: plus(1) });
let m = await take();
assert(m.length === 1 && m[0].to[0] === 'bonaasinaa@gmail.com', 'survey without email → only admin');

// Survei: konfirmasi ke pengunjung + admin, lalu status dikonfirmasi
const sv = await ok('POST', '/surveys', { name: 'Rina', phone: '081234567890', email: 'Rina@Example.com', propertyId: bona.id, roomId: b01.id, date: plus(1), time: '10.00' });
m = await take();
assert(m.length === 2, 'survey → 2 emails');
const toRina = m.find((x) => x.to[0] === 'rina@example.com')!;
assert(toRina && /diterima/.test(toRina.subject) && toRina.html.includes('B-01') && toRina.text.includes('Kos Bona'), 'survey visitor email content');
assert(toRina.from === 'Bonaasina <notifikasi@kabar.bonaasina.my.id>' && toRina.idem === `survey.received:${sv.id}` && toRina.tags[0].value === 'survey_received', 'from/idempotency/tag');
await ok('PUT', `/admin/surveys/${sv.id}`, { status: 'dikonfirmasi' }, A);
await ok('PUT', `/admin/surveys/${sv.id}`, { ownerNote: 'sampai jumpa' }, A);
m = await take();
assert(m.length === 1 && /dikonfirmasi/.test(m[0].subject), 'survey confirmed email once');

// HTML aman dari isian pengguna
await ok('POST', '/surveys', { name: '<script>x</script>', phone: '081234567892', email: 'x@example.com', propertyId: bona.id, date: plus(1) });
m = await take();
assert(m.every((x) => !x.html.includes('<script>x')), 'html escaped');

// Penghuni: sambutan, tagihan baru, bukti, lunas, tolak bukti
const tn = await ok('POST', '/admin/tenants', { name: 'Maria', email: 'maria@example.com', roomId: b01.id, startDate: plus(2), rentCycle: 'bulanan', username: 'maria', password: 'rahasia-maria' }, A);
m = await take();
assert(m.some((x) => /Selamat datang/.test(x.subject)) && m.some((x) => /Tagihan sewa/.test(x.subject)), 'welcome + invoice email');
const inv = db.invoices.find((i) => i.tenant_id === tn.id)!;
const T = { 'x-tenant-session': (await ok('POST', '/penghuni/login', { username: 'maria', password: 'rahasia-maria' })).token };
await ok('POST', `/penghuni/invoices/${inv.id}/proof`, undefined, T, JPG);
m = await take();
assert(m.length === 1 && m[0].to[0] === 'bonaasinaa@gmail.com' && /Bukti bayar/.test(m[0].subject), 'proof → admin');
await ok('POST', `/admin/invoices/${inv.id}/reject-proof`, { note: 'Nominal kurang' }, A);
m = await take();
assert(m.length === 1 && m[0].to[0] === 'maria@example.com' && m[0].text.includes('Nominal kurang'), 'proof rejected → tenant');
await ok('POST', `/admin/invoices/${inv.id}/pay`, { method: 'transfer' }, A);
m = await take();
assert(m.length === 1 && /diterima/.test(m[0].subject) && m[0].text.includes('BNS/KW/'), 'paid → tenant with receipt no');
await ok('GET', `/admin/invoices/${inv.id}/reminder`, undefined, A);
await ok('GET', `/admin/invoices/${inv.id}/reminder`, undefined, A);
m = await take();
assert(m.length === 1, 'reminder email deduped per day');

// Kerusakan, kontrak, pengumuman, ganti email
const iss = await ok('POST', '/penghuni/issues', { title: 'Lampu mati', category: 'Listrik' }, T);
await ok('PUT', `/admin/issues/${iss.id}`, { status: 'dikerjakan' }, A);
m = await take();
assert(m.length === 2 && m.some((x) => x.to[0] === 'bonaasinaa@gmail.com') && m.some((x) => x.to[0] === 'maria@example.com' && /Sedang dikerjakan/.test(x.subject)), 'issue emails');
const ctr = await ok('POST', '/admin/contracts', { tenantId: tn.id, startDate: plus(2), endDate: plus(200) }, A);
m = await take();
assert(m.length === 1 && /menunggu persetujuan/.test(m[0].subject), 'contract new → tenant');
await ok('POST', `/penghuni/contracts/${ctr.id}/accept`, { agree: true, name: 'Maria' }, T);
m = await take();
assert(m.length === 2, 'contract accepted → admin + tenant');
await ok('POST', '/admin/announcements', { title: 'Air mati besok', body: 'Pukul 09–12.', priority: 'penting' }, A);
m = await take();
assert(m.length === 1 && m[0].subject === '[Penting] Pengumuman: Air mati besok', 'announcement email');
assert((await call('PUT', '/penghuni/email', { email: 'bukan email' }, T)).status === 400, 'tenant invalid email');
await ok('PUT', '/penghuni/email', { email: 'maria.baru@example.com' }, T);
m = await take();
assert(m.length === 1 && m[0].to[0] === 'maria.baru@example.com', 'email.set confirmation');
assert((await ok('GET', '/penghuni/me', undefined, T)).tenant.email === 'maria.baru@example.com', 'me returns email');

// Reservasi (Kos Sekitar): notifikasi dashboard ikut terkirim ke email
const b02 = await ok('POST', '/admin/rooms', { propertyId: bona.id, code: 'B-02', priceMonthly: 700000 }, A);
await take();
const lead = await ok('POST', '/leads', { propertyId: bona.id, roomId: b02.id, period: 'bulanan', duration: 1, moveDate: plus(3), name: 'Sari', phone: '082111222333', email: 'sari@example.com' });
m = await take();
const toSari = m.filter((x) => x.to[0] === 'sari@example.com');
assert(toSari.length === 1 && /Reservasi terkirim/.test(toSari[0].subject) && toSari[0].html.includes(`/akun/?u=${lead.username}`), 'lead received → customer');
assert(!toSari[0].html.includes(lead.password) && !toSari[0].text.includes(lead.password), 'password never emailed');
assert(m.some((x) => x.to[0] === 'bonaasinaa@gmail.com' && /Reservasi baru/.test(x.subject)), 'lead → admin (kos sendiri)');
const L = db.leads.find((l) => l.username === lead.username)!.id;
await ok('POST', `/admin/leads/${L}/confirm`, { roomId: b02.id, dpAmount: 200000 }, A);
m = await take();
assert(m.some((x) => x.to[0] === 'sari@example.com' && /lanjutkan pembayaran DP/.test(x.subject)), 'confirm → customer');

// Gagal kirim tidak menggagalkan aksi; dicatat di email_log
failNext = 1;
await ok('POST', '/surveys', { name: 'Gagal', phone: '081234567899', email: 'gagal@example.com', propertyId: bona.id, date: plus(1) });
await take();
assert(db.email_log.some((r) => r.status === 'gagal' && r.error.includes('403')), 'failure logged');

// Mitra
await ok('POST', '/mitra/daftar', { name: 'Pak Ucok', phone: '081300001111', email: 'ucok@example.com', kosName: 'Anggrek', city: 'Medan' });
m = await take();
assert(m.some((x) => x.to[0] === 'ucok@example.com') && m.some((x) => x.to[0] === 'bonaasinaa@gmail.com'), 'partner apply → applicant + admin');
const app = db.partner_applications[0];
const appr = await ok('POST', `/admin/applications/${app.id}/approve`, {}, A);
m = await take();
assert(m.length === 1 && m[0].to[0] === 'ucok@example.com' && !m[0].text.includes(appr.password), 'approve email without password');
assert(db.owners.find((o) => o.id === appr.owner.id)?.email === 'ucok@example.com', 'owner email copied');

// Email admin bisa diarahkan ke alamat lain
await ok('PUT', '/admin/settings', { notifyEmail: 'Admin1@example.com, admin2@example.com' }, A);
assert((await call('PUT', '/admin/settings', { notifyEmail: 'bukan' }, A)).status === 400, 'notifyEmail validated');
await ok('POST', '/surveys', { name: 'Rudi', phone: '081234567893', propertyId: bona.id, date: plus(1) });
m = await take();
assert(m.length === 1 && m[0].to.join() === 'admin1@example.com,admin2@example.com', 'notifyEmail recipients');

console.log('email log rows:', db.email_log.length);
console.log('ALL EMAIL TESTS PASSED');
