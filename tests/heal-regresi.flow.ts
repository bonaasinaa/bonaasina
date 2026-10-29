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

console.log('ALL HEAL REGRESSION TESTS PASSED');
