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


db.admins = [{ email: 'bonaasinaa@gmail.com' }];
db.settings = [{ id: 1, data: { whatsapp: '081200000000', siteName: 'Bonaasina' } }];
for (const t of ['properties', 'rooms', 'tenants', 'invoices', 'leads', 'owners', 'messages', 'notifications', 'activity_log', 'listings', 'places', 'surveys', 'expenses', 'issues', 'contracts', 'waitlist']) db[t] = [];

// ---------- titip jualan
const foto = await ok('POST', '/titip/foto', undefined, {}, JPG);
assert(foto.url.includes('/photos/titip/'), 'foto titip tersimpan di folder titip');
await fail(400, 'POST', '/titip', { sellerName: 'Dina', sellerPhone: '123', title: 'Kue', description: 'Kue kering enak sekali' });
await fail(400, 'POST', '/titip', { sellerName: 'Dina', sellerPhone: '081377778888', title: '', description: 'Kue kering enak sekali' });
const t1 = await ok('POST', '/titip', { kind: 'jual', category: 'Makanan & minuman', sellerName: 'Dina Siahaan', sellerPhone: '081377778888', sellerInfo: 'Mahasiswa IT Del', title: 'Kue kering nastar', description: 'Nastar homemade, toples 500 gr.', price: 65000, priceNote: 'per toples', photos: [foto.url, 'https://evil.example/x.jpg'] });
assert(t1.ok, 'titip terkirim');
assert(db.listings[0].photos.length === 1, 'foto asing dibuang');
let pubT = await ok('GET', '/titip');
assert(pubT.listings.length === 0, 'belum tampil sebelum disetujui');
let sum = await ok('GET', '/admin/summary', undefined, A);
assert(sum.community.listingsNew === 1, 'badge titip baru');
assert(db.notifications.some((n) => n.kind === 'titip'), 'notifikasi admin');
const L = await ok('GET', '/admin/listings', undefined, A);
const id = L.listings[0].id;
const ap = await ok('PUT', `/admin/listings/${id}`, { status: 'aktif' }, A);
assert(ap.expiresOn && ap.wa && ap.wa.includes('wa.me/6281377778888'), 'disetujui + tautan WA penjual');
pubT = await ok('GET', '/titip');
assert(pubT.listings.length === 1 && !('sellerPhone' in pubT.listings[0]) && pubT.listings[0].waUrl.includes('wa.me'), 'tampil tanpa nomor mentah');
await ok('PUT', `/admin/listings/${id}`, { status: 'selesai' }, A);
assert((await ok('GET', '/titip')).listings.length === 0, 'selesai tidak tampil');
await ok('PUT', `/admin/listings/${id}`, { status: 'aktif', expiresOn: '2020-01-01' }, A);
assert((await ok('GET', '/titip')).listings.length === 0, 'kedaluwarsa tidak tampil');
await ok('DELETE', `/admin/listings/${id}`, undefined, A);
assert(db.listings.length === 0, 'dihapus');
await fail(401, 'GET', '/admin/listings');

const adm = await ok('POST', '/admin/listings', { kind: 'jasa', category: 'Les & bimbel', title: 'Les matematika', description: 'Les SMA', sellerName: 'Budi', sellerPhone: '081211113333', price: '' }, A);
assert(adm.status === 'aktif' && adm.price === null && adm.expiresOn, 'admin tambah iklan langsung tampil');
assert((await ok('GET', '/titip')).listings.length === 1, 'iklan admin tampil');
// ---------- tempat sekitar
const pl = await ok('POST', '/admin/places', { name: 'Warung Bu Tiur', category: 'makan', distanceNote: '2 menit dari Kos Asina', whatsapp: '081299990000', openHours: '07.00–21.00' }, A);
assert(pl.status === 'aktif', 'tempat admin langsung aktif');
await ok('POST', '/sekitar/usul', { name: 'Laundry Kilat', category: 'laundry', suggestedBy: 'Rina, 0812' });
let S = await ok('GET', '/sekitar');
assert(S.places.length === 1 && S.places[0].waUrl && !('whatsapp' in S.places[0]) && !('suggestedBy' in S.places[0]), 'publik hanya tempat aktif');
sum = await ok('GET', '/admin/summary', undefined, A);
assert(sum.community.placesSuggested === 1, 'badge usulan');
const AP = await ok('GET', '/admin/places', undefined, A);
const usul = AP.places.find((p: any) => p.status === 'usulan');
await ok('PUT', `/admin/places/${usul.id}`, { status: 'aktif' }, A);
S = await ok('GET', '/sekitar');
assert(S.places.length === 2, 'usulan disetujui tampil');
await ok('PUT', `/admin/places/${pl.id}`, { name: 'Warung Bu Tiur', category: 'makan', priceNote: 'Mulai Rp12.000' }, A);
assert(db.places.find((p) => p.id === pl.id).price_note === 'Mulai Rp12.000', 'ubah tempat');
await ok('DELETE', `/admin/places/${pl.id}`, undefined, A);

// ---------- logo
await ok('PUT', '/admin/settings', { brandLogo: 'https://evil.example/logo.png' }, A);
assert(!(await ok('GET', '/public')).site.brandLogo, 'logo asing ditolak');
await ok('PUT', '/admin/settings', { brandLogo: '/assets/img/logo-bonaasina.webp' }, A);
assert((await ok('GET', '/public')).site.brandLogo === '/assets/img/logo-bonaasina.webp', 'logo merek');
const kos = await ok('POST', '/admin/properties', { name: 'Kos Asina', kind: 'sendiri' }, A);
await ok('PUT', `/admin/properties/${kos.id}`, { logo: foto.url.replace('titip/', '2026/') }, A);
const pub = await ok('GET', '/public');
assert(pub.properties[0].logo.includes('/photos/2026/') && !('rules' in pub.properties[0]), 'logo kos diganti & aturan tidak publik');
console.log('ALL COMMUNITY TESTS PASSED');
