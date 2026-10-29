import { db, files } from './fake-supabase.ts';
Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'secret'); Deno.env.set('SUPABASE_ANON_KEY', 'anon');
Deno.env.set('SITE_URL', 'http://127.0.0.1:9');
let handler: (r: Request) => Promise<Response>;
(Deno as any).serve = (h: any) => { handler = h; return {}; };
await import('../supabase/functions/api/index.ts');

const BASE = 'https://test.supabase.co/functions/v1/api';
type H = Record<string, string>;
async function call(method: string, path: string, body?: unknown, headers: H = {}, raw?: Uint8Array, rawType = 'image/jpeg') {
  const init: RequestInit = { method, headers: { ...headers } };
  if (raw) { init.body = raw; (init.headers as H)['content-type'] = rawType; }
  else if (body !== undefined) { init.body = JSON.stringify(body); (init.headers as H)['content-type'] = 'application/json'; }
  const res = await handler(new Request(BASE + path, init));
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer());
  return { status: res.status, data: data as any };
}
const ok = async (method: string, path: string, body?: unknown, headers: H = {}, raw?: Uint8Array) => {
  const r = await call(method, path, body, headers, raw);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
const fail = async (expect: number, method: string, path: string, body?: unknown, headers: H = {}, raw?: Uint8Array) => {
  const r = await call(method, path, body, headers, raw);
  if (r.status !== expect) throw new Error(`expected ${expect} for ${method} ${path}, got ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
function assert(c: unknown, m: string) { if (!c) throw new Error('ASSERT: ' + m); }
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
const A = { authorization: 'Bearer admin-token' };
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const plus = (n: number) => new Date(Date.now() + 7 * 3600e3 + n * 864e5).toISOString().slice(0, 10);

function seed() {
  db.admins = [{ email: 'bonaasinaa@gmail.com' }];
  db.settings = [{ id: 1, data: { whatsapp: '081200000000', paymentInfo: 'BRI 123 a.n. Bonaasina', siteName: 'Bonaasina', feeDefaultType: 'persen', feeDefaultValue: 10, bonaBankInfo: 'BCA 999 a.n. Bonaasina' } }];
  db.properties = [];
  db.rooms = [];
  db.tenants = []; db.invoices = []; db.leads = []; db.owners = []; db.messages = []; db.notifications = []; db.activity_log = [];
  db.owner_sessions = []; db.lead_sessions = []; db.tenant_sessions = []; db.contracts = []; db.waitlist = []; db.surveys = []; db.expenses = []; db.issues = [];
}
seed();
// Kos Bona milik sendiri lewat API admin (seperti seed)
const bona = await ok('POST', '/admin/properties', { name: 'Kos Bona', kind: 'sendiri', gender: 'Putra', periods: ['harian', 'bulanan', 'tahunan'], address: 'Jl. Bona' }, A);
assert(bona.kind === 'sendiri' && bona.status === 'aktif', 'kos sendiri aktif');
await ok('PUT', `/admin/properties/${bona.id}`, { shortName: 'Bona' }, A); // diabaikan (tidak ada di patch), prefix dari slug
const b01 = await ok('POST', '/admin/rooms', { propertyId: bona.id, code: 'B-01', priceMonthly: 600000, priceYearly: 6600000, priceDaily: 80000, capacity: 2, extraPersonFee: 100000 }, A);
assert(b01.capacity === 2 && b01.priceDaily === 80000, 'room new fields');

// Public main page
const pub = await ok('GET', '/public');
assert(pub.properties.length === 1 && pub.properties[0].periods.includes('harian'), 'public periods');
assert(pub.rooms[0].capacity === 2 && pub.partnersCount === 0, 'public rooms capacity');

// Admin membuat pemilik + kos mitra
const owner = await ok('POST', '/admin/owners', { name: 'Pak Sitorus', phone: '081311112222', username: 'sitorus' }, A);
assert(owner.password && owner.mustChange, 'owner default password');
await fail(400, 'POST', '/admin/owners', { name: 'X', username: 'sitorus' }, A);
const mitra = await ok('POST', '/admin/properties', { name: 'Kos Melati', ownerId: owner.id, periods: ['bulanan', 'semesteran'], city: 'Balige' }, A);
assert(mitra.kind === 'mitra' && mitra.status === 'draf', 'mitra draf');

// pemilik masuk → wajib ganti sandi
let s = await ok('POST', '/masuk', { username: 'Sitorus', password: owner.password });
assert(s.kind === 'pemilik' && s.mustChange, 'owner login mustChange');
let O = { 'x-owner-session': s.token };
const me0 = await ok('GET', '/pemilik/me', undefined, O);
assert(me0.properties.length === 0, 'hidden before change');
await fail(403, 'PUT', `/pemilik/properties/${mitra.id}`, { name: 'x' }, O);
await fail(400, 'POST', '/pemilik/password', { newPassword: 'pendek' }, O);
await ok('POST', '/pemilik/password', { newPassword: 'rahasia-pemilik-1' }, O);
await fail(401, 'POST', '/masuk', { username: 'sitorus', password: owner.password });
s = await ok('POST', '/masuk', { username: 'sitorus', password: 'rahasia-pemilik-1' }); O = { 'x-owner-session': s.token };
assert(!s.mustChange, 'changed');

// pemilik melengkapi kos & kamar
await fail(400, 'POST', `/pemilik/properties/${mitra.id}/submit`, {}, O);
const photo = await ok('POST', '/pemilik/upload', undefined, O, JPG);
await ok('PUT', `/pemilik/properties/${mitra.id}`, { address: 'Jl. Melati 3', photos: [photo.url], bankInfo: 'BNI 555 a.n. Sitorus', whatsapp: '081311112222', minBooking: 200000, periods: ['bulanan', 'semesteran', 'tahunan'], status: 'aktif', feeType: 'nominal', feeValue: 0 }, O);
let me = await ok('GET', '/pemilik/me', undefined, O);
assert(me.properties[0].status === 'draf' && me.properties[0].feeType === null, 'owner cannot self-activate or set fee');
const m1 = await ok('POST', '/pemilik/rooms', { propertyId: mitra.id, code: 'M-1', type: 'KM dalam', priceMonthly: 700000, priceSemester: 4000000, priceYearly: 7500000, capacity: 1 }, O);
await fail(404, 'POST', '/pemilik/rooms', { propertyId: bona.id, code: 'hack' }, O);
await ok('POST', `/pemilik/properties/${mitra.id}/submit`, {}, O);
let kc = await ok('GET', '/kos-sekitar');
assert(kc.properties.length === 0, 'not listed before approval');
let sum = await ok('GET', '/admin/summary', undefined, A);
assert(sum.market.partnersPending === 1, 'pending partner count');
await ok('PUT', `/admin/properties/${mitra.id}`, { status: 'aktif', feeType: 'persen', feeValue: 15 }, A);
kc = await ok('GET', '/kos-sekitar');
assert(kc.properties.length === 1 && kc.properties[0].priceFrom.bulanan === 700000 && kc.properties[0].freeRooms === 1, 'listed');
const det = await ok('GET', `/kos/${mitra.slug}`);
assert(det.property.whatsapp === '6281311112222' && det.rooms.length === 1 && !('bankInfo' in det.property), 'detail without bank');
assert((await ok('GET', '/public')).properties.length === 1, 'main page only own kos');

// Customer reservasi
await fail(400, 'POST', '/leads', { propertyId: mitra.id, period: 'harian', duration: 1, moveDate: plus(3), name: 'Rina', phone: '081234567890' });
await fail(400, 'POST', '/leads', { propertyId: mitra.id, roomId: m1.id, people: 2, period: 'bulanan', duration: 1, moveDate: plus(3), name: 'Rina', phone: '081234567890' });
const lead = await ok('POST', '/leads', { propertyId: mitra.id, roomId: m1.id, period: 'bulanan', duration: 3, moveDate: plus(5), name: 'Rina', phone: '081234567890', visit: true, visitDate: plus(1), visitTime: '10.00' });
assert(/^melati\d{5}$/.test(lead.username) && /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(lead.password), 'username/random password format ' + lead.username + ' ' + lead.password);
await fail(400, 'POST', '/leads', { propertyId: mitra.id, period: 'bulanan', duration: 1, moveDate: plus(5), name: 'Rina', phone: '081234567890' });
let cs = await ok('POST', '/masuk', { username: lead.username, password: lead.password });
assert(cs.kind === 'customer' && cs.mustChange, 'customer must change');
let C = { 'x-lead-session': cs.token };
await fail(403, 'GET', '/akun/messages', undefined, C);
await fail(400, 'POST', '/akun/password', { newPassword: 'melati12345' }, C);
await ok('POST', '/akun/password', { newPassword: 'sandi-rina-baru' }, C);
let am = await ok('GET', '/akun/me', undefined, C);
assert(am.lead.status === 'baru' && am.lead.payTo === '' && am.lead.visitStatus === 'diminta', 'customer sees baru, no bank yet');
await fail(400, 'POST', '/akun/dp-proof', undefined, C, JPG);

// pemilik melihat & konfirmasi
me = await ok('GET', '/pemilik/me', undefined, O);
assert(me.leads.length === 1 && me.notifications.unread >= 1, 'owner sees lead + notif');
const L = me.leads[0].id;
await ok('POST', `/pemilik/leads/${L}/visit`, { visitStatus: 'dijadwalkan', visitDate: plus(1), visitTime: '10.00' }, O);
await fail(400, 'POST', `/pemilik/leads/${L}/confirm`, { roomId: m1.id, priceTotal: 2100000, dpAmount: 100000 }, O); // di bawah minimum
await fail(404, 'POST', `/pemilik/leads/${L}/approve`, {}, O);
let full = await ok('POST', `/pemilik/leads/${L}/confirm`, { roomId: m1.id, dpAmount: 300000, dpHours: 24, message: 'Bawa KTP saat datang' }, O);
assert(full.status === 'menunggu_dp' && full.priceTotal === 2100000 && full.payTo.includes('BNI'), 'confirm quote=3x700k');
const wa = await ok('GET', `/pemilik/leads/${L}/wa?kind=konfirmasi`, undefined, O);
assert(wa.url.startsWith('https://wa.me/6281234567890') && wa.text.includes(lead.username) && wa.text.includes('kata sandi yang sudah Anda buat') && wa.text.includes('/akun/?u='), 'wa text');

// chat dua arah
await ok('POST', '/akun/messages', { body: 'Halo pak, boleh bawa motor?' }, C);
let msgs = await ok('GET', `/pemilik/leads/${L}/messages`, undefined, O);
assert(msgs.messages.some((m: any) => m.sender === 'customer'), 'owner gets message');
await ok('POST', `/pemilik/leads/${L}/messages`, { body: 'Boleh.' }, O);
const after = msgs.messages.at(-1).id;
msgs = await ok('GET', `/akun/messages?after=${after}`, undefined, C);
assert(msgs.messages.length === 1 && msgs.messages[0].body === 'Boleh.', 'customer polls new');

// DP
await ok('POST', '/akun/dp-proof', undefined, C, JPG);
am = await ok('GET', '/akun/me', undefined, C);
assert(am.lead.status === 'dp_dikirim' && am.lead.dpProofUrl, 'dp sent');
full = await ok('POST', `/pemilik/leads/${L}/dp`, { accept: false, note: 'Belum masuk' }, O);
assert(full.status === 'menunggu_dp' && full.dpRejectNote === 'Belum masuk', 'dp rejected back');
await ok('POST', '/akun/dp-proof', undefined, C, JPG);
full = await ok('POST', `/pemilik/leads/${L}/dp`, { accept: true }, O);
assert(full.status === 'dp_diterima' && full.feeAmount === 45000 && full.feeStatus === 'belum', 'fee 15% of 300k = ' + full.feeAmount);
assert(db.rooms.find((r) => r.id === m1.id).status === 'dipesan', 'room held');
await fail(400, 'POST', `/admin/leads/${L}/approve`, {}, A);
await ok('POST', `/pemilik/leads/${L}/fee-proof`, undefined, O, JPG);
sum = await ok('GET', '/admin/summary', undefined, A);
assert(sum.market.approvals === 1, 'approval count');
full = await ok('POST', `/admin/leads/${L}/approve`, {}, A);
assert(full.status === 'berhasil' && full.invoiceNo === 'BNS/BK/2026/0001' && full.feeInvoiceNo === 'BNS/FEE/2026/0001' && full.feeStatus === 'diterima', 'approved');
const pdf = await call('GET', '/akun/booking.pdf', undefined, C);
assert(pdf.status === 200 && new TextDecoder().decode(pdf.data.slice(0, 5)) === '%PDF-', 'booking pdf');
const fpdf = await call('GET', `/pemilik/leads/${L}/fee.pdf`, undefined, O);
assert(fpdf.status === 200, 'fee pdf');
const code = db.leads.find((l) => l.id === L).invoice_code;
const ver = await ok('GET', `/public/verify/${code}`);
assert(ver.type === 'booking' && ver.valid, 'verify booking');

// refund setelah berhasil
await fail(400, 'POST', '/akun/refund', { reason: 'Batal kuliah' }, C);
await ok('POST', '/akun/refund', { reason: 'Batal kuliah', account: 'BRI 777 a.n. Rina' }, C);
full = await ok('POST', `/pemilik/leads/${L}/refund-reject`, { reason: 'DP tidak dikembalikan sesuai aturan' }, O);
assert(full.refundStatus === 'ditolak', 'refund rejected');
await ok('POST', '/akun/refund/confirm', { received: false, note: 'Saya batal 3 minggu sebelumnya' }, C);
sum = await ok('GET', '/admin/summary', undefined, A);
assert(sum.market.refunds === 1, 'refund to mediate');
await ok('POST', `/admin/leads/${L}/refund-reopen`, { note: 'Kembalikan 50%' }, A);
const rp = await call('POST', `/pemilik/leads/${L}/refund-proof?amount=150000`, undefined, O, JPG);
assert(rp.status === 200, 'refund proof ' + JSON.stringify(rp.data));
await ok('POST', '/akun/refund/confirm', { received: true }, C);
const done = db.leads.find((l) => l.id === L);
assert(done.status === 'batal' && done.refund_status === 'selesai' && done.fee_status === 'diterima', 'refund done, fee to return');
assert(db.rooms.find((r) => r.id === m1.id).status === 'kosong', 'room released');
assert((await ok('GET', `/public/verify/${code}`)).valid === false, 'verify invalid after refund');
sum = await ok('GET', '/admin/summary', undefined, A);
assert(sum.market.feeToReturn === 1, 'fee to return');
await ok('POST', `/admin/leads/${L}/fee-returned`, {}, A);

// Kos sendiri: admin = pemilik, tanpa fee, langsung berhasil
const own = await ok('POST', '/leads', { propertyId: bona.id, roomId: b01.id, people: 2, period: 'harian', duration: 3, moveDate: plus(2), name: 'Tono', phone: '081999888777' });
assert(/^bona\d{5}$/.test(own.username), 'bona prefix ' + own.username);
const OL = db.leads.find((l) => l.username === own.username).id;
let afull = await ok('POST', `/admin/leads/${OL}/confirm`, { roomId: b01.id, dpAmount: 80000 }, A);
assert(afull.priceTotal === 240000, 'harian quote 3x80k (no extra for harian) = ' + afull.priceTotal);
const wa2 = await ok('GET', `/admin/leads/${OL}/wa?kind=konfirmasi`, undefined, A);
assert(wa2.text.includes(own.password), 'wa includes default password while unchanged');
const C2 = { 'x-lead-session': (await ok('POST', '/masuk', { username: own.username, password: own.password })).token };
await fail(403, 'POST', '/akun/dp-proof', undefined, C2, JPG); // wajib ganti dulu
await ok('POST', '/akun/password', { newPassword: 'tono-sandi-baru' }, C2);
await ok('POST', '/akun/dp-proof', undefined, C2, JPG);
afull = await ok('POST', `/admin/leads/${OL}/dp`, { accept: true }, A);
assert(afull.status === 'berhasil' && afull.feeStatus === 'bebas' && afull.feeAmount === 0 && !afull.feeInvoiceNo, 'own kos auto approved no fee');
// jadikan penghuni (sewa harian, berdua)
const tn = await ok('POST', '/admin/tenants', { name: 'Tono', roomId: b01.id, rentCycle: 'harian', rentAmount: 80000, startDate: plus(2), endDate: plus(5), coName: 'Budi', leadId: OL }, A);
assert(db.leads.find((l) => l.id === OL).tenant_id === tn.id, 'lead linked to tenant');
const inv = db.invoices.find((i) => i.tenant_id === tn.id);
assert(inv && inv.amount === 240000 && inv.cycle === 'harian', 'harian invoice 3 nights ' + JSON.stringify(inv));

// Kedaluwarsa
const l3 = await ok('POST', '/leads', { propertyId: mitra.id, period: 'semesteran', duration: 1, moveDate: plus(10), name: 'Sari', phone: '082111222333' });
const L3 = db.leads.find((l) => l.username === l3.username).id;
await ok('POST', `/pemilik/leads/${L3}/confirm`, { roomId: m1.id, dpAmount: 250000 }, O);
db.leads.find((l) => l.id === L3).dp_deadline = new Date(Date.now() - 1000).toISOString();
await new Promise((r) => setTimeout(r, 10));
// paksa pemeriksaan kedaluwarsa (throttle 60 dtk) dengan memundurkan jam? cukup cek lewat instance baru tidak mungkin; panggil langsung list
const ownerLeads = await ok('GET', '/pemilik/me', undefined, O);
const st = ownerLeads.leads.find((l: any) => l.id === L3).status;
console.log('status L3 setelah lewat batas (throttle bisa menunda):', st);
// pembatalan oleh customer sebelum DP
const C3 = { 'x-lead-session': (await ok('POST', '/masuk', { username: l3.username, password: l3.password })).token };
await ok('POST', '/akun/password', { newPassword: 'sari-sandi-baru' }, C3);
await ok('POST', '/akun/cancel', { reason: 'Dapat kos lain' }, C3);
assert(db.leads.find((l) => l.id === L3).status === 'batal', 'cancelled');

// Akses silang ditolak
await fail(404, 'GET', `/pemilik/leads/${OL}`, undefined, O);
await fail(401, 'GET', '/akun/me', undefined, { 'x-lead-session': 'x'.repeat(40) });
// login penghuni lewat /masuk tetap jalan (username tidak dikenal → 401 penghuni)
await fail(401, 'POST', '/masuk', { username: 'tidakada', password: 'x' });
// notifikasi admin
const an = await ok('GET', '/admin/notifications', undefined, A);
assert(an.items.length > 3, 'admin notifs');
const al = await ok('GET', '/admin/leads', undefined, A);
assert(al.length === 3 && al.some((l: any) => l.ownerName === 'Pak Sitorus'), 'admin leads list');
const parts = await ok('GET', '/admin/partners', undefined, A);
assert(parts[0].feeRule.startsWith('15%') && parts[0].feeReceived === 0, 'partners stats');
const logTypes = new Set(db.activity_log.map((x) => x.actor_type));
await new Promise((r) => setTimeout(r, 200));
console.log('log actor types:', [...new Set(db.activity_log.map((x) => x.actor_type))].join(','), 'files:', files.size);
// Pendaftaran mitra
db.partner_applications = [];
await fail(400, 'POST', '/mitra/daftar', { name: 'Bu Rina', phone: '0812', kosName: 'Anggrek', city: 'Balige' });
await ok('POST', '/mitra/daftar', { name: 'Bu Rina', phone: '081377778888', kosName: 'Kos Anggrek', city: 'Balige', roomCount: 10, periods: ['bulanan', 'tahunan'], gender: 'Putri' });
assert((await ok('GET', '/admin/summary', undefined, A)).market.applications === 1, 'application count');
const apps = await ok('GET', '/admin/applications', undefined, A);
assert(apps[0].kosName === 'Kos Anggrek' && apps[0].status === 'baru', 'app listed');
const appr = await ok('POST', `/admin/applications/${apps[0].id}/approve`, { feeType: 'persen', feeValue: 12 }, A);
assert(appr.owner.username === 'anggrek' && appr.password && appr.url.startsWith('https://wa.me/6281377778888') && appr.text.includes('anggrek'), 'approved ' + appr.owner.username);
const np = db.properties.find((p) => p.id === appr.property.id);
assert(np.kind === 'mitra' && np.status === 'draf' && np.owner_id === appr.owner.id && np.fee_value === 12, 'property draft');
await fail(400, 'POST', `/admin/applications/${apps[0].id}/approve`, {}, A);
const s2 = await ok('POST', '/masuk', { username: 'anggrek', password: appr.password });
assert(s2.kind === 'pemilik' && s2.mustChange, 'new owner login');
// Tambahan berdua per tahun (Kos Bona: Rp3.500.000/tahun)
const b09 = await ok('POST', '/admin/rooms', { propertyId: bona.id, code: 'B-09', priceMonthly: 300000, priceYearly: 3000000, capacity: 2, extraPersonFee: 3500000, extraPersonPeriod: 'tahunan' }, A);
assert(b09.extraPersonPeriod === 'tahunan', 'extra period saved');
const yl = await ok('POST', '/leads', { propertyId: bona.id, roomId: b09.id, people: 2, period: 'tahunan', duration: 1, moveDate: plus(4), name: 'Sari', phone: '081277766655' });
const YL = db.leads.find((l) => l.username === yl.username).id;
const yq = await ok('POST', `/admin/leads/${YL}/confirm`, { roomId: b09.id, dpAmount: 500000 }, A);
assert(yq.priceTotal === 6500000, 'yearly quote 3jt + 3,5jt extra = ' + yq.priceTotal);
const ml = await ok('POST', '/leads', { propertyId: bona.id, roomId: b09.id, people: 2, period: 'bulanan', duration: 3, moveDate: plus(4), name: 'Lina', phone: '081277766600' });
const MLID = db.leads.find((l) => l.username === ml.username).id;
const mq = await ok('POST', `/admin/leads/${MLID}/confirm`, { roomId: b09.id, dpAmount: 500000 }, A);
assert(mq.priceTotal === 1775000, '3 months: 900k + 3/12 of 3,5jt = ' + mq.priceTotal);
const pubB09 = (await ok('GET', '/public')).rooms.find((r) => r.id === b09.id);
assert(pubB09 && pubB09.extraPersonPeriod === 'tahunan', 'public room exposes extra period');

console.log('ALL FLOW TESTS PASSED');
