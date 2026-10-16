// Cek cepat API yang sudah dideploy (tanpa mengubah data penting).
// Pakai: node scripts/api-check.mjs https://<ref>.supabase.co/functions/v1/api
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) { console.error('Berikan alamat API. Contoh: node scripts/api-check.mjs https://abc.supabase.co/functions/v1/api'); process.exit(1); }
let n = 0, fail = 0;
const check = async (name, fn) => { try { await fn(); console.log(`  ✓ ${++n}. ${name}`); } catch (e) { fail++; console.log(`  ✗ ${++n}. ${name}: ${e.message}`); } };
const call = async (method, path, body, headers = {}) => {
  const res = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: dapat ${a}, harusnya ${b}`); };

await check('data publik tersedia', async () => {
  const r = await call('GET', '/public'); eq(r.status, 200, 'status');
  if (!r.body.properties?.length) throw new Error('tidak ada kos');
  if (JSON.stringify(r.body).match(/portal_token|portalToken|emergency/i)) throw new Error('data pribadi bocor ke publik');
});
await check('survei menolak nomor tidak valid', async () => { eq((await call('POST', '/surveys', { name: 'Cek', phone: '12', propertyId: 'asina', date: '2099-01-01' })).status, 400, 'status'); });
await check('survei menolak tanggal lampau', async () => { eq((await call('POST', '/surveys', { name: 'Cek', phone: '081234567890', propertyId: 'asina', date: '2000-01-01' })).status, 400, 'status'); });
await check('admin terkunci tanpa login', async () => { eq((await call('GET', '/admin/summary')).status, 401, 'status'); });
await check('admin menolak token palsu', async () => { eq((await call('GET', '/admin/summary', null, { Authorization: 'Bearer palsu' })).status, 401, 'status'); });
await check('login salah ditolak', async () => { eq((await call('POST', '/admin/login', { email: 'bukan@admin.id', password: 'salah' })).status, 401, 'status'); });
await check('portal menolak token palsu', async () => { eq((await call('GET', '/portal/me', null, { 'X-Portal-Token': 'x'.repeat(32) })).status, 401, 'status'); });
await check('kode penyiapan palsu ditolak', async () => { eq((await call('POST', '/admin/setup', { email: 'bonaasinaa@gmail.com', code: 'salah', password: 'cukuppanjang1' })).status, 401, 'status'); });
await check('CORS untuk browser', async () => {
  const res = await fetch(base + '/public', { method: 'OPTIONS', headers: { Origin: 'https://bonaasina.pages.dev', 'Access-Control-Request-Method': 'GET' } });
  if (!res.headers.get('access-control-allow-origin')) throw new Error('header CORS tidak ada');
});
console.log(fail ? `\n${fail} cek gagal.` : `\nSemua ${n} cek lulus.`);
process.exitCode = fail ? 1 : 0;
