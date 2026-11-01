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
  return { status: res.status, data: await res.json() as any };
}
const ok = async (method: string, path: string, body?: unknown, headers: H = {}) => {
  const r = await call(method, path, body, headers);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
const fail = async (expect: number, method: string, path: string, body?: unknown, headers: H = {}) => {
  const r = await call(method, path, body, headers);
  if (r.status !== expect) throw new Error(`expected ${expect} for ${method} ${path}, got ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
function assert(c: unknown, m: string) { if (!c) throw new Error('ASSERT: ' + m); }

const A = { authorization: 'Bearer admin-token' };

db.admins = [{ email: 'bonaasinaa@gmail.com' }];
db.settings = [{ id: 1, data: { whatsapp: '081200000000', siteName: 'Bonaasina', feeDefaultType: 'persen', feeDefaultValue: 10 } }];
for (const k of ['properties', 'rooms', 'tenants', 'invoices', 'leads', 'owners', 'messages', 'notifications', 'activity_log',
  'owner_sessions', 'lead_sessions', 'tenant_sessions', 'contracts', 'waitlist', 'surveys', 'expenses', 'issues'] as const) {
  (db as any)[k] = [];
}

const kos = await ok('POST', '/admin/properties', { name: 'Kos Uji', kind: 'sendiri', gender: 'Campur', periods: ['bulanan'] }, A);

// Harga wajar tetap tersimpan apa adanya.
const normal = await ok('POST', '/admin/rooms', { propertyId: kos.id, code: 'U-01', priceMonthly: 550000, priceYearly: 5500000 }, A);
assert(normal.priceMonthly === 550000, 'harga wajar tersimpan');

// Harga negatif dan bukan angka harus ditolak, bukan diam-diam jadi 0.
await fail(400, 'POST', '/admin/rooms', { propertyId: kos.id, code: 'U-02', priceMonthly: -5000 }, A);
await fail(400, 'POST', '/admin/rooms', { propertyId: kos.id, code: 'U-03', priceMonthly: 'abc' }, A);
await fail(400, 'POST', '/admin/rooms', { propertyId: kos.id, code: 'U-04', extraPersonFee: -1 }, A);
await fail(400, 'PUT', `/admin/rooms/${normal.id}`, { priceYearly: -1 }, A);
const kosong = await ok('GET', '/admin/rooms', undefined, A);
assert(kosong.filter((r: any) => r.code?.startsWith('U-0')).length === 1, 'tidak ada kamar cacat yang tersimpan');

console.log('harga kamar: semua pemeriksaan lolos');
