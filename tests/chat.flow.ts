// Uji alur live chat + bot: deno run -A --config deno.json chat.flow.ts
import { db } from './fake-supabase.ts';
import { botReply, normalize, DEFAULT_KAMUS, sanitizeKamus } from '../supabase/functions/api/chatbot.ts';
import { chatOnline, chatHoursText } from '../supabase/functions/api/chat.ts';
Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'secret'); Deno.env.set('SUPABASE_ANON_KEY', 'anon');
Deno.env.set('SITE_URL', 'https://bonaasina.my.id');
Deno.env.set('RESEND_API_KEY', 're_test_key');
const sent: any[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).includes('api.resend.com')) { sent.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ id: 'em_' + sent.length }), { status: 200 }); }
  return realFetch(input, init);
}) as typeof fetch;
const settle = () => new Promise((r) => setTimeout(r, 30));
let handler: (r: Request) => Promise<Response>;
(Deno as any).serve = (h: any) => { handler = h; return {}; };
await import('../supabase/functions/api/index.ts');

const BASE = 'https://test.supabase.co/functions/v1/api';
type H = Record<string, string>;
async function call(method: string, path: string, body?: unknown, headers: H = {}) {
  const init: RequestInit = { method, headers: { 'cf-connecting-ip': '10.0.0.1', ...headers } };
  if (body !== undefined) { init.body = JSON.stringify(body); (init.headers as H)['content-type'] = 'application/json'; }
  const res = await handler(new Request(BASE + path, init));
  return { status: res.status, data: await res.json() as any, headers: res.headers };
}
const ok = async (method: string, path: string, body?: unknown, headers: H = {}) => {
  const r = await call(method, path, body, headers);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
function assert(c: unknown, m: string) { if (!c) throw new Error('ASSERT: ' + m); }
const A = { authorization: 'Bearer admin-token' };

db.admins = [{ email: 'bonaasinaa@gmail.com' }];
db.settings = [{ id: 1, data: { whatsapp: '082245276374', siteName: 'Bonaasina', depositInfo: 'Deposit minimal Rp1.000.000', paymentMethods: 'Transfer bank atau tunai.', surveyHours: 'Setiap hari, 09.00–18.00 WIB',
  faq: [{ q: 'Apakah ada deposit?', a: 'Ada, minimal Rp1.000.000.' }] } }];
for (const t of ['email_log', 'properties', 'rooms', 'tenants', 'invoices', 'leads', 'owners', 'messages', 'notifications', 'activity_log', 'listings', 'places', 'surveys', 'expenses', 'issues', 'contracts', 'waitlist', 'chat_threads', 'chat_messages']) db[t] = [];
db.properties.push(
  { id: 'p_asina', slug: 'asina', name: 'Kos Asina', kind: 'sendiri', status: 'aktif', gender: 'Campur', address: 'Jl. Raya Tarutung Km. 11', maps_query: '2.104938, 98.956720', facilities: ['WiFi', 'Parkir motor'], rules: ['Tamu ditemui di teras.'], visit_hours: '09.00-16.00 WIB', nearby: ['IAKN'], sort: 1 },
  { id: 'p_bona', slug: 'bona', name: 'Kos Bona', kind: 'sendiri', status: 'aktif', gender: 'Putri', address: 'Jl. Raya Tarutung Km. 11', maps_query: '2.104938, 98.956720', facilities: ['WiFi', 'Dapur bersama'], rules: [], visit_hours: '09.00-16.00 WIB', nearby: ['IAKN'], sort: 2 },
  { id: 'p_mitra', slug: 'mitra', name: 'Kos Mitra', kind: 'mitra', status: 'aktif', gender: 'Putra', address: 'x', facilities: [], rules: [], sort: 3 },
);
db.rooms.push(
  { id: 'r1', property_id: 'p_asina', code: 'A-01', status: 'kosong', hidden: false, price_monthly: 550000, price_yearly: 5500000, price_daily: 0, price_semester: 0, capacity: 1, extra_person_fee: 6000000, extra_person_period: 'tahunan', facilities: ['Kasur'] },
  { id: 'r2', property_id: 'p_asina', code: 'A-02', status: 'kosong', hidden: false, price_monthly: 550000, price_yearly: 5500000, price_daily: 0, price_semester: 0, capacity: 2, extra_person_fee: 6000000, extra_person_period: 'tahunan', facilities: [] },
  { id: 'r3', property_id: 'p_bona', code: 'B-01', status: 'kosong', hidden: false, price_monthly: 0, price_yearly: 3000000, price_daily: 0, price_semester: 0, capacity: 1, extra_person_fee: 3500000, extra_person_period: 'tahunan', facilities: [] },
  { id: 'r4', property_id: 'p_mitra', code: 'M-01', status: 'kosong', hidden: false, price_monthly: 999000, price_yearly: 0, price_daily: 0, price_semester: 0, capacity: 1, extra_person_fee: 0, facilities: [] },
);
db.tenants.push({ id: 't1', room_id: 'r1', status: 'aktif', name: 'Penghuni' }); // A-01 terisi

// ---------- pemahaman teks (kamus)
const d = { site: db.settings[0].data, properties: [], rooms: [], siteUrl: 'https://x', hoursText: 'Setiap hari', whatsapp: '' };
const topic = (t: string) => botReply({ text: t }, DEFAULT_KAMUS, d as any).topic;
assert(normalize('Brp hrg kmr perbulan kak?') === 'berapa harga kamar bulanan', 'slang: ' + normalize('Brp hrg kmr perbulan kak?'));
const cases: [string, string | null][] = [
  ['brp harga kos sebulan?', 'harga'], ['harganya berapa ya', 'harga'], ['masih ada kamar kosong?', 'kosong'], ['ada wifi gak?', 'fasilitas'],
  ['lokasinya dimana min', 'lokasi'], ['alamatnya di mana', 'lokasi'], ['boleh bawa pacar ke kamar?', 'aturan'], ['ini kos putri atau campur', 'aturan'],
  ['bisa survei jam berapa', 'survei'], ['cara booking gimana', 'booking'], ['dp nya berapa dan rekeningnya apa', 'bayar'],
  ['mau ngobrol sama admin', 'admin'], ['halo kak', 'menu'], ['fasilitass', 'fasilitas'], ['saya lupa password dashboard', 'penghuni'],
  ['qwerty zxcv', null],
];
for (const [t, want] of cases) assert(topic(t) === want, `"${t}" → ${topic(t)}, harusnya ${want}`);
assert(botReply({ text: 'apakah ada deposit' }, DEFAULT_KAMUS, d as any).topic === 'faq0' || botReply({ text: 'apakah ada deposit' }, DEFAULT_KAMUS, d as any).topic === 'bayar', 'deposit → faq/bayar');
assert(botReply({ text: 'terima kasih' }, DEFAULT_KAMUS, d as any).topic === 'terima_kasih', 'terima kasih');
const k2 = sanitizeKamus([{ id: 'Laundry!', label: 'Laundry', keywords: 'laundry, cuci baju', answer: 'Ada laundry dekat kos.', chip: true }]);
assert(k2.some((e) => e.id === 'admin') && k2[0].id === 'laundry' && k2[0].keywords.length === 2, 'sanitize kamus');
assert(botReply({ text: 'ada tempat cuci baju?' }, k2, d as any).topic === 'laundry', 'kamus kustom');

// ---------- jam layanan (WIB)
const wib = (iso: string) => Date.parse(iso) - 7 * 3600e3;
const cfg = { days: [1, 2, 3, 4, 5], opens: '09:00', closes: '18:00' };
assert(chatOnline(cfg, wib('2026-10-26T09:00:00Z')), 'Senin 09:00 buka');
assert(!chatOnline(cfg, wib('2026-10-26T18:00:00Z')), 'Senin 18:00 tutup');
assert(!chatOnline(cfg, wib('2026-10-25T12:00:00Z')), 'Minggu tutup');
assert(chatOnline({ days: [5], opens: '20:00', closes: '02:00' }, wib('2026-10-31T01:00:00Z')), 'Jumat malam lewat tengah malam (Sabtu 01:00)');
assert(chatHoursText(cfg) === 'Senin–Jumat, 09.00–18.00 WIB', chatHoursText(cfg));

// ---------- API pengunjung
const conf = await ok('GET', '/chat/config');
assert(conf.enabled && conf.visible && conf.botEnabled && conf.menu.length >= 5 && conf.whatsapp === '6282245276374', 'config publik');
assert(conf.menu.some((m: any) => m.id === 'admin'), 'menu punya admin');
const harga = await ok('POST', '/chat/ask', { text: 'brp harga kamar di asina?' });
assert(harga.topic === 'harga' && harga.text.includes('Rp550.000/bulan') && harga.text.includes('Rp6.000.000/tahun') && !harga.text.includes('Kos Bona'), 'harga fokus Asina: ' + harga.text);
assert(!harga.text.includes('999.000'), 'kos mitra tidak ikut');
const kosong = await ok('POST', '/chat/ask', { topic: 'kosong' });
assert(kosong.text.includes('A-02, bisa berdua') && !kosong.text.includes('A-01') && kosong.text.includes('B-01'), 'kamar kosong pakai status penghuni: ' + kosong.text);
const lokasi = await ok('POST', '/chat/ask', { topic: 'lokasi' });
assert(lokasi.text.includes('google.com/maps') && lokasi.text.includes('lokasi yang sama'), 'lokasi: ' + lokasi.text);
const aturan = await ok('POST', '/chat/ask', { text: 'kos bona khusus cewek?' });
assert(aturan.topic === 'aturan' && aturan.text.includes('khusus putri'), 'aturan bona: ' + aturan.text);
const unk = await ok('POST', '/chat/ask', { text: 'asdf qwer' });
assert(unk.topic === null && unk.options.length >= 5, 'tidak paham → menu');
assert(db.chat_threads.length === 0, '/chat/ask tidak menyimpan');
assert((await call('GET', '/chat')).data.thread === null, 'belum ada percakapan');

// Terhubung ke admin dengan riwayat pertanyaan bot.
assert((await call('POST', '/chat/start', { message: 'halo' })).status === 400, 'nama wajib');
const st = await ok('POST', '/chat/start', { name: 'Rina', contact: '0812', message: 'Bisa nego harga tahunan?', page: '/', history: [{ topic: 'harga' }, { text: 'ada wifi?' }] });
assert(st.token && st.token.length > 30, 'token dibuat');
const V = { 'x-chat-session': st.token };
const senders = st.messages.map((m: any) => m.sender).join(',');
assert(senders === 'pengunjung,bot,pengunjung,bot,pengunjung,sistem', 'urutan pesan awal: ' + senders);
assert(st.messages[1].body.includes('Rp550.000') && st.messages[1].options?.length, 'jawaban bot dibuat ulang di server dengan opsi');
const th = db.chat_threads[0];
await settle();
assert(sent.length === 1 && sent[0].subject === 'Live chat baru dari Rina' && sent[0].to.includes('bonaasinaa@gmail.com') && sent[0].html.includes('Bisa nego harga tahunan?'), 'email admin: chat baru ' + JSON.stringify(sent.map((x) => x.subject)));
assert(th.visitor_hash !== st.token && th.visitor_hash.length === 64, 'hanya hash token disimpan');
assert(th.unread_admin === 3 && th.unread_visitor === 0, `belum dibaca admin 3 / pengunjung 0 (${th.unread_admin}/${th.unread_visitor})`);

// Pesan bebas di percakapan: bot menjawab bila yakin, diam bila tidak.
let r = await ok('POST', '/chat/messages', { body: 'kamar mandinya dalam?' }, V);
assert(r.messages.length === 2 && r.messages[1].sender === 'bot', 'bot menjawab fasilitas di percakapan');
r = await ok('POST', '/chat/messages', { body: 'Saya mahasiswa semester 3' }, V);
assert(r.messages.length === 1, 'bot diam bila tidak paham (menunggu admin)');
r = await ok('POST', '/chat/messages', { topic: 'lokasi' }, V);
assert(r.messages[0].body === 'Lokasi' && r.messages[1].sender === 'bot', 'pilih topik di percakapan');

// Admin
const sum = await ok('GET', '/admin/summary', undefined, A);
assert(sum.chat.unread === 6 && sum.chat.unreadThreads === 1 && sum.chat.latest[0].name === 'Rina', 'ringkasan admin: ' + JSON.stringify(sum.chat));
const list = await ok('GET', '/admin/chats?status=belum', undefined, A);
assert(list.threads.length === 1 && list.threads[0].contact === '0812' && !('visitorHash' in list.threads[0]), 'daftar admin tanpa hash');
const full = await ok('GET', `/admin/chats/${th.id}`, undefined, A);
assert(full.messages.length === 11 && full.thread.name === 'Rina', 'riwayat lengkap ' + full.messages.length);
assert((await ok('GET', '/admin/chats/unread', undefined, A)).unread === 0, 'dibaca admin');
await settle();
assert(sent.length === 1, 'pesan lanjutan saat admin belum membaca tidak mengirim email lagi: ' + sent.length);
await ok('POST', `/admin/chats/${th.id}/messages`, { body: 'Horas Rina, untuk nego silakan survei dulu ya.' }, A);
assert(db.chat_threads[0].unread_visitor === 1, 'pengunjung punya 1 belum dibaca');
let g = await ok('GET', `/chat?after=${full.messages.at(-1).id}&read=1`, undefined, V);
assert(g.messages.length === 1 && g.messages[0].sender === 'admin' && db.chat_threads[0].unread_visitor === 0, 'pengunjung menerima balasan & ditandai dibaca');
// Admin baru membalas → bot diam untuk teks bebas.
r = await ok('POST', '/chat/messages', { body: 'harga bulanan berapa?' }, V);
await settle();
assert(sent.length === 2 && sent[1].subject === 'Pesan live chat dari Rina', 'email saat pesan baru setelah admin membaca');
assert(r.messages.length === 1, 'bot diam saat admin aktif');
// Admin selesai → pesan pengunjung membuka lagi.
await ok('PUT', `/admin/chats/${th.id}`, { status: 'selesai' }, A);
assert(db.chat_threads[0].status === 'selesai', 'selesai');
await ok('POST', '/chat/messages', { body: 'Satu lagi, boleh bawa motor?' }, V);
assert(db.chat_threads[0].status === 'terbuka', 'dibuka lagi oleh pesan pengunjung');
// Token lain tidak bisa membaca.
assert((await call('GET', '/chat', undefined, { 'x-chat-session': 'x'.repeat(43) })).data.thread === null, 'token salah tidak melihat apa-apa');
assert((await call('POST', '/chat/messages', { body: 'hi' }, { 'x-chat-session': 'y'.repeat(43) })).status === 401, 'token salah ditolak');
// Tanpa login admin ditolak.
assert((await call('GET', '/admin/chats')).status === 401, 'admin wajib login');

// Pengaturan & kamus
let s = await ok('PUT', '/admin/chat-settings', { enabled: false, opens: '08:00', closes: '20:00', days: [1, 2, 3] }, A);
assert(!s.enabled && s.hoursText === 'Senin, Selasa, Rabu, 08.00–20.00 WIB', 'simpan pengaturan ' + s.hoursText);
assert((await call('POST', '/chat/messages', { body: 'halo' }, V)).status === 403, 'chat mati menolak pesan baru');
assert((await call('GET', '/chat', undefined, V)).data.messages.length > 0, 'riwayat tetap terbaca saat mati');
assert((await call('PUT', '/admin/chat-settings', { opens: '9' }, A)).status === 400, 'jam salah ditolak');
s = await ok('PUT', '/admin/chat-settings', { enabled: true, kamus: [...DEFAULT_KAMUS, { id: 'laundry', label: 'Laundry', keywords: ['laundry', 'cuci baju'], answer: 'Laundry ada 2 menit dari kos.', chip: true }] }, A);
assert(s.kamus.some((e: any) => e.id === 'laundry'), 'kamus kustom tersimpan');
assert((await ok('POST', '/chat/ask', { text: 'dimana bisa cuci baju' })).topic === 'laundry', 'kamus kustom dipakai bot');
assert((await ok('GET', '/chat/config')).menu.some((m: any) => m.id === 'laundry'), 'tombol topik baru tampil');
const test = await ok('POST', '/admin/chat-bot/test', { text: 'ada laundry?' }, A);
assert(test.topic === 'laundry', 'uji bot admin');
s = await ok('PUT', '/admin/chat-settings', { kamus: null }, A);
assert(!s.kamus.some((e: any) => e.id === 'laundry'), 'kembali ke kamus bawaan');
await ok('PUT', '/admin/chat-settings', { botEnabled: false }, A);
assert((await call('POST', '/chat/ask', { text: 'harga' })).status === 403, 'bot mati');
r = await ok('POST', '/chat/messages', { body: 'harga berapa' }, V);
assert(r.messages.length === 1, 'bot mati → tidak menjawab di percakapan');

// Hapus percakapan
await ok('DELETE', `/admin/chats/${th.id}`, undefined, A);
assert(db.chat_threads.length === 0, 'percakapan terhapus');
const cors = (await call('GET', '/chat/config')).headers.get('access-control-allow-headers') || '';
assert(cors.includes('x-chat-session'), 'CORS mengizinkan header chat');
assert(db.activity_log.some((l) => l.action === 'chat.start') && db.activity_log.some((l) => l.action === 'chat.reply'), 'log aktivitas');
console.log('ALL CHAT TESTS PASSED');
