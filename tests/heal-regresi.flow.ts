// Uji regresi temuan Heal: daftar di atas 1000 baris tidak boleh terpotong, dan tagihan yang
// dihapus admin tidak boleh dibuat ulang oleh pembuatan tagihan otomatis.
import { db } from './fake-supabase.ts';
Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'secret'); Deno.env.set('SUPABASE_ANON_KEY', 'anon');
Deno.env.set('SITE_URL', 'http://127.0.0.1:9');
let handler: (r: Request) => Promise<Response>;
(Deno as any).serve = (h: any) => { handler = h; return {}; };
await import('../supabase/functions/api/index.ts');

const BASE = 'https://test.supabase.co/functions/v1/api';
type H = Record<string, string>;
async function call(method: string, path: string, body?: unknown, headers: H = {}) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) { init.body = JSON.stringify(body); (init.headers as H)['content-type'] = 'application/json'; }
  const res = await handler(new Request(BASE + path, init));
  const data = await res.json();
  return { status: res.status, data: data as any };
}
const ok = async (method: string, path: string, body?: unknown, headers: H = {}) => {
  const r = await call(method, path, body, headers);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
function assert(c: unknown, m: string) { if (!c) throw new Error('ASSERT: ' + m); }

const A = { authorization: 'Bearer admin-token' };
db.admins = [{ email: 'bonaasinaa@gmail.com' }];

// --- 1. 1.200 pengeluaran: semua harus terbaca, bukan hanya 1000 pertama -------------------------
const stamp = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 60e3).toISOString();
for (let i = 0; i < 1200; i++) {
  (db.expenses ||= []).push({ id: `exp_${String(i).padStart(4, '0')}`, date: '2026-01-15', amount: 1000 + i, category: 'Uji', property_id: null, note: `baris ${i}`, created_at: stamp(i), updated_at: stamp(i) });
}
const exps = await ok('GET', '/admin/expenses', undefined, A) as any[];
assert(exps.length === 1200, `pengeluaran terbaca ${exps.length}, seharusnya 1200`);
assert(exps.some((e) => e.amount === 1000 + 1199), 'pengeluaran terbaru ada di daftar');
console.log('pengeluaran terbaca:', exps.length);

// --- 2. Penghuni ke-1.100 tetap muncul di daftar Penghuni ---------------------------------------
(db.properties ||= []).push({ id: 'kos_uji', slug: 'uji', name: 'Kos Uji', kind: 'sendiri', status: 'aktif', periods: ['bulanan'], created_at: stamp(0), updated_at: stamp(0) } as any);
(db.rooms ||= []).push({ id: 'rm_uji', property_id: 'kos_uji', code: 'A-1', status: 'kosong', created_at: stamp(0), updated_at: stamp(0) } as any);
for (let i = 0; i < 1100; i++) {
  (db.tenants ||= []).push({
    id: `tn_${String(i).padStart(4, '0')}`, name: `Penghuni ${i}`, room_id: 'rm_uji', status: i === 1099 ? 'aktif' : 'keluar',
    rent_cycle: 'bulanan', rent_amount: 500000, start_date: '2025-01-01', created_at: stamp(i), updated_at: stamp(i),
  } as any);
}
const tenants = await ok('GET', '/admin/tenants', undefined, A) as any[];
assert(tenants.length === 1100, `penghuni terbaca ${tenants.length}, seharusnya 1100`);
assert(tenants.some((t) => t.name === 'Penghuni 1099'), 'penghuni terbaru ikut terbaca');
console.log('penghuni terbaca:', tenants.length);

// --- 3. Tagihan yang dihapus admin tidak muncul lagi saat tagihan otomatis dibuat ----------------
db.tenants = [];
db.invoices = [];
(db.tenants ||= []).push({ id: 'tn_sewa', name: 'Penyewa Uji', room_id: 'rm_uji', status: 'aktif', rent_cycle: 'bulanan', rent_amount: 750000, start_date: '2026-01-01', email: '', created_at: stamp(0), updated_at: stamp(0) } as any);
const first = await ok('GET', '/admin/invoices', undefined, A) as any[];
assert(first.length >= 1, `tagihan awal dibuat ${first.length}, seharusnya minimal 1`);
const target = first.find((i) => i.status === 'belum') || first[0];
await ok('DELETE', `/admin/invoices/${target.id}`, undefined, A);
const afterDelete = await ok('GET', '/admin/invoices', undefined, A) as any[];
assert(!afterDelete.some((i) => i.periodStart === target.periodStart), 'tagihan yang dihapus tidak dibuat ulang');
console.log('tagihan setelah dihapus:', afterDelete.length);

// --- 3b. Ringkasan admin tetap benar setelah query dipersempit -----------------------------------
const summary = await ok('GET', '/admin/summary', undefined, A) as any;
assert(summary.overdue >= 1 && summary.overdueAmount > 0, `ringkasan menghitung tunggakan: ${JSON.stringify({ o: summary.overdue, a: summary.overdueAmount })}`);
assert(Array.isArray(summary.perProperty) && summary.perProperty.length >= 1, 'ringkasan punya perProperty');
assert(typeof summary.openIssues === 'number' && typeof summary.waitlistToNotify === 'number', 'lencana ringkasan berupa angka');
console.log('ringkasan: tunggakan', summary.overdue, 'tagihan / Rp' + summary.overdueAmount);

// --- 4. Batas foto & potongan deposit dilaporkan, bukan dipotong/disimpan diam-diam ----------------
const tooManyPhotos = Array.from({ length: 13 }, (_, i) => `https://test.supabase.co/storage/v1/object/public/photos/uji/${i}.jpg`);
const photoRes = await call('POST', '/admin/rooms', { propertyId: 'kos_uji', code: 'B-1', photos: tooManyPhotos }, A);
assert(photoRes.status === 400 && /Maksimal 12/.test(photoRes.data.error || ''), `foto ke-13 ditolak: ${photoRes.status} ${JSON.stringify(photoRes.data)}`);
console.log('foto kamar ke-13:', photoRes.data.error);

const negInsp = await call('POST', '/admin/inspections', { tenantId: 'tn_sewa', kind: 'keluar', date: '2026-10-01', items: [{ name: 'Kasur', condition: 'baik' }], depositDeduction: -50000 }, A);
assert(negInsp.status === 400 && /negatif/.test(negInsp.data.error || ''), `potongan deposit negatif ditolak: ${negInsp.status} ${JSON.stringify(negInsp.data)}`);
console.log('potongan deposit negatif:', negInsp.data.error);

// --- 5. Tanggal keluar bisa dihapus lagi ---------------------------------------------------------
const cleared = await ok('PUT', '/admin/tenants/tn_sewa', { endDate: null }, A) as any;
assert(cleared.endDate == null, `tanggal keluar terhapus, dapat: ${JSON.stringify(cleared.endDate)}`);
console.log('tanggal keluar setelah dikosongkan:', cleared.endDate);

// --- 6. Username bertanda garis bawah tidak "mencuri" akun lain saat masuk -----------------------
const bcrypt = (await import('npm:bcryptjs@2.4.3')).default;
const hash = await bcrypt.hash('rahasia123', 10);
(db.owners ||= []).push({ id: 'own_kosxu', name: 'Pemilik Lain', username: 'kosxu', password_hash: hash, status: 'aktif', must_change: false, created_at: stamp(0), updated_at: stamp(0) } as any);
(db.tenants ||= []).push({ id: 'tn_us', name: 'Penghuni Garis Bawah', room_id: 'rm_uji', status: 'aktif', username: 'kos_u', password_hash: hash, login_enabled: true, rent_cycle: 'bulanan', rent_amount: 500000, start_date: '2026-01-01', created_at: stamp(0), updated_at: stamp(0) } as any);
const login = await ok('POST', '/masuk', { username: 'kos_u', password: 'rahasia123' }) as any;
assert(login.kind === 'penghuni', `masuk sebagai penghuni, dapat: ${login.kind}`);
console.log('masuk username garis bawah:', login.kind);

// --- 7. Bukti piket: kiriman kedua menambah foto (tidak terpotong di foto ke-8) -------------------
const loginTok = (await ok('POST', '/penghuni/login', { username: 'kos_u', password: 'rahasia123' }) as any).token;
const H1 = { 'x-tenant-session': loginTok };
const task = await ok('POST', '/admin/chores', { propertyId: 'kos_uji', name: 'Sapu lorong', frequency: 'harian', mode: 'bersama', startDate: '2026-10-01' }, A) as any;
const shots = (tag: string) => Array.from({ length: 5 }, (_, i) => `chores/tn_us/${tag}-${i}.jpg`);
await ok('POST', '/penghuni/chores/report', { taskId: task.id, date: '2026-10-20', photos: shots('a'), note: 'bagian depan' }, H1);
await ok('POST', '/penghuni/chores/report', { taskId: task.id, date: '2026-10-20', photos: shots('b'), note: 'bagian belakang' }, H1);
const chores = await ok('GET', '/admin/chores', undefined, A) as any;
const turn = chores.items.find((i: any) => i.taskId === task.id && i.date === '2026-10-20');
assert(turn?.report?.photos?.length === 10, `foto piket tergabung: ${turn?.report?.photos?.length}`);
console.log('foto piket setelah dua kiriman:', turn.report.photos.length);

// --- 8. Penghuni yang ditolak tidak meninggalkan sisa, dan penghuni keluar tidak menempati kamar --
const tenBefore = (db.tenants || []).length;
const rejectedAdd = await call('POST', '/admin/tenants', { name: 'Tidak Jadi', roomId: 'rm_uji', startDate: '2026-10-01', username: 'kosxu', password: 'rahasia123' }, A);
assert(rejectedAdd.status === 400, `username milik akun lain ditolak: ${rejectedAdd.status} ${JSON.stringify(rejectedAdd.data)}`);
assert((db.tenants || []).length === tenBefore, `tidak ada penghuni tersisa setelah ditolak (${(db.tenants || []).length} vs ${tenBefore})`);
console.log('penambahan ditolak, penghuni tersisa tetap:', (db.tenants || []).length);

(db.rooms ||= []).push({ id: 'rm_b', property_id: 'kos_uji', code: 'B-2', status: 'kosong', hidden: false, created_at: stamp(0), updated_at: stamp(0) } as any);
(db.tenants ||= []).push({ id: 'tn_keluar', name: 'Sudah Keluar', room_id: 'rm_uji', status: 'keluar', rent_cycle: 'bulanan', rent_amount: 500000, start_date: '2025-01-01', end_date: '2025-12-31', created_at: stamp(0), updated_at: stamp(0) } as any);
await ok('PUT', '/admin/tenants/tn_keluar', { roomId: 'rm_b' }, A);
const rmB = (db.rooms || []).find((r: any) => r.id === 'rm_b');
assert(rmB.status === 'kosong', `kamar tujuan tetap kosong untuk penghuni keluar, dapat: ${rmB.status}`);
console.log('kamar tujuan setelah pindah penghuni keluar:', rmB.status);

// --- 9. Nomor WhatsApp dengan format berbeda tidak membuat reservasi kedua ------------------------
(db.properties ||= []).push({ id: 'kos_lead', slug: 'lead', name: 'Kos Lead', kind: 'mitra', status: 'aktif', periods: ['bulanan'], min_booking: 0, city: '', whatsapp: '', chat_enabled: true, wa_enabled: true, note: '', created_at: stamp(0), updated_at: stamp(0) } as any);
const lead1 = await call('POST', '/leads', { name: 'Uji Satu', phone: '0812-3456-7890', propertyId: 'kos_lead', period: 'bulanan', duration: 1, moveDate: '2026-11-01' });
assert(lead1.status === 201, `reservasi pertama dibuat: ${lead1.status} ${JSON.stringify(lead1.data)}`);
const lead2 = await call('POST', '/leads', { name: 'Uji Dua', phone: '+62 812 3456 7890', propertyId: 'kos_lead', period: 'bulanan', duration: 1, moveDate: '2026-11-01' });
assert(lead2.status === 400 && /reservasi aktif/.test(lead2.data.error || ''), `nomor sama (format lain) ditolak: ${lead2.status} ${JSON.stringify(lead2.data)}`);
console.log('nomor format lain ditolak:', lead2.status);

// --- 10. Survei admin: satu halaman + hasMore (bukan seluruh riwayat) ---------------------------
for (let i = 0; i < 60; i++) (db.surveys ||= []).push({ id: `sv_${String(i).padStart(2, '0')}`, name: `Calon ${i}`, phone: '081200000000', property_id: 'kos_lead', room_id: null, date: '2026-11-02', time: '10:00', note: '', status: 'baru', occupation: null, created_at: stamp(i), updated_at: stamp(i) } as any);
const sv = await ok('GET', '/admin/surveys', undefined, A) as any;
assert(Array.isArray(sv.items) && sv.items.length === 50 && sv.hasMore === true, `survei 50 baris + hasMore, dapat: ${sv.items?.length}/${sv.hasMore}`);
const sv2 = await ok('GET', '/admin/surveys?limit=500', undefined, A) as any;
assert(sv2.items.length === 60 && sv2.hasMore === false, `survei batas besar memuat semua: ${sv2.items?.length}/${sv2.hasMore}`);
console.log('survei berhalaman:', sv.items.length, 'hasMore', sv.hasMore);

// --- 11. Daftar tunggu: status difilter & dihitung di server ------------------------------------
(db.waitlist ||= []).push(
  { id: 'wl_a', name: 'Tunggu A', phone: '081211111111', property_id: 'kos_lead', room_pref: '', budget: null, move_date: null, note: '', status: 'perlu_dikabari', matched_room_id: null, matched_at: null, created_at: stamp(1), updated_at: stamp(1) } as any,
  { id: 'wl_b', name: 'Tunggu B', phone: '081222222222', property_id: 'kos_lead', room_pref: '', budget: null, move_date: null, note: '', status: 'menunggu', matched_room_id: null, matched_at: null, created_at: stamp(2), updated_at: stamp(2) } as any,
);
const wl = await ok('GET', '/admin/waitlist?status=perlu_dikabari', undefined, A) as any;
assert(wl.items.length === 1 && wl.items[0].id === 'wl_a', `hanya status perlu_dikabari yang dikirim: ${JSON.stringify(wl.items.map((x: any) => x.id))}`);
assert(wl.counts.perlu_dikabari === 1 && wl.counts.menunggu === 1 && wl.counts.semua === 2, `hitungan segmen dari server: ${JSON.stringify(wl.counts)}`);
console.log('daftar tunggu per status:', wl.items.length, 'counts', JSON.stringify(wl.counts));

// --- 12. Kontrak: segmen dihitung server, yang dibatalkan tidak ikut -----------------------------
(db.contracts ||= []).push(
  { id: 'ct_aktif', number: 'K-1', tenant_id: 't_x', room_id: 'rm_x', property_id: 'kos_lead', start_date: '2026-01-01', end_date: '2026-12-31', monthly_rent: 1000000, deposit: 0, status: 'disetujui', body: '', created_at: stamp(3), updated_at: stamp(3) } as any,
  { id: 'ct_batal', number: 'K-2', tenant_id: 't_x', room_id: 'rm_x', property_id: 'kos_lead', start_date: '2026-01-01', end_date: '2026-12-31', monthly_rent: 1000000, deposit: 0, status: 'dibatalkan', body: '', created_at: stamp(4), updated_at: stamp(4) } as any,
  { id: 'ct_baru', number: 'K-3', tenant_id: 't_x', room_id: 'rm_x', property_id: 'kos_lead', start_date: '2026-11-01', end_date: '2027-11-01', monthly_rent: 1000000, deposit: 0, status: 'menunggu', body: '', created_at: stamp(5), updated_at: stamp(5) } as any,
);
const ct = await ok('GET', '/admin/contracts?status=semua', undefined, A) as any;
assert(ct.items.length === 3 && ct.counts.semua === 3, `semua kontrak terbaca: ${ct.items.length}`);
assert(ct.counts.tindakan === 1, `satu kontrak perlu tindakan, dapat: ${ct.counts.tindakan}`);
const ctA = await ok('GET', '/admin/contracts?status=aktif', undefined, A) as any;
assert(ctA.items.every((c: any) => c.status !== 'dibatalkan'), 'kontrak dibatalkan tidak ikut segmen berjalan');
assert(ctA.counts.aktif === 1 && ctA.items.length === 1 && ctA.items[0].id === 'ct_aktif', `segmen berjalan hanya kontrak berjalan: ${ctA.items.length} / ${ctA.counts.aktif}`);
console.log('kontrak per segmen:', ctA.items.length, 'counts', JSON.stringify(ctA.counts));

// --- 13. Pengumuman admin: satu halaman, bukan seluruh riwayat -----------------------------------
for (let i = 0; i < 25; i++) (db.announcements ||= []).push({ id: `an_${String(i).padStart(2, '0')}`, title: `Pengumuman ${i}`, body: 'isi', property_id: null, expires_on: null, pinned: false, created_at: stamp(i), updated_at: stamp(i) } as any);
const an = await ok('GET', '/admin/announcements', undefined, A) as any;
assert(Array.isArray(an.items) && an.items.length === 20 && an.hasMore === true, `pengumuman 20 baris + hasMore, dapat: ${an.items?.length}/${an.hasMore}`);
const an2 = await ok('GET', '/admin/announcements?before=' + encodeURIComponent(stamp(10)), undefined, A) as any;
assert(an2.items.length === 10 && an2.hasMore === false, `halaman berikutnya 10 baris tanpa sisa: ${an2.items?.length}/${an2.hasMore}`);
console.log('pengumuman berhalaman:', an.items.length, 'halaman kedua', an2.items.length);

console.log('ALL HEAL REGRESSION TESTS PASSED');
