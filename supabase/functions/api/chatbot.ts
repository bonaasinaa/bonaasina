// Bonaasina — bot sambutan live chat ("kamus" tanya-jawab).
// Bot menyapa pengunjung, menawarkan pilihan topik, dan menjawab pertanyaan yang ditulis bebas dengan
// mencocokkan kata kunci (termasuk singkatan & salah ketik ringan). Jawaban memakai data asli website
// lewat tanda seperti {harga} atau {kamar_kosong}, jadi selalu sama dengan yang tampil di halaman.
// Kamus bisa diubah admin (menu Live chat → Kamus bot); bila belum diubah, dipakai DEFAULT_KAMUS.
// Bot tidak pernah menjanjikan hal di luar data website; bila tidak paham, ia menawarkan admin.
type Row = Record<string, any>;
export type KamusEntry = { id: string; label: string; keywords: string[]; answer: string; chip: boolean; enabled: boolean };
export type BotReply = { topic: string | null; text: string; options: { id: string; label: string }[]; handoff: boolean; score: number };

export const ADMIN_TOPIC = 'admin';
export const MENU_TOPIC = 'menu';

export const DEFAULT_KAMUS: KamusEntry[] = [
  { id: 'harga', label: 'Harga sewa', chip: true, enabled: true,
    keywords: ['harga', 'biaya', 'sewa', 'tarif', 'berapa', 'bayar per bulan', 'per tahun', 'bulanan', 'tahunan', 'murah', 'mahal', 'price', 'budget', 'berdua', '2 orang', 'dua orang'],
    answer: 'Harga sewa saat ini:\n{harga}\n\nHarga bisa berubah; yang tampil di website selalu yang terbaru: {link_kamar}' },
  { id: 'kosong', label: 'Kamar kosong', chip: true, enabled: true,
    keywords: ['kosong', 'tersedia', 'available', 'sisa kamar', 'masih ada', 'ready', 'penuh', 'kamar ada'],
    answer: '{kamar_kosong}\n\nAnda bisa langsung reservasi tanpa bayar dulu di {link_survei}' },
  { id: 'fasilitas', label: 'Fasilitas', chip: true, enabled: true,
    keywords: ['fasilitas', 'wifi', 'internet', 'kamar mandi', 'kasur', 'lemari', 'dapur', 'parkir', 'listrik', 'token', 'air', 'jemuran', 'cctv', 'aman', 'keamanan', 'ac', 'kipas', 'perabot', 'masak', 'kulkas', 'motor', 'mobil'],
    answer: '{fasilitas}' },
  { id: 'lokasi', label: 'Lokasi', chip: true, enabled: true,
    keywords: ['lokasi', 'alamat', 'dimana', 'maps', 'peta', 'jarak', 'kampus', 'iakn', 'jalan', 'arah', 'tarutung', 'siborongborong', 'sipoholon'],
    answer: '{lokasi}' },
  { id: 'aturan', label: 'Aturan & tipe kos', chip: true, enabled: true,
    keywords: ['aturan', 'peraturan', 'jam malam', 'tamu', 'hewan', 'merokok', 'rokok', 'putri', 'putra', 'campur', 'pasutri', 'cowok', 'cewek', 'laki', 'perempuan', 'menginap', 'pacar'],
    answer: '{aturan}' },
  { id: 'survei', label: 'Survei / lihat kamar', chip: true, enabled: true,
    keywords: ['survei', 'survey', 'lihat kamar', 'lihat kos', 'kunjungan', 'datang', 'cek kamar', 'berkunjung', 'mampir', 'jam berapa'],
    answer: 'Boleh survei dulu sebelum membayar. Jam kunjungan: {jam_survei}.\n\nIsi formulir dan centang "lihat kos dulu", nanti kami konfirmasi lewat WhatsApp: {link_survei}' },
  { id: 'booking', label: 'Cara booking', chip: true, enabled: true,
    keywords: ['booking', 'pesan', 'reservasi', 'daftar', 'cara sewa', 'mau ngekos', 'mau kos', 'masuk kapan', 'kapan masuk', 'bisa masuk', 'mulai kos', 'pindah', 'ambil kamar'],
    answer: 'Cara booking:\n1. Kirim reservasi (gratis): pilih kamar, lama sewa, dan tanggal masuk di {link_survei}\n2. Kami pastikan kamar tersedia dan mengabari lewat WhatsApp.\n3. Bayar booking/DP lalu unggah buktinya di halaman reservasi Anda ({link_akun}).\n4. Bukti booking resmi terbit, kamar ditahan untuk Anda.' },
  { id: 'bayar', label: 'Pembayaran & deposit', chip: true, enabled: true,
    keywords: ['transfer', 'deposit', 'dp', 'rekening', 'qris', 'tunai', 'cicil', 'jatuh tempo', 'uang muka', 'pembayaran', 'bank'],
    answer: 'Cara bayar: {pembayaran}\nDeposit: {deposit}\n\nNomor rekening diberikan di halaman reservasi atau dashboard penghuni, bukan lewat chat, supaya aman.' },
  { id: 'sekitar', label: 'Kos lain di sekitar', chip: false, enabled: true,
    keywords: ['kos lain', 'kos sekitar', 'pilihan lain', 'alternatif', 'kos mitra', 'yang lain'],
    answer: 'Bila kamar kami penuh, lihat kos mitra di sekitar: {link_kos_sekitar}\nAtau daftar tunggu, nanti kami kabari saat ada kamar kosong: {link_tunggu}' },
  { id: 'penghuni', label: 'Saya sudah penghuni', chip: false, enabled: true,
    keywords: ['penghuni', 'tagihan', 'kuitansi', 'kontrak', 'lupa sandi', 'password', 'login', 'kerusakan', 'rusak', 'bocor', 'piket'],
    answer: 'Penghuni bisa melihat tagihan, kuitansi, kontrak, dan melapor kerusakan di dashboard penghuni: {link_penghuni}\nLupa kata sandi? Pilih "Bicara dengan admin" supaya kami bantu atur ulang.' },
  { id: 'mitra', label: 'Jadi mitra kos', chip: false, enabled: true,
    keywords: ['mitra', 'pemilik kos', 'kerja sama', 'kerjasama', 'pasang kos', 'iklan kos', 'titip kos'],
    answer: 'Pemilik kos di sekitar bisa bergabung jadi mitra Bonaasina. Info & formulirnya: {link_mitra}' },
  { id: ADMIN_TOPIC, label: 'Bicara dengan admin', chip: true, enabled: true,
    keywords: ['admin', 'manusia', 'cs', 'operator', 'pemilik', 'telepon', 'telpon', 'hubungi', 'whatsapp', 'wa', 'nego', 'diskon', 'komplain'],
    answer: 'Baik, pesan Anda diteruskan ke admin. Jam layanan: {jam_layanan}.' },
  { id: MENU_TOPIC, label: 'Menu', chip: false, enabled: true,
    keywords: ['halo', 'hai', 'hallo', 'horas', 'permisi', 'selamat pagi', 'selamat siang', 'selamat sore', 'selamat malam', 'pagi', 'siang', 'sore', 'malam', 'menu', 'info', 'tanya', 'nanya'],
    answer: 'Horas! Saya asisten otomatis Bonaasina. Pilih topik di bawah atau tulis pertanyaan Anda.' },
];

export const PLACEHOLDERS: Record<string, string> = {
  harga: 'Harga per kos & periode (dari data kamar)',
  kamar_kosong: 'Jumlah & nomor kamar kosong per kos',
  fasilitas: 'Fasilitas kos & kamar',
  lokasi: 'Alamat, tautan peta, dan tempat terdekat',
  aturan: 'Tipe kos (putri/campur) & ringkasan aturan',
  jam_survei: 'Jam kunjungan/survei',
  jam_layanan: 'Jam layanan live chat',
  pembayaran: 'Cara pembayaran (Pengaturan)',
  deposit: 'Info deposit (Pengaturan)',
  wa: 'Tautan WhatsApp admin',
  link_kamar: 'Tautan daftar kamar', link_survei: 'Tautan formulir reservasi/survei', link_tunggu: 'Tautan daftar tunggu',
  link_akun: 'Tautan reservasi saya', link_penghuni: 'Tautan dashboard penghuni', link_kos_sekitar: 'Tautan Kos Sekitar', link_mitra: 'Tautan jadi mitra',
};

// ------------------------------------------------------------ pemahaman teks
const SLANG: Record<string, string> = {
  brp: 'berapa', brapa: 'berapa', berapaan: 'berapa', hrg: 'harga', hrga: 'harga', kmr: 'kamar', kamr: 'kamar',
  kost: 'kos', kosan: 'kos', kostan: 'kos', ngekos: 'kos', ngekost: 'kos', gmn: 'bagaimana', gimana: 'bagaimana', bgmn: 'bagaimana', gmna: 'bagaimana',
  dmn: 'dimana', dmana: 'dimana', mana: 'dimana', lokasinya: 'lokasi', ad: 'ada', adakah: 'ada', gk: 'tidak', ga: 'tidak', gak: 'tidak', nggak: 'tidak', engga: 'tidak', enggak: 'tidak', tdk: 'tidak',
  bln: 'bulan', perbulan: 'bulanan', thn: 'tahun', pertahun: 'tahunan', tf: 'transfer', trf: 'transfer', wifii: 'wifi', km: 'kamar',
  cwk: 'cewek', cwe: 'cewek', cowo: 'cowok', cwo: 'cowok', wanita: 'perempuan', pria: 'laki', lakilaki: 'laki', min: '', mimin: 'admin', kak: '', kakak: '', bang: '', bg: '', pak: '', bu: '',
  survey: 'survei', surve: 'survei', booking: 'booking', boking: 'booking', bokking: 'booking', reservasi: 'reservasi', resevasi: 'reservasi',
  fasilitasnya: 'fasilitas', hargany: 'harga', harganya: 'harga', alamatnya: 'alamat', aturannya: 'aturan', dpnya: 'dp',
  hi: 'hai', hello: 'halo', helo: 'halo', p: 'halo', ass: 'halo', assalamualaikum: 'halo', shalom: 'halo', syalom: 'halo',
  makasih: 'terima kasih', makasi: 'terima kasih', thanks: 'terima kasih', thx: 'terima kasih', tq: 'terima kasih', trims: 'terima kasih',
};
export function normalize(s: string) {
  const words = String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return words.map((w) => (w in SLANG ? SLANG[w] : w)).join(' ').replace(/\s+/g, ' ').trim();
}
function lev(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}
const stem = (w: string) => (w.length > 5 ? w.replace(/(nya|kah|lah|pun)$/, '') : w);
function scoreEntry(text: string, tokens: string[], e: KamusEntry) {
  let score = 0;
  for (const raw of e.keywords) {
    const kw = normalize(raw); if (!kw) continue;
    if (kw.includes(' ')) { if (` ${text} `.includes(` ${kw} `) || ` ${tokens.join(' ')} `.includes(` ${kw} `)) score += 3; continue; }
    if (tokens.includes(kw)) { score += 2; continue; }
    const pre = kw.length >= 4 ? tokens.find((t) => t.startsWith(kw)) : undefined;
    if (pre) { score += kw.length >= 5 && pre.length - kw.length <= 3 ? 2 : 1; continue; }
    // Salah ketik ringan: kata panjang dianggap cocok penuh, kata pendek hanya separuh yakin.
    if (kw.length >= 5 && tokens.some((t) => t.length >= 4 && lev(t, kw) <= (kw.length >= 8 ? 2 : 1))) score += kw.length >= 6 ? 2 : 1;
  }
  return score;
}

// FAQ dari Pengaturan ikut jadi isi kamus (kata kunci diambil dari pertanyaannya).
const STOP = new Set(['apakah', 'bagaimana', 'berapa', 'kapan', 'dimana', 'saya', 'sudah', 'boleh', 'bisa', 'harus', 'atau', 'dengan', 'untuk', 'yang', 'dari', 'sebelum', 'sesudah', 'setelah', 'cara', 'melihat', 'tidak', 'ada', 'kos', 'kamar', 'disini', 'sini']);
export function faqEntries(faq: Row[] = []): KamusEntry[] {
  return faq.filter((f) => f?.q && f?.a).slice(0, 20).map((f, i) => ({
    id: `faq${i}`, label: String(f.q).slice(0, 60), chip: false, enabled: true, answer: String(f.a),
    keywords: [...new Set(normalize(f.q).split(' ').filter((w) => w.length >= 4 && !STOP.has(w)))],
  }));
}

export function sanitizeKamus(list: unknown): KamusEntry[] {
  if (!Array.isArray(list)) throw new Error('Format kamus tidak benar.');
  const seen = new Set<string>();
  const out = list.slice(0, 40).map((x: Row, i: number) => {
    let id = String(x?.id || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24) || `topik${i + 1}`;
    while (seen.has(id)) id += '_';
    seen.add(id);
    const keywords = (Array.isArray(x?.keywords) ? x.keywords : String(x?.keywords || '').split(/[,\n]/)).map((k: unknown) => String(k).trim().slice(0, 40)).filter(Boolean).slice(0, 40);
    return { id, label: String(x?.label || '').trim().slice(0, 40), keywords, answer: String(x?.answer || '').replace(/\r/g, '').trim().slice(0, 1500), chip: !!x?.chip, enabled: x?.enabled !== false };
  }).filter((e) => e.label && e.answer);
  if (!out.some((e) => e.id === ADMIN_TOPIC)) out.push(DEFAULT_KAMUS.find((e) => e.id === ADMIN_TOPIC)!);
  if (!out.some((e) => e.id === MENU_TOPIC)) out.push(DEFAULT_KAMUS.find((e) => e.id === MENU_TOPIC)!);
  return out;
}

// ------------------------------------------------------------ jawaban dari data website
const rp = (n: number) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
const range = (xs: number[]) => { const v = xs.filter((x) => x > 0); if (!v.length) return ''; const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? rp(lo) : `${rp(lo)}–${rp(hi)}`; };
const GENDER: Record<string, string> = { Putri: 'khusus putri', Putra: 'khusus putra', Campur: 'campur (putra & putri)', Pasutri: 'pasutri' };

export type BotData = { site: Row; properties: Row[]; rooms: Row[]; siteUrl: string; hoursText: string; whatsapp: string };

function placeholders(d: BotData, focus: Row[] | null): Record<string, string> {
  const props = focus?.length ? focus : d.properties;
  const roomsOf = (p: Row) => d.rooms.filter((r) => r.propertyId === p.id);
  const U = d.siteUrl;
  const harga = props.map((p) => {
    const rs = roomsOf(p);
    const parts = [['priceDaily', 'hari'], ['priceMonthly', 'bulan'], ['priceSemester', '6 bulan'], ['priceYearly', 'tahun']]
      .map(([k, w]) => { const r = range(rs.map((x) => Number(x[k]) || 0)); return r ? `${r}/${w}` : ''; }).filter(Boolean);
    const extra = rs.find((x) => Number(x.extraPersonFee) > 0);
    const extraTxt = extra ? ` Tambahan bila berdua ${rp(extra.extraPersonFee)}/${extra.extraPersonPeriod === 'tahunan' ? 'tahun' : 'bulan'}.` : '';
    return `• ${p.name}: ${parts.length ? parts.join(' · ') : 'hubungi admin'}.${extraTxt}`;
  }).join('\n');
  const kosongLines = props.map((p) => {
    const free = roomsOf(p).filter((r) => r.status === 'kosong');
    if (!free.length) return `• ${p.name}: sedang penuh.`;
    return `• ${p.name}: ${free.length} kamar kosong (${free.map((r) => r.code + (Number(r.capacity) >= 2 ? ', bisa berdua' : '')).join('; ')}).`;
  });
  const anyFree = props.some((p) => roomsOf(p).some((r) => r.status === 'kosong'));
  const kamar_kosong = `Kamar kosong saat ini:\n${kosongLines.join('\n')}${anyFree ? '' : `\n\nSemua kamar sedang terisi. Daftar tunggu supaya dikabari saat ada yang kosong: ${U}/#tunggu`}`;
  const fasilitas = props.map((p) => {
    const roomFac = [...new Set(roomsOf(p).flatMap((r) => (r.facilities || []).flatMap((f: string) => f.split(/,\s*/))).map((f: string) => f.trim()).filter(Boolean))];
    return `• ${p.name}: ${(p.facilities || []).join(', ') || '-'}.${roomFac.length ? ` Di kamar: ${roomFac.slice(0, 8).join(', ')}.` : ''}`;
  }).join('\n');
  const addrs = [...new Set(props.map((p) => p.address).filter(Boolean))];
  const maps = props.find((p) => p.mapsQuery)?.mapsQuery;
  const nearby = [...new Set(props.flatMap((p) => p.nearby || []))];
  const lokasi = `${addrs.length === 1 && props.length > 1 ? `${props.map((p) => p.name).join(' & ')} berada di lokasi yang sama:\n` : ''}${addrs.join('\n') || 'Alamat lengkap diberikan admin.'}${maps ? `\nPeta: https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(maps)}` : ''}${nearby.length ? `\nDekat: ${nearby.join(', ')}.` : ''}`;
  const rules = props[0]?.rules || [];
  const aturan = `${props.map((p) => `• ${p.name}: kos ${GENDER[p.gender] || String(p.gender || '').toLowerCase()}.`).join('\n')}${rules.length ? `\n\nBeberapa aturan penting:\n${rules.slice(0, 5).map((r: string) => `- ${r}`).join('\n')}` : ''}\n\nAturan lengkap ada di halaman kos: ${U}/#rumah`;
  const visits = [...new Set(props.map((p) => p.visitHours).filter(Boolean))];
  return {
    harga, kamar_kosong, fasilitas, lokasi, aturan,
    jam_survei: visits.length ? visits.join(' / ') : d.site.surveyHours || 'hubungi admin',
    jam_layanan: d.hoursText, pembayaran: d.site.paymentMethods || 'hubungi admin', deposit: d.site.depositInfo || 'hubungi admin',
    wa: d.whatsapp ? `https://wa.me/${d.whatsapp}` : '',
    link_kamar: `${U}/#kamar`, link_survei: `${U}/#survei`, link_tunggu: `${U}/#tunggu`, link_akun: `${U}/akun/`,
    link_penghuni: `${U}/penghuni/`, link_kos_sekitar: `${U}/kos-sekitar/`, link_mitra: `${U}/mitra/`,
  };
}
export function fill(tpl: string, vals: Record<string, string>) {
  return tpl.replace(/\{([a-z_]+)\}/g, (m, k) => (k in vals ? vals[k] : m)).replace(/\n{3,}/g, '\n\n').trim();
}

export function menuOptions(kamus: KamusEntry[], exclude?: string) {
  return kamus.filter((e) => e.enabled && e.chip && e.id !== exclude && e.id !== MENU_TOPIC).map((e) => ({ id: e.id, label: e.label }));
}

// Jawab satu pesan: berdasarkan topik yang dipilih (tombol) atau teks bebas.
export function botReply(input: { text?: string; topic?: string }, kamus: KamusEntry[], d: BotData): BotReply {
  const active = kamus.filter((e) => e.enabled);
  const all = [...active, ...faqEntries(d.site.faq)];
  const text = normalize(input.text || '');
  const tokens = text.split(' ').filter(Boolean).map(stem);
  // Pertanyaan menyebut kos tertentu → jawaban fokus ke kos itu.
  const focus = d.properties.filter((p) => tokens.some((t) => t === normalize(p.slug || '') || normalize(p.name).split(' ').filter((w) => w !== 'kos').includes(t)));
  const vals = placeholders(d, focus);
  const answer = (e: KamusEntry, score: number): BotReply => ({
    topic: e.id, text: fill(e.answer, vals), score,
    options: e.id === ADMIN_TOPIC ? [] : [...menuOptions(active, e.id).filter((o) => o.id !== ADMIN_TOPIC).slice(0, 4), { id: ADMIN_TOPIC, label: active.find((x) => x.id === ADMIN_TOPIC)?.label || 'Bicara dengan admin' }],
    handoff: e.id === ADMIN_TOPIC,
  });
  if (input.topic) {
    const e = all.find((x) => x.id === input.topic);
    if (e) return answer(e, 99);
  }
  if (/terima kasih/.test(text) && tokens.length <= 5) {
    return { topic: 'terima_kasih', text: 'Sama-sama! Ada lagi yang ingin ditanyakan?', options: menuOptions(active), handoff: false, score: 5 };
  }
  const scored = all.map((e) => ({ e, s: scoreEntry(text, tokens, e) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  // Sapaan saja ("halo kak") → menu; sapaan + pertanyaan → jawab pertanyaannya.
  const best = scored.find((x) => x.e.id !== MENU_TOPIC) || scored[0];
  if (best && best.s >= 2) {
    const r = answer(best.e, best.s);
    const second = scored.find((x) => x !== best && x.e.id !== MENU_TOPIC && x.e.id !== ADMIN_TOPIC && x.s >= 2);
    if (second && !r.options.some((o) => o.id === second.e.id)) r.options.unshift({ id: second.e.id, label: second.e.label });
    if (best.e.id === MENU_TOPIC) r.options = menuOptions(active);
    return r;
  }
  if (best) {
    // Kurang yakin: tawarkan topik yang paling mirip.
    const guess = scored.filter((x) => x.e.id !== MENU_TOPIC).slice(0, 3).map((x) => ({ id: x.e.id, label: x.e.label }));
    if (guess.length) return { topic: null, text: 'Maksud Anda salah satu dari ini?', options: [...guess, ...(guess.some((g) => g.id === ADMIN_TOPIC) ? [] : [{ id: ADMIN_TOPIC, label: 'Bicara dengan admin' }])], handoff: false, score: best.s };
  }
  return {
    topic: null, score: 0, handoff: false,
    text: 'Maaf, saya belum paham pertanyaan itu. Pilih topik di bawah, atau pilih "Bicara dengan admin" supaya dijawab langsung oleh admin.',
    options: menuOptions(active),
  };
}
