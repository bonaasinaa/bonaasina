// Bonaasina — Kos Sekitar: kos mitra, reservasi, akun pemilik & customer, chat, notifikasi, fee, refund.
//
// Alur reservasi (sama untuk kos mitra dan kos Bonaasina sendiri):
//   1. baru         customer mengisi reservasi (boleh sekalian minta jadwal kunjungan). Akun customer dibuat otomatis.
//   2. menunggu_dp  pemilik memastikan kamar tersedia, menetapkan total sewa & DP (≥ minimum booking) dan batas bayar.
//                   Pemilik mengirim pesan WhatsApp berisi tautan dashboard + username + kata sandi.
//   3. dp_dikirim   customer transfer DP langsung ke rekening pemilik dan mengunggah bukti.
//   4. dp_diterima  pemilik memastikan uang DP masuk. Fee Bonaasina dihitung; pemilik transfer fee & unggah bukti.
//   5. berhasil     admin memeriksa kedua bukti lalu menyetujui. Bukti booking (BNS/BK) & invoice fee (BNS/FEE) terbit.
//   Cabang: ditolak (kamar tidak tersedia), batal (sebelum DP), kedaluwarsa (lewat batas bayar DP).
//   Refund (setelah DP ditransfer): diminta → dikirim (pemilik unggah bukti) → selesai (customer konfirmasi);
//   pemilik bisa menolak dengan alasan, customer bisa melaporkan ke admin. Fee batal bila refund selesai.
// Kos milik Bonaasina sendiri: admin bertindak sebagai pemilik dan tanpa fee (langsung berhasil setelah DP diterima).
import { transactionPdf } from './docs.ts';

type Row = Record<string, any>;
type Role = 'pemilik' | 'admin';

export function createMarket(H: Record<string, any>) {
  const {
    sb, q, one, insert, update, str, num, strList, isDate, pick, toCamel, bad, notFound, HttpError, on, created,
    all, pages, rowsIn,
    readImage, putFile, signedUrl, signMany, readPrivate, pdfOut, fileSafe, sha256, randomToken, bcrypt, writeLog, clientInfo,
    background, getSettings, normalizePhone, rupiah, tanggal, todayStr, addMonths, DAY, roomFromBody, propertyPatch,
    PUBLIC_PROPERTY_FIELDS, PUBLIC_ROOM_FIELDS, PHOTO_PREFIX, SITE_URL, matchWaitlist, routes, CYCLES, roomPrice, extraFee, waLink, byCode, bySort, createProperty,
    mail, emailField,
  } = H;

  // ------------------------------------------------------------ konstanta & teks
  const ACTIVE = ['baru', 'menunggu_dp', 'dp_dikirim', 'dp_diterima'];
  const LEAD_STATUS: Record<string, string> = {
    baru: 'Menunggu konfirmasi pemilik', menunggu_dp: 'Tersedia, menunggu DP', dp_dikirim: 'Bukti DP dikirim', dp_diterima: 'DP diterima pemilik',
    berhasil: 'Booking berhasil', ditolak: 'Tidak tersedia', batal: 'Dibatalkan', kedaluwarsa: 'Batas bayar DP lewat',
  };
  const PERIOD_LABEL: Record<string, string> = { harian: 'Harian', bulanan: 'Bulanan', semesteran: '6 bulanan', tahunan: 'Tahunan' };
  const MAX_DURATION: Record<string, number> = { harian: 60, bulanan: 24, semesteran: 4, tahunan: 3 };
  const DEFAULTS = { feeDefaultType: 'persen', feeDefaultValue: 10, feeDueDays: 3, dpHours: 24, leadResponseHours: 24, bonaBankInfo: '', marketIntro: '' };
  const TPL_CONFIRM =
    'Horas {nama}, terima kasih sudah memesan di {kos} lewat Bonaasina.\n\n' +
    'Kabar baik: kamar {kamar} tersedia untuk sewa {periode} mulai {mulai}.\nTotal sewa: {harga}\nBooking/DP: {dp}, dibayar paling lambat {batas}.\n{pesan}\n' +
    'Bayar DP lewat halaman reservasi Anda:\n{link}\nUsername: {username}\nKata sandi: {password}\n\n' +
    'Di sana ada nomor rekening dan tombol untuk mengirim bukti transfer. Setelah DP diterima, Anda mendapat bukti booking resmi dari Bonaasina.';
  const TPL_REJECT =
    'Horas {nama}, terima kasih sudah memesan di {kos} lewat Bonaasina.\n\nMohon maaf, kamar belum bisa kami terima: {alasan}\n\n' +
    'Kos lain di sekitar bisa dilihat di {link_kos}\nStatus reservasi Anda tetap bisa dicek di {link} (username {username}).';
  const marketDefaults = () => ({ ...DEFAULTS });
  const marketTemplates = () => ({ defaultWaTemplateConfirm: TPL_CONFIRM, defaultWaTemplateReject: TPL_REJECT });
  const setting = async () => ({ ...DEFAULTS, ...(await getSettings()) });

  const site = () => SITE_URL;
  const nowIso = () => new Date().toISOString();
  const WAKTU = (iso?: string | null) => {
    if (!iso) return '-';
    const d = new Date(new Date(iso).getTime() + 7 * 3600e3);
    return `${tanggal(d.toISOString().slice(0, 10))}, ${String(d.getUTCHours()).padStart(2, '0')}.${String(d.getUTCMinutes()).padStart(2, '0')} WIB`;
  };
  function periodText(period: string, duration: number) {
    const d = Math.max(1, Number(duration) || 1);
    if (period === 'harian') return `${d} malam (harian)`;
    if (period === 'semesteran') return d === 1 ? '6 bulan' : `${d * 6} bulan (${d} × 6 bulan)`;
    if (period === 'tahunan') return `${d} tahun`;
    return `${d} bulan`;
  }
  function endDateOf(l: Row) {
    if (!l.moveDate) return null;
    const d = Math.max(1, Number(l.duration) || 1);
    if (l.period === 'harian') { const t = new Date(Date.parse(l.moveDate + 'T00:00:00Z') + d * DAY); return t.toISOString().slice(0, 10); }
    return addMonths(l.moveDate, d * ({ bulanan: 1, semesteran: 6, tahunan: 12 } as Row)[l.period]);
  }
  const monthsOf = (period: string, duration: number) => (period === 'harian' ? 0 : ({ bulanan: 1, semesteran: 6, tahunan: 12 } as Row)[period] * duration);
  function quote(room: Row | null, period: string, duration: number, people: number) {
    if (!room) return 0;
    const base = roomPrice(room, period) * duration;
    return base ? base + (people >= 2 ? extraFee(room, monthsOf(period, duration)) : 0) : 0;
  }
  // Awalan username dari nama kos: "Kos Bona" → bona.
  function prefixOf(p: Row) {
    const raw = String(p.shortName || p.slug || p.name || 'kos').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^kos[\s-]*/, '');
    return raw.replace(/[^a-z]/g, '').slice(0, 12) || 'kos';
  }
  const digits5 = () => String(10000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 90000));
  // Kata sandi sementara acak (10 huruf/angka tanpa yang mirip, mis. "k7mpq-x4rtw"), tidak bisa ditebak dari username.
  const ownerPassword = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; const s = [...crypto.getRandomValues(new Uint8Array(10))].map((x) => a[x % a.length]).join(''); return `${s.slice(0, 5)}-${s.slice(5)}`; };
  const defaultPassword = () => ownerPassword();
  const isMitra = (p: Row | null) => p?.kind === 'mitra';
  function feeOf(p: Row, s: Row, dp: number) {
    const type = p.feeType || s.feeDefaultType || 'persen';
    const value = Number(p.feeType ? p.feeValue : s.feeDefaultValue) || 0;
    const amount = type === 'nominal' ? Math.round(value) : Math.round((dp * value) / 100);
    return { type, value, amount: Math.max(0, Math.min(amount, dp)) };
  }
  const feeText = (type: string, value: number) => (type === 'nominal' ? rupiah(value) : `${Number(value).toLocaleString('id-ID')}% dari DP`);

  // ------------------------------------------------------------ notifikasi & pesan sistem
  // Setiap notifikasi dashboard juga dikirim ke email penerimanya (bila ada), di latar belakang.
  async function notify(type: 'admin' | 'pemilik' | 'customer', id: string | null, leadId: string | null, kind: string, title: string, body = '') {
    if (type !== 'admin' && !id) return;
    const n = await q(sb.from('notifications').insert({ recipient_type: type, recipient_id: type === 'admin' ? null : id, lead_id: leadId, kind, title: str(title, 160), body: str(body, 600) }).select('id').single()) as Row;
    background(emailNotification(type, id, leadId, kind, title, body, n?.id));
  }
  async function emailNotification(type: string, id: string | null, leadId: string | null, kind: string, title: string, body: string, nid: number) {
    const lead = leadId ? await one('leads', leadId) : null;
    const p = lead ? await one('properties', lead.propertyId) : null;
    const rows: [string, string][] = lead ? [['Reservasi', `#${lead.code}, ${lead.name}`], ['Kos', p?.name || '-'], ['Status', LEAD_STATUS[lead.status] || lead.status]] : [];
    const m = { kind: `notif.${kind}`, dedupeKey: `notif:${nid}`, subject: str(title, 160), title: str(title, 160), intro: body, rows };
    if (type === 'admin') return mail.sendAdmin({ ...m, cta: { label: 'Buka admin', url: `${site()}/admin/` } });
    if (type === 'pemilik') {
      const o = await one('owners', id!);
      if (o?.email && o.status === 'aktif') mail.send({ ...m, to: o.email, cta: { label: 'Buka dashboard pemilik', url: `${site()}/pemilik/` } });
      return;
    }
    const l = lead?.id === id ? lead : await one('leads', id!);
    if (l?.email) mail.send({ ...m, to: l.email, intro: `Horas ${l.name}, ${body ? body.charAt(0).toLowerCase() + body.slice(1) : 'ada kabar baru soal reservasi Anda.'}`, cta: { label: 'Buka halaman reservasi', url: `${site()}/akun/?u=${l.username}` } });
  }
  // Pemilik kos sendiri = admin; notifikasi pemilik untuk kos sendiri cukup ke admin.
  async function notifyOwner(p: Row, l: Row | null, kind: string, title: string, body = '') {
    if (p.ownerId) await notify('pemilik', p.ownerId, l?.id ?? null, kind, title, body);
    else await notify('admin', null, l?.id ?? null, kind, title, body);
  }
  const notifyCustomer = (l: Row, kind: string, title: string, body = '') => notify('customer', l.id, l.id, kind, title, body);
  const notifyAdmin = (l: Row | null, kind: string, title: string, body = '') => notify('admin', null, l?.id ?? null, kind, title, body);
  const sysMsg = (l: Row, body: string) => q(sb.from('messages').insert({ lead_id: l.id, sender: 'sistem', body: str(body, 2000) }));

  // ------------------------------------------------------------ sesi pemilik & customer
  const SESSION_DAYS = 30;
  const caches = { owner: new Map<string, { v: Row; until: number }>(), lead: new Map<string, { v: Row; until: number }>() };
  async function newSession(kind: 'owner' | 'lead', id: string) {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY).toISOString();
    const table = kind === 'owner' ? 'owner_sessions' : 'lead_sessions';
    await q(sb.from(table).insert({ token_hash: await sha256(token), [kind === 'owner' ? 'owner_id' : 'lead_id']: id, expires_at: expiresAt }));
    if (Math.random() < 0.05) background(Promise.resolve(sb.from(table).delete().lt('expires_at', nowIso())));
    return { token, expiresAt };
  }
  // Sebelum mengganti kata sandi bawaan hanya alamat ini yang boleh dipakai.
  const OPEN_WHEN_MUST_CHANGE = /^\/(pemilik|akun)\/(me|password|logout)$/;
  async function requireSession(req: Request, kind: 'owner' | 'lead') {
    const header = kind === 'owner' ? 'x-owner-session' : 'x-lead-session';
    const token = req.headers.get(header) || '';
    if (token.length < 20) throw new HttpError(401, 'Silakan masuk dulu.');
    const cache = caches[kind];
    let v = cache.get(token)?.until! > Date.now() ? cache.get(token)!.v : null;
    if (!v) {
      const table = kind === 'owner' ? 'owner_sessions' : 'lead_sessions';
      const sess = await q(sb.from(table).select('*').eq('token_hash', await sha256(token)).maybeSingle()) as Row | null;
      if (!sess || sess.expires_at < nowIso()) throw new HttpError(401, 'Sesi berakhir. Silakan masuk lagi.');
      v = await one(kind === 'owner' ? 'owners' : 'leads', kind === 'owner' ? sess.owner_id : sess.lead_id);
      if (!v) throw new HttpError(401, 'Akun tidak ditemukan.');
      if (Date.now() - new Date(sess.last_seen_at).getTime() > 3600e3) {
        background(Promise.resolve(sb.from(table).update({ last_seen_at: nowIso(), expires_at: new Date(Date.now() + SESSION_DAYS * DAY).toISOString() }).eq('token_hash', sess.token_hash)));
      }
      if (cache.size > 500) cache.clear();
      cache.set(token, { v, until: Date.now() + 30e3 });
    }
    if (kind === 'owner' && v.status !== 'aktif') throw new HttpError(401, 'Akun pemilik ini sedang dinonaktifkan. Hubungi admin Bonaasina.');
    if (kind === 'lead' && !v.loginEnabled) throw new HttpError(401, 'Akun ini sedang dinonaktifkan. Hubungi pemilik kos.');
    const path = new URL(req.url).pathname.replace(/^.*?\/api(?=\/|$)/, '');
    if (v.mustChange && !OPEN_WHEN_MUST_CHANGE.test(path)) throw new HttpError(403, 'Ganti kata sandi bawaan dulu sebelum melanjutkan.');
    return v;
  }
  const requireOwner = (req: Request) => requireSession(req, 'owner');
  const requireLead = (req: Request) => requireSession(req, 'lead');
  const clearCaches = () => { caches.owner.clear(); caches.lead.clear(); };

  // Satu pintu masuk untuk semua username: penghuni, pemilik kos mitra, dan customer reservasi.
  on('POST', '/masuk', async (c: Row, log: (e: Row) => void) => {
    const { req, body: b } = c;
    const username = str(b.username, 60).toLowerCase(); const password = String(b.password || '');
    const { ip } = clientInfo(req);
    const since = new Date(Date.now() - 15 * 60e3).toISOString();
    const { count } = await sb.from('activity_log').select('id', { count: 'exact', head: true })
      .in('action', ['tenant.login.failed', 'owner.login.failed', 'customer.login.failed']).eq('ip', ip).gte('created_at', since);
    if ((count ?? 0) >= 10) throw new HttpError(429, 'Terlalu banyak percobaan masuk. Coba lagi 15 menit lagi.');
    const owner = toCamel(await q(sb.from('owners').select('*').ilike('username', username).maybeSingle()));
    const lead = owner ? null : toCamel(await q(sb.from('leads').select('*').ilike('username', username).maybeSingle()));
    if (!owner && !lead) {
      // Bukan pemilik/customer → coba sebagai penghuni (pesan & pencatatan mengikuti login penghuni).
      const r = routes.find((x: Row) => x.method === 'POST' && x.re.test('/penghuni/login'));
      const out = await r.fn(c, log);
      return { kind: 'penghuni', ...out };
    }
    const who = owner || lead;
    const type = owner ? 'pemilik' : 'customer';
    const actor = owner ? owner.name : `${lead.name} (${lead.username})`;
    // Batas per akun juga (bukan hanya per IP), supaya tebakan dari banyak alamat IP tetap tertahan.
    const { count: perAccount } = await sb.from('activity_log').select('id', { count: 'exact', head: true })
      .eq('action', `${owner ? 'owner' : 'customer'}.login.failed`).eq('actor', actor).gte('created_at', since);
    if ((perAccount ?? 0) >= 10) throw new HttpError(429, 'Terlalu banyak percobaan masuk ke akun ini. Coba lagi 15 menit lagi.');
    const fail = (why: string) => {
      writeLog(req, type, actor, { action: `${owner ? 'owner' : 'customer'}.login.failed`, summary: `Gagal masuk: ${why}`, ok: false });
      return new HttpError(401, 'Username atau kata sandi salah.');
    };
    if (!password || !(await bcrypt.compare(password, who.passwordHash || ''))) throw fail('kata sandi salah');
    if (owner && owner.status !== 'aktif') throw new HttpError(403, 'Akun pemilik ini sedang dinonaktifkan. Hubungi admin Bonaasina.');
    if (lead && !lead.loginEnabled) throw new HttpError(403, 'Akun ini sedang dinonaktifkan. Hubungi pemilik kos.');
    const sess = await newSession(owner ? 'owner' : 'lead', who.id);
    await q(sb.from(owner ? 'owners' : 'leads').update({ last_login_at: nowIso() }).eq('id', who.id));
    writeLog(req, type, owner ? owner.name : `${lead.name} (${lead.username})`, { action: owner ? 'owner.login' : 'customer.login', summary: owner ? 'Masuk ke dashboard pemilik kos' : 'Masuk ke dashboard reservasi' });
    return { kind: type, token: sess.token, expiresAt: sess.expiresAt, name: who.name, username: who.username, mustChange: !!who.mustChange };
  });

  async function changePassword(kind: 'owner' | 'lead', who: Row, req: Request, b: Row) {
    const pw = String(b.newPassword || '');
    if (pw.length < 8) throw bad('Kata sandi baru minimal 8 karakter.');
    if (/^[a-z]+\d{5}$/.test(pw) && pw.startsWith(String(who.username).replace(/\d+$/, ''))) throw bad('Jangan memakai format kata sandi bawaan. Buat kata sandi baru yang hanya Anda tahu.');
    if (!who.mustChange && !(await bcrypt.compare(String(b.oldPassword || ''), who.passwordHash || ''))) throw bad('Kata sandi lama salah.');
    if (await bcrypt.compare(pw, who.passwordHash || '')) throw bad('Kata sandi baru harus berbeda dari yang lama.');
    const table = kind === 'owner' ? 'owners' : 'leads';
    const patch: Row = { password_hash: await bcrypt.hash(pw, 10), must_change: false, password_set_at: nowIso() };
    if (kind === 'lead') patch.default_password = null;
    await q(sb.from(table).update(patch).eq('id', who.id));
    const token = req.headers.get(kind === 'owner' ? 'x-owner-session' : 'x-lead-session') || '';
    await q(sb.from(kind === 'owner' ? 'owner_sessions' : 'lead_sessions').delete().eq(kind === 'owner' ? 'owner_id' : 'lead_id', who.id).neq('token_hash', await sha256(token)));
    clearCaches();
    if (who.email && !who.mustChange) mail.send({
      to: who.email, kind: 'security.password', dedupeKey: null, subject: 'Kata sandi akun Bonaasina diganti', title: 'Kata sandi Anda baru saja diganti',
      intro: `Horas ${who.name}, kata sandi akun ${who.username} baru saja diganti dan perangkat lain sudah dikeluarkan.`,
      note: kind === 'owner' ? 'Bila bukan Anda, segera hubungi admin Bonaasina.' : 'Bila bukan Anda, segera hubungi pemilik kos lewat WhatsApp.',
    });
    return { ok: true };
  }
  // Pemilik & customer bisa mengatur sendiri email untuk notifikasi.
  async function setEmail(kind: 'owner' | 'lead', who: Row, b: Row) {
    const email = emailField(b.email);
    await q(sb.from(kind === 'owner' ? 'owners' : 'leads').update({ email }).eq('id', who.id));
    clearCaches();
    if (email && email !== who.email) mail.send({
      to: email, kind: 'email.set', dedupeKey: null, subject: 'Email notifikasi Bonaasina aktif', title: 'Email notifikasi aktif',
      intro: `Horas ${who.name}, mulai sekarang kabar ${kind === 'owner' ? 'reservasi, DP, fee, dan refund kos Anda' : 'status reservasi, DP, bukti booking, dan refund'} dikirim ke alamat ini.`,
      cta: kind === 'owner' ? { label: 'Buka dashboard pemilik', url: `${site()}/pemilik/` } : { label: 'Buka halaman reservasi', url: `${site()}/akun/?u=${who.username}` },
    });
    return { email };
  }
  async function logout(kind: 'owner' | 'lead', req: Request) {
    const token = req.headers.get(kind === 'owner' ? 'x-owner-session' : 'x-lead-session') || '';
    if (token) await q(sb.from(kind === 'owner' ? 'owner_sessions' : 'lead_sessions').delete().eq('token_hash', await sha256(token)));
    clearCaches();
    return { ok: true };
  }

  // ------------------------------------------------------------ data bersama
  async function activeRoomIds() {
    const rows = (await pages((from: number, to: number) => sb.from('tenants').select('room_id').eq('status', 'aktif').range(from, to))) as Row[];
    return new Set<string>(rows.map((t: Row) => t.room_id as string));
  }
  // Daftar id dipotong per 100 supaya permintaan tidak melewati batas panjang URL ketika kos mitra banyak.
  const roomsOf = async (propertyIds: string[]) => propertyIds.length
    ? (await rowsIn('rooms', 'property_id', propertyIds, '*') as Row[]).map((r: Row) => toCamel(r)) as Row[]
    : [];
  function roomPublic(r: Row, occ: Set<string>) { return { ...pick(r, PUBLIC_ROOM_FIELDS), status: occ.has(r.id) ? 'terisi' : r.status }; }
  // Harga mulai dari per periode yang dibuka (untuk kartu kos).
  function priceFrom(p: Row, rooms: Row[]) {
    const out: Row = {};
    for (const per of p.periods || []) { const list = rooms.map((r) => roomPrice(r, per)).filter((x: number) => x > 0); if (list.length) out[per] = Math.min(...list); }
    return out;
  }
  async function ownerContact(p: Row) {
    if (p.waEnabled === false) return null;
    const s = p.kind === 'mitra' ? null : await getSettings();
    const n = normalizePhone(p.whatsapp || s?.whatsapp || '');
    return n.length >= 10 ? n : null;
  }

  // Reservasi menunggu DP yang lewat batas otomatis kedaluwarsa (dicek berkala saat ada permintaan).
  let lastExpire = 0;
  async function expireLeads() {
    if (Date.now() - lastExpire < 60e3) return;
    lastExpire = Date.now();
    const rows = (await q(sb.from('leads').update({ status: 'kedaluwarsa' }).eq('status', 'menunggu_dp').lt('dp_deadline', nowIso()).select('*')) as Row[]) || [];
    for (const r of rows.map((x) => toCamel(x))) {
      const p = await one('properties', r.propertyId);
      await sysMsg(r, 'Batas waktu pembayaran DP sudah lewat, reservasi otomatis kedaluwarsa. Pemilik bisa menawarkan ulang bila kamar masih tersedia.');
      await notifyCustomer(r, 'status', 'Batas bayar DP sudah lewat', `Reservasi di ${p?.name || 'kos'} kedaluwarsa. Hubungi pemilik bila masih berminat.`);
      if (p) await notifyOwner(p, r, 'status', `Reservasi ${r.name} kedaluwarsa`, 'Penyewa belum mengirim bukti DP sampai batas waktu.');
    }
  }

  // ================================================================ PUBLIK: daftar & detail kos
  on('GET', '/kos-sekitar', async () => {
    // Seluruh kos mitra yang aktif, diambil per halaman (tidak terpotong 1000 baris).
    const [s, props] = await Promise.all([
      getSettings(),
      pages((from: number, to: number) => sb.from('properties').select('*').eq('kind', 'mitra').eq('status', 'aktif').order('id').range(from, to)) as Promise<Row[]>,
    ]);
    const list = ((props as Row[]) || []).map((p) => toCamel(p)) as Row[];
    const [rooms, occ] = await Promise.all([roomsOf(list.map((p) => p.id)), activeRoomIds()]);
    const st = { ...DEFAULTS, ...s };
    return {
      intro: s.marketIntro || '',
      fee: { type: st.feeDefaultType === 'nominal' ? 'nominal' : 'persen', value: Number(st.feeDefaultValue) || 0 },
      whatsapp: normalizePhone(s.whatsapp || ''),
      properties: list.sort(bySort).map((p) => {
        const rs = rooms.filter((r) => r.propertyId === p.id && !r.hidden);
        return {
          ...pick(p, ['id', 'slug', 'name', 'logo', 'gender', 'tagline', 'address', 'city', 'periods', 'checkedAt']),
          photo: (p.photos || [])[0] || null, facilities: (p.facilities || []).slice(0, 6),
          totalRooms: rs.length, freeRooms: rs.filter((r) => !occ.has(r.id) && r.status === 'kosong').length,
          twoPerson: rs.some((r) => Number(r.capacity) === 2), priceFrom: priceFrom(p, rs),
        };
      }),
    };
  });
  on('GET', '/kos/:slug', async ({ params }: Row) => {
    const p = toCamel(await q(sb.from('properties').select('*').eq('slug', str(params.slug, 60).toLowerCase()).maybeSingle()));
    if (!p || p.status !== 'aktif') throw notFound('Kos ini tidak ditemukan atau sedang tidak ditampilkan.');
    const [rooms, occ, wa] = await Promise.all([roomsOf([p.id]), activeRoomIds(), ownerContact(p)]);
    return {
      property: { ...pick(p, PUBLIC_PROPERTY_FIELDS), waEnabled: !!wa, whatsapp: wa },
      rooms: rooms.filter((r) => !r.hidden).map((r) => roomPublic(r, occ)).sort(byCode),
    };
  });

  // ================================================================ PUBLIK: kirim reservasi
  on('POST', '/leads', async ({ req, body: b }: Row, log: (e: Row) => void) => {
    if (b.website) return { ok: true }; // honeypot
    const name = str(b.name, 80), phone = str(b.phone, 20), email = emailField(b.email);
    if (!name) throw bad('Isi nama Anda.');
    if (normalizePhone(phone).length < 10) throw bad('Nomor WhatsApp belum benar. Contoh: 0812 3456 7890.');
    const p = await one('properties', str(b.propertyId, 60));
    if (!p || p.status !== 'aktif') throw bad('Kos ini sedang tidak menerima reservasi.');
    const period = str(b.period, 20);
    if (!(p.periods || []).includes(period)) throw bad(`${p.name} tidak membuka sewa ${(PERIOD_LABEL[period] || period).toLowerCase()}.`);
    const duration = Math.round(Number(b.duration) || 1);
    if (duration < 1 || duration > MAX_DURATION[period]) throw bad(`Lama sewa ${PERIOD_LABEL[period].toLowerCase()} 1 sampai ${MAX_DURATION[period]}.`);
    const people = Number(b.people) === 2 ? 2 : 1;
    const today = todayStr();
    if (!isDate(b.moveDate) || b.moveDate < today) throw bad('Pilih rencana tanggal mulai tinggal, hari ini atau setelahnya.');
    if (b.moveDate > addMonths(today, 12)) throw bad('Rencana mulai tinggal maksimal 12 bulan dari sekarang.');
    let room: Row | null = null;
    if (b.roomId) {
      room = await one('rooms', str(b.roomId, 40));
      if (!room || room.propertyId !== p.id || room.hidden) throw bad('Kamar yang dipilih tidak ditemukan.');
      if (people > Number(room.capacity || 1)) throw bad(`Kamar ${room.code} hanya untuk 1 orang. Pilih kamar lain atau ubah jumlah orang.`);
      if (!roomPrice(room, period)) throw bad(`Kamar ${room.code} belum punya harga ${PERIOD_LABEL[period].toLowerCase()}.`);
    }
    const wantVisit = b.visit === true || b.visit === 'on' || b.visit === 'ya';
    if (wantVisit && (!isDate(b.visitDate) || b.visitDate < today)) throw bad('Pilih tanggal kunjungan hari ini atau setelahnya.');
    const { ip } = clientInfo(req);
    const hourAgo = new Date(Date.now() - 3600e3).toISOString();
    const [byPhone, byIp, dup] = await Promise.all([
      sb.from('leads').select('id', { count: 'exact', head: true }).eq('phone', phone).gte('created_at', hourAgo),
      sb.from('leads').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', hourAgo),
      sb.from('leads').select('id', { count: 'exact', head: true }).eq('phone', phone).eq('property_id', p.id).in('status', ACTIVE),
    ]);
    if ((byPhone.count ?? 0) >= 3 || (ip && (byIp.count ?? 0) >= 8)) throw new HttpError(429, 'Reservasi dari nomor/perangkat ini sudah cukup banyak. Coba lagi nanti atau hubungi pemilik lewat WhatsApp.');
    if ((dup.count ?? 0) > 0) throw bad(`Nomor ini masih punya reservasi aktif di ${p.name}. Buka halaman Reservasi Saya untuk melihat statusnya.`);

    const prefix = prefixOf(p);
    let rec: Row | null = null; let password = '';
    for (let i = 0; i < 8 && !rec; i++) {
      const code = digits5(); password = defaultPassword();
      const { data, error } = await sb.from('leads').insert({
        code, property_id: p.id, room_id: room?.id ?? null, name, phone, email, occupation: str(b.occupation, 80), people, period, duration,
        move_date: b.moveDate, note: str(b.note, 600), status: 'baru', username: prefix + code, password_hash: await bcrypt.hash(password, 10), default_password: password,
        visit_status: wantVisit ? 'diminta' : null, visit_date: wantVisit ? b.visitDate : null, visit_time: wantVisit ? str(b.visitTime, 20) : '', ip,
      }).select().single();
      if (!error) rec = toCamel(data);
      else if (error.code !== '23505') { console.error(error); throw new HttpError(500, 'Gagal menyimpan reservasi.'); }
    }
    if (!rec) throw new HttpError(500, 'Gagal membuat nomor reservasi. Coba lagi.');
    const what = `${room ? `kamar ${room.code}` : 'kamar (belum dipilih)'}, ${periodText(period, duration)} mulai ${tanggal(b.moveDate)}${people === 2 ? ', 2 orang' : ''}`;
    await sysMsg(rec, `Reservasi dibuat: ${what}.${wantVisit ? ` Minta kunjungan ${tanggal(b.visitDate)} ${rec.visitTime}.` : ''} Pemilik akan memastikan ketersediaan dulu — belum perlu membayar apa pun.`);
    await notifyOwner(p, rec, 'lead', `Reservasi baru dari ${name}`, `${what}. Konfirmasi ketersediaan secepatnya.`);
    if (isMitra(p)) await notifyAdmin(rec, 'lead', `Reservasi baru di ${p.name}`, `${name}: ${what}.`);
    await notifyCustomer(rec, 'info', 'Reservasi terkirim', `Pemilik ${p.name} akan memastikan ketersediaan kamar. Anda belum perlu membayar apa pun.`);
    log({ action: 'lead.create', summary: `Mengirim reservasi ${p.name}: ${what}`, target: room?.code || p.name, meta: { name } });
    return created({ ok: true, code: rec.code, username: rec.username, password, link: `${site()}/akun/?u=${rec.username}`, propertyName: p.name });
  });

  // ================================================================ tampilan reservasi
  function timeline(l: Row) {
    const done = (s: string) => ['menunggu_dp', 'dp_dikirim', 'dp_diterima', 'berhasil'].indexOf(l.status) >= ['menunggu_dp', 'dp_dikirim', 'dp_diterima', 'berhasil'].indexOf(s);
    return [
      { key: 'baru', label: 'Reservasi dikirim', at: l.createdAt, done: true },
      { key: 'menunggu_dp', label: 'Pemilik konfirmasi tersedia', at: l.confirmedAt, done: done('menunggu_dp') },
      { key: 'dp_dikirim', label: 'Bukti DP dikirim', at: l.dpUploadedAt, done: done('dp_dikirim') },
      { key: 'dp_diterima', label: 'DP diterima pemilik', at: l.dpConfirmedAt, done: done('dp_diterima') },
      { key: 'berhasil', label: 'Disetujui & bukti booking terbit', at: l.approvedAt, done: l.status === 'berhasil' },
    ];
  }
  function leadBase(l: Row, p: Row | null, room: Row | null) {
    return {
      ...pick(l, ['id', 'code', 'propertyId', 'roomId', 'name', 'phone', 'email', 'occupation', 'people', 'period', 'duration', 'moveDate', 'note', 'status',
        'rejectReason', 'cancelReason', 'cancelledBy', 'visitStatus', 'visitDate', 'visitTime', 'visitNote', 'priceTotal', 'dpAmount', 'dpDeadline', 'ownerMessage',
        'confirmedAt', 'dpUploadedAt', 'dpRejectNote', 'dpConfirmedAt', 'approvedAt', 'invoiceNo', 'refundStatus', 'refundReason', 'refundAccount', 'refundAmount',
        'refundNote', 'refundRequestedAt', 'refundSentAt', 'refundDoneAt', 'username', 'createdAt', 'updatedAt', 'respondedAt', 'tenantId']),
      statusLabel: LEAD_STATUS[l.status] || l.status, periodLabel: periodText(l.period, l.duration), endDate: endDateOf(l),
      propertyName: p?.name || '-', propertySlug: p?.slug || '', propertyKind: p?.kind || 'sendiri', roomCode: room?.code || null, roomType: room?.type || '',
      remaining: l.priceTotal != null && l.dpAmount != null ? Math.max(0, l.priceTotal - l.dpAmount) : null,
      timeline: timeline(l),
    };
  }
  async function leadContext(l: Row) {
    const [p, room] = await Promise.all([one('properties', l.propertyId), l.roomId ? one('rooms', l.roomId) : null]);
    return { p, room };
  }
  async function unreadFor(leads: Row[], side: 'pemilik' | 'customer') {
    const out = new Map<string, number>();
    if (!leads.length) return out;
    const minRead = Math.min(...leads.map((l) => Number(side === 'pemilik' ? l.ownerReadMsg : l.customerReadMsg) || 0));
    const rows = ((await q(sb.from('messages').select('lead_id, id, sender').in('lead_id', leads.map((l) => l.id)).gt('id', minRead).neq('sender', 'sistem').limit(5000))) as Row[]) || [];
    const read = new Map(leads.map((l) => [l.id, Number(side === 'pemilik' ? l.ownerReadMsg : l.customerReadMsg) || 0]));
    for (const m of rows) {
      const mine = side === 'pemilik' ? ['pemilik', 'admin'].includes(m.sender) : m.sender === 'customer';
      if (!mine && m.id > (read.get(m.lead_id) || 0)) out.set(m.lead_id, (out.get(m.lead_id) || 0) + 1);
    }
    return out;
  }
  async function leadFull(l: Row, role: 'pemilik' | 'admin' | 'customer') {
    const { p, room } = await leadContext(l);
    const s = await setting();
    const signed = await signMany([l.dpProofPath, l.feeProofPath, l.refundProofPath]);
    const base: Row = {
      ...leadBase(l, p, room),
      dpProofUrl: l.dpProofPath ? signed.get(l.dpProofPath) || null : null,
      refundProofUrl: l.refundProofPath ? signed.get(l.refundProofPath) || null : null,
      chatEnabled: p?.chatEnabled !== false,
      payTo: ['menunggu_dp', 'dp_dikirim', 'dp_diterima', 'berhasil', 'kedaluwarsa'].includes(l.status) ? (p?.bankInfo || (p?.kind === 'mitra' ? '' : s.ownBankInfo || s.paymentInfo || '')) : '',
      bookingPolicy: p?.bookingPolicy || '',
    };
    if (role === 'customer') {
      return { ...base, ownerWhatsapp: p ? await ownerContact(p) : null, room: room ? roomPublic(room, new Set()) : null, mustChange: !!l.mustChange, visitHours: p?.visitHours || '' };
    }
    const owner = p?.ownerId ? await one('owners', p.ownerId) : null;
    return {
      ...base,
      feeType: l.feeType, feeValue: l.feeValue != null ? Number(l.feeValue) : null, feeAmount: l.feeAmount, feeStatus: l.feeStatus, feeDue: l.feeDue, feeNote: l.feeNote, feeUploadedAt: l.feeUploadedAt,
      feePaidAt: l.feePaidAt, feeInvoiceNo: l.feeInvoiceNo,
      feeProofUrl: l.feeProofPath ? signed.get(l.feeProofPath) || null : null,
      feeRule: p ? (() => { const f = feeOf(p, s, l.dpAmount || 0); return isMitra(p) ? `${feeText(f.type, f.value)}${p.feeType ? '' : ' (bawaan)'}` : 'Tanpa fee (kos Bonaasina)'; })() : '',
      bonaBankInfo: s.bonaBankInfo || '',
      customerHasChanged: !l.mustChange,
      ownerName: owner?.name || (p?.kind === 'mitra' ? '-' : 'Bonaasina'), ownerPhone: owner?.phone || '',
      waCustomer: normalizePhone(l.phone),
      room: room ? { ...pick(room, ['id', 'code', 'type', 'capacity', 'status']), price: roomPrice(room, l.period) } : null,
      lastLoginAt: l.lastLoginAt,
    };
  }

  // ================================================================ aksi reservasi (pemilik & admin)
  const need = (l: Row, ...st: string[]) => { if (!st.includes(l.status)) throw bad(`Aksi ini tidak bisa dilakukan saat status "${LEAD_STATUS[l.status] || l.status}".`); };
  const save = async (l: Row, patch: Row) => Object.assign(l, await update('leads', l.id, patch));
  const who = (role: Role) => (role === 'admin' ? 'Admin Bonaasina' : 'Pemilik');
  async function releaseRoom(l: Row) {
    if (!l.roomId) return;
    const others = await sb.from('leads').select('id', { count: 'exact', head: true }).eq('room_id', l.roomId).neq('id', l.id).in('status', ['dp_diterima', 'berhasil']).is('refund_done_at', null);
    if ((others.count ?? 0) > 0) return;
    const room = await one('rooms', l.roomId);
    if (room?.status === 'dipesan' && !(await activeRoomIds()).has(room.id)) {
      await update('rooms', room.id, { status: 'kosong' });
      background(matchWaitlist(room.id));
    }
  }

  async function doConfirm(l: Row, p: Row, b: Row, role: Role) {
    need(l, 'baru', 'kedaluwarsa', 'ditolak');
    const s = await setting();
    const room = await one('rooms', str(b.roomId || l.roomId, 40));
    if (!room || room.propertyId !== p.id) throw bad('Pilih kamar yang tersedia untuk penyewa ini.');
    if ((await activeRoomIds()).has(room.id) || room.status === 'terisi') throw bad(`Kamar ${room.code} masih terisi. Pilih kamar lain atau tolak reservasi.`);
    if (room.status === 'perbaikan') throw bad(`Kamar ${room.code} sedang diperbaiki. Ubah status kamar dulu bila sudah siap.`);
    if (room.status === 'dipesan') {
      const taken = await sb.from('leads').select('id', { count: 'exact', head: true }).eq('room_id', room.id).neq('id', l.id).in('status', ['dp_diterima', 'berhasil']).is('refund_done_at', null);
      if ((taken.count ?? 0) > 0) throw bad(`Kamar ${room.code} sudah dipesan penyewa lain.`);
    }
    if (Number(l.people) > Number(room.capacity || 1)) throw bad(`Penyewa datang berdua, tetapi kamar ${room.code} hanya untuk 1 orang.`);
    const priceTotal = num(b.priceTotal) || quote(room, l.period, l.duration, l.people);
    if (!priceTotal) throw bad('Isi total sewa untuk periode yang dipesan.');
    const dp = num(b.dpAmount);
    if (!dp) throw bad('Isi jumlah DP yang harus ditransfer penyewa.');
    if (dp < (p.minBooking || 0)) throw bad(`DP minimal ${rupiah(p.minBooking)} sesuai pengaturan kos.`);
    if (dp > priceTotal) throw bad('DP tidak boleh lebih besar dari total sewa.');
    const hours = Math.min(168, Math.max(1, num(b.dpHours) || s.dpHours || 24));
    const deadline = new Date(Date.now() + hours * 3600e3).toISOString();
    const msg = str(b.message, 600);
    await save(l, {
      status: 'menunggu_dp', roomId: room.id, priceTotal, dpAmount: dp, dpDeadline: deadline, ownerMessage: msg, confirmedAt: nowIso(), respondedAt: l.respondedAt || nowIso(),
      dpRejectNote: '', rejectReason: '', dpProofPath: null, dpUploadedAt: null,
    });
    await sysMsg(l, `${who(role)} mengonfirmasi kamar ${room.code} tersedia. Total sewa ${rupiah(priceTotal)}, DP ${rupiah(dp)} dibayar sebelum ${WAKTU(deadline)}.${msg ? `\nPesan: ${msg}` : ''}`);
    await notifyCustomer(l, 'status', 'Kamar tersedia — lanjutkan pembayaran DP', `Transfer DP ${rupiah(dp)} ke rekening pemilik sebelum ${WAKTU(deadline)}, lalu unggah buktinya.`);
    return `Mengonfirmasi ketersediaan kamar ${room.code} untuk ${l.name} (DP ${rupiah(dp)})`;
  }
  async function doReject(l: Row, _p: Row, b: Row, role: Role) {
    need(l, 'baru', 'menunggu_dp', 'kedaluwarsa');
    const reason = str(b.reason, 400) || 'kamar sudah tidak tersedia pada tanggal tersebut.';
    await save(l, { status: 'ditolak', rejectReason: reason, respondedAt: l.respondedAt || nowIso() });
    await sysMsg(l, `${who(role)} menyatakan kamar belum bisa diterima: ${reason}`);
    await notifyCustomer(l, 'status', 'Reservasi belum bisa diterima', reason);
    return `Menolak reservasi ${l.name}: ${reason}`;
  }
  async function doVisit(l: Row, _p: Row, b: Row, role: Role) {
    const st = ['dijadwalkan', 'selesai', 'batal'].includes(b.visitStatus) ? b.visitStatus : 'dijadwalkan';
    if (st === 'dijadwalkan' && (!isDate(b.visitDate) || b.visitDate < todayStr())) throw bad('Pilih tanggal kunjungan hari ini atau setelahnya.');
    const patch: Row = { visitStatus: st, visitNote: str(b.visitNote, 300), respondedAt: l.respondedAt || nowIso() };
    if (st === 'dijadwalkan') { patch.visitDate = b.visitDate; patch.visitTime = str(b.visitTime, 20); }
    await save(l, patch);
    const text = st === 'dijadwalkan' ? `Kunjungan dijadwalkan ${tanggal(l.visitDate)}${l.visitTime ? ` pukul ${l.visitTime}` : ''}.` : st === 'selesai' ? 'Kunjungan ditandai selesai.' : 'Kunjungan dibatalkan.';
    await sysMsg(l, `${who(role)}: ${text}${patch.visitNote ? ` ${patch.visitNote}` : ''}`);
    await notifyCustomer(l, 'visit', st === 'dijadwalkan' ? 'Jadwal kunjungan dikonfirmasi' : 'Jadwal kunjungan diperbarui', text);
    return `Memperbarui kunjungan ${l.name}: ${text}`;
  }
  async function doDp(l: Row, p: Row, b: Row, role: Role) {
    need(l, 'dp_dikirim');
    const accept = b.accept === true || b.accept === 'true';
    if (!accept) {
      const note = str(b.note, 400) || 'Dana belum masuk ke rekening.';
      const deadline = l.dpDeadline && l.dpDeadline > nowIso() ? l.dpDeadline : new Date(Date.now() + 24 * 3600e3).toISOString();
      await save(l, { status: 'menunggu_dp', dpRejectNote: note, dpDeadline: deadline });
      await sysMsg(l, `${who(role)} belum menerima DP: ${note} Silakan periksa lalu unggah bukti yang benar sebelum ${WAKTU(deadline)}.`);
      await notifyCustomer(l, 'status', 'Bukti DP perlu diperiksa ulang', note);
      return `Menolak bukti DP ${l.name}: ${note}`;
    }
    const s = await setting();
    const mitra = isMitra(p);
    const fee = mitra ? feeOf(p, s, l.dpAmount || 0) : { type: null, value: null, amount: 0 };
    const dueDate = new Date(Date.now() + (s.feeDueDays || 3) * DAY + 7 * 3600e3).toISOString().slice(0, 10);
    await save(l, {
      status: 'dp_diterima', dpConfirmedAt: nowIso(), dpRejectNote: '',
      feeType: fee.type, feeValue: fee.value, feeAmount: fee.amount, feeStatus: mitra && fee.amount > 0 ? 'belum' : 'bebas', feeDue: mitra && fee.amount > 0 ? dueDate : null,
    });
    if (l.roomId) { const room = await one('rooms', l.roomId); if (room?.status === 'kosong') await update('rooms', room.id, { status: 'dipesan' }); }
    await sysMsg(l, `${who(role)} memastikan DP ${rupiah(l.dpAmount)} sudah masuk. Kamar ditahan untuk Anda.${mitra ? ' Bukti booking resmi terbit setelah admin Bonaasina menyetujui.' : ''}`);
    await notifyCustomer(l, 'status', 'DP diterima pemilik', mitra ? 'Kamar ditahan untuk Anda. Bukti booking resmi terbit setelah admin menyetujui.' : 'Kamar ditahan untuk Anda.');
    if (mitra) {
      if (fee.amount > 0) await notify('pemilik', p.ownerId, l.id, 'fee', `Transfer fee Bonaasina ${rupiah(fee.amount)}`, `Fee booking ${l.name} (${feeText(fee.type!, fee.value!)}). Batas ${tanggal(dueDate)}. Unggah buktinya di menu Reservasi.`);
      await notifyAdmin(l, 'approval', `DP ${l.name} diterima di ${p.name}`, fee.amount > 0 ? `Menunggu bukti fee ${rupiah(fee.amount)} dari pemilik.` : 'Tanpa fee. Siap disetujui.');
    } else if (role === 'admin') {
      // Kos Bonaasina sendiri: admin = pemilik, langsung disetujui.
      await doApprove(l, p, { feeReceived: true }, 'admin');
    }
    return `Menerima DP ${rupiah(l.dpAmount)} dari ${l.name}${fee.amount ? `, fee ${rupiah(fee.amount)}` : ''}`;
  }
  async function newDocNo(kind: string) {
    const { data, error } = await sb.rpc('next_doc_no', { kind });
    if (error || !data) { console.error(error); throw new HttpError(500, 'Gagal membuat nomor dokumen.'); }
    return data as string;
  }
  async function doApprove(l: Row, p: Row, b: Row, role: Role) {
    if (role !== 'admin') throw new HttpError(403, 'Hanya admin Bonaasina yang menyetujui transaksi.');
    need(l, 'dp_diterima');
    const manual = b.feeReceived === true || b.feeReceived === 'true';
    if (l.feeStatus === 'belum' || l.feeStatus === 'ditolak') { if (!manual) throw bad('Bukti transfer fee dari pemilik belum ada. Centang "fee sudah saya terima" bila pemilik membayar dengan cara lain.'); }
    const patch: Row = { status: 'berhasil', approvedAt: nowIso(), approvedBy: b.adminEmail || 'admin', invoiceNo: l.invoiceNo || await newDocNo('booking'), invoiceCode: l.invoiceCode || randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10).padEnd(10, '7') };
    if (l.feeAmount > 0 && !['bebas'].includes(l.feeStatus)) { patch.feeStatus = 'diterima'; patch.feePaidAt = l.feePaidAt || nowIso(); patch.feeInvoiceNo = l.feeInvoiceNo || await newDocNo('fee'); }
    await save(l, patch);
    await sysMsg(l, `Admin Bonaasina menyetujui transaksi. Bukti booking ${l.invoiceNo} sudah terbit dan bisa diunduh di halaman reservasi.`);
    await notifyCustomer(l, 'status', 'Booking berhasil', `Bukti booking ${l.invoiceNo} bisa diunduh. Sisa pembayaran ${rupiah(Math.max(0, (l.priceTotal || 0) - (l.dpAmount || 0)))} dibayar langsung ke pemilik sesuai kesepakatan.`);
    if (p.ownerId) await notify('pemilik', p.ownerId, l.id, 'status', `Booking ${l.name} disetujui`, `Bukti booking ${l.invoiceNo}${l.feeInvoiceNo ? ` dan invoice fee ${l.feeInvoiceNo}` : ''} sudah terbit.`);
    return `Menyetujui booking ${l.name} (${l.invoiceNo})`;
  }
  async function doFeeReject(l: Row, p: Row, b: Row, role: Role) {
    if (role !== 'admin') throw new HttpError(403, 'Hanya admin yang memeriksa fee.');
    if (l.feeStatus !== 'dikirim') throw bad('Belum ada bukti fee yang perlu diperiksa.');
    const note = str(b.note, 400) || 'Dana fee belum masuk ke rekening Bonaasina.';
    await save(l, { feeStatus: 'ditolak', feeNote: note });
    if (p.ownerId) await notify('pemilik', p.ownerId, l.id, 'fee', 'Bukti fee perlu diperbaiki', note);
    return `Menolak bukti fee ${l.name}: ${note}`;
  }
  async function doCancel(l: Row, p: Row, b: Row, role: Role) {
    const reason = str(b.reason, 400);
    if (['baru', 'menunggu_dp', 'kedaluwarsa'].includes(l.status)) {
      await save(l, { status: 'batal', cancelReason: reason || 'Dibatalkan.', cancelledBy: role });
      await sysMsg(l, `${who(role)} membatalkan reservasi.${reason ? ` Alasan: ${reason}` : ''}`);
      await notifyCustomer(l, 'status', 'Reservasi dibatalkan', reason);
      return `Membatalkan reservasi ${l.name}`;
    }
    // Uang DP sudah ditransfer → pembatalan lewat refund.
    need(l, 'dp_dikirim', 'dp_diterima', 'berhasil');
    if (l.refundStatus && !['ditolak'].includes(l.refundStatus)) throw bad('Refund untuk reservasi ini sudah berjalan.');
    if (!reason) throw bad('Tulis alasan pembatalan supaya penyewa mengerti.');
    await save(l, { refundStatus: 'diminta', refundReason: reason, refundRequestedAt: nowIso(), cancelledBy: role, refundAmount: l.dpAmount });
    await sysMsg(l, `${who(role)} membatalkan booking dan akan mengembalikan DP ${rupiah(l.dpAmount)}. Alasan: ${reason}\nPenyewa: tulis rekening untuk pengembalian DP di halaman reservasi.`);
    await notifyCustomer(l, 'refund', 'Booking dibatalkan pemilik, DP dikembalikan', 'Tulis rekening untuk pengembalian DP di halaman reservasi Anda.');
    if (role !== 'admin') await notifyAdmin(l, 'refund', `Pemilik ${p.name} membatalkan booking ${l.name}`, reason);
    return `Membatalkan booking ${l.name} dengan refund: ${reason}`;
  }
  async function doRefundReject(l: Row, p: Row, b: Row, role: Role) {
    if (l.refundStatus !== 'diminta') throw bad('Tidak ada permintaan refund yang menunggu.');
    const reason = str(b.reason, 400);
    if (!reason) throw bad('Tulis alasan menolak refund (mis. sesuai aturan booking kos).');
    await save(l, { refundStatus: 'ditolak', refundNote: reason });
    await sysMsg(l, `${who(role)} menolak permintaan refund: ${reason}\nBila tidak setuju, penyewa bisa melapor ke admin Bonaasina dari halaman reservasi.`);
    await notifyCustomer(l, 'refund', 'Permintaan refund ditolak', reason);
    if (role !== 'admin') await notifyAdmin(l, 'refund', `Refund ${l.name} ditolak pemilik ${p.name}`, reason);
    return `Menolak refund ${l.name}: ${reason}`;
  }
  async function doRefundDone(l: Row, p: Row, b: Row, role: Role) {
    if (role !== 'admin') throw new HttpError(403, 'Hanya admin yang menutup refund secara manual.');
    if (!['dikirim', 'dilaporkan', 'diminta', 'ditolak'].includes(l.refundStatus)) throw bad('Tidak ada refund yang berjalan.');
    await finishRefund(l, p, str(b.note, 300) || 'Ditutup admin.');
    return `Menutup refund ${l.name}`;
  }
  async function doRefundReopen(l: Row, _p: Row, b: Row, role: Role) {
    if (role !== 'admin') throw new HttpError(403, 'Hanya admin.');
    if (!['ditolak', 'dilaporkan'].includes(l.refundStatus)) throw bad('Refund tidak sedang ditolak atau dilaporkan.');
    await save(l, { refundStatus: 'diminta', refundNote: str(b.note, 300) });
    await sysMsg(l, `Admin Bonaasina meminta pemilik memproses refund.${b.note ? ` Catatan: ${str(b.note, 300)}` : ''}`);
    const pp = await one('properties', l.propertyId);
    if (pp?.ownerId) await notify('pemilik', pp.ownerId, l.id, 'refund', `Admin meminta refund ${l.name} diproses`, str(b.note, 300));
    return `Meminta pemilik memproses refund ${l.name}`;
  }
  async function doFeeReturned(l: Row, _p: Row, _b: Row, role: Role) {
    if (role !== 'admin') throw new HttpError(403, 'Hanya admin.');
    if (l.refundStatus !== 'selesai' || !['diterima', 'dikirim'].includes(l.feeStatus)) throw bad('Biaya layanan dikembalikan setelah pengembalian DP ke penyewa selesai.');
    await save(l, { feeStatus: 'dikembalikan' });
    const pp = await one('properties', l.propertyId);
    if (pp?.ownerId) await notify('pemilik', pp.ownerId, l.id, 'fee', `Fee booking ${l.name} dikembalikan`, `Fee ${rupiah(l.feeAmount)} dikembalikan karena booking dibatalkan dengan refund.`);
    return `Menandai fee ${l.name} sudah dikembalikan ke pemilik`;
  }
  async function finishRefund(l: Row, p: Row, note: string) {
    const feeToReturn = ['diterima', 'dikirim'].includes(l.feeStatus);
    await save(l, { refundStatus: 'selesai', refundDoneAt: nowIso(), status: 'batal', cancelReason: l.cancelReason || l.refundReason, feeStatus: feeToReturn ? l.feeStatus : (l.feeStatus ? 'bebas' : null), refundNote: note });
    await releaseRoom(l);
    await sysMsg(l, `Refund selesai. ${note}`);
    await notifyOwner(p, l, 'refund', `Refund ${l.name} selesai`, feeToReturn ? 'Fee booking akan dikembalikan admin Bonaasina.' : 'Booking ditutup.');
    if (isMitra(p)) await notifyAdmin(l, 'refund', `Refund ${l.name} selesai`, feeToReturn ? `Kembalikan fee ${rupiah(l.feeAmount)} ke pemilik ${p.name}.` : '');
  }

  const ACTIONS: Record<string, (l: Row, p: Row, b: Row, role: Role) => Promise<string>> = {
    confirm: doConfirm, reject: doReject, visit: doVisit, dp: doDp, approve: doApprove, 'fee-reject': doFeeReject, cancel: doCancel,
    'refund-reject': doRefundReject, 'refund-done': doRefundDone, 'refund-reopen': doRefundReopen, 'fee-returned': doFeeReturned,
  };

  // Pesan WhatsApp yang disiapkan untuk pemilik (konfirmasi tersedia / tidak tersedia / kirim akses dashboard).
  async function waMessage(l: Row, p: Row, kind: string) {
    const s = await setting();
    const room = l.roomId ? await one('rooms', l.roomId) : null;
    let password = l.defaultPassword || '';
    if (l.mustChange && !password) {
      // Kata sandi bawaan hilang (data lama) → buat yang baru.
      password = defaultPassword();
      await save(l, { passwordHash: await bcrypt.hash(password, 10), defaultPassword: password });
    }
    const pwText = l.mustChange ? password : '(kata sandi yang sudah Anda buat)';
    const link = `${site()}/akun/?u=${l.username}`;
    const fill = (tpl: string) => tpl
      .replaceAll('{nama}', l.name).replaceAll('{kos}', p.name).replaceAll('{kamar}', room?.code || '-').replaceAll('{periode}', periodText(l.period, l.duration))
      .replaceAll('{mulai}', tanggal(l.moveDate)).replaceAll('{harga}', rupiah(l.priceTotal || 0)).replaceAll('{dp}', rupiah(l.dpAmount || 0))
      .replaceAll('{batas}', WAKTU(l.dpDeadline)).replaceAll('{pesan}', l.ownerMessage ? `\n${l.ownerMessage}\n` : '').replaceAll('{rekening}', p.bankInfo || s.ownBankInfo || s.paymentInfo || '-')
      .replaceAll('{link}', link).replaceAll('{username}', l.username).replaceAll('{password}', pwText)
      .replaceAll('{alasan}', l.rejectReason || '-').replaceAll('{link_kos}', `${site()}/kos-sekitar/`).replace(/\n{3,}/g, '\n\n');
    let text: string;
    if (kind === 'tolak') text = fill(s.waTemplateReject || TPL_REJECT);
    else if (kind === 'konfirmasi' && l.status === 'menunggu_dp') text = fill(s.waTemplateConfirm || TPL_CONFIRM);
    else text = fill(`Horas {nama}, ini info masuk ke halaman reservasi Anda di {kos} (Bonaasina).\n\nStatus: ${LEAD_STATUS[l.status]}\n{link}\nUsername: {username}\nKata sandi: {password}\n\nDi halaman itu Anda bisa melihat status, chat dengan pemilik, dan mengunggah bukti transfer.`);
    return { text, url: waLink(l.phone, text) };
  }

  async function postMessage(l: Row, sender: string, body: string) {
    const text = str(body, 1000);
    if (!text) throw bad('Tulis pesannya dulu.');
    const since = new Date(Date.now() - 60e3).toISOString();
    const { count } = await sb.from('messages').select('id', { count: 'exact', head: true }).eq('lead_id', l.id).eq('sender', sender).gte('created_at', since);
    if ((count ?? 0) >= 20) throw new HttpError(429, 'Terlalu banyak pesan dalam satu menit. Tunggu sebentar.');
    const m = toCamel(await q(sb.from('messages').insert({ lead_id: l.id, sender, body: text }).select().single()));
    // Notifikasi chat cukup satu yang belum dibaca per reservasi.
    const p = await one('properties', l.propertyId);
    const targets: [string, string | null][] = sender === 'customer' ? [p?.ownerId ? ['pemilik', p.ownerId] : ['admin', null]] : [['customer', l.id]];
    for (const [type, id] of targets) {
      let nq = sb.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_type', type).eq('lead_id', l.id).eq('kind', 'chat').is('read_at', null);
      nq = id ? nq.eq('recipient_id', id) : nq.is('recipient_id', null);
      const { count: open } = await nq;
      if (!open) await notify(type as any, id, l.id, 'chat', sender === 'customer' ? `Pesan baru dari ${l.name}` : `Pesan baru dari ${sender === 'admin' ? 'admin Bonaasina' : `pemilik ${p?.name || 'kos'}`}`, text.slice(0, 140));
    }
    if (sender === 'customer') await save(l, { customerReadMsg: m.id });
    else if (sender === 'pemilik' || (sender === 'admin' && !isMitra(p))) await save(l, { ownerReadMsg: m.id, respondedAt: l.respondedAt || nowIso() });
    return m;
  }
  async function listMessages(l: Row, after: number, side: 'pemilik' | 'customer' | 'admin') {
    const rows = ((await q(sb.from('messages').select('*').eq('lead_id', l.id).gt('id', after).order('id', { ascending: true }).limit(300))) as Row[] || []).map((r) => toCamel(r));
    const last = rows.length ? rows[rows.length - 1].id : 0;
    if (last) {
      if (side === 'customer' && last > (l.customerReadMsg || 0)) await save(l, { customerReadMsg: last });
      if (side === 'pemilik' && last > (l.ownerReadMsg || 0)) await save(l, { ownerReadMsg: last });
      if (side === 'admin') { const p = await one('properties', l.propertyId); if (!isMitra(p) && last > (l.ownerReadMsg || 0)) await save(l, { ownerReadMsg: last }); }
    }
    // Notifikasi chat ikut terbaca.
    const type = side === 'admin' ? 'admin' : side;
    let nq = sb.from('notifications').update({ read_at: nowIso() }).eq('recipient_type', type).eq('lead_id', l.id).eq('kind', 'chat').is('read_at', null);
    if (side === 'customer') nq = nq.eq('recipient_id', l.id);
    await nq;
    return { messages: rows.map((m) => pick(m, ['id', 'sender', 'body', 'createdAt'])), status: l.status, updatedAt: l.updatedAt };
  }

  // Notifikasi
  async function notifList(type: string, id: string | null) {
    let lq = sb.from('notifications').select('*').eq('recipient_type', type).order('id', { ascending: false }).limit(60);
    let cq = sb.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_type', type).is('read_at', null);
    if (id) { lq = lq.eq('recipient_id', id); cq = cq.eq('recipient_id', id); }
    const [rows, unread] = await Promise.all([q(lq), cq]);
    return { items: ((rows as Row[]) || []).map((r) => pick(toCamel(r), ['id', 'leadId', 'kind', 'title', 'body', 'readAt', 'createdAt'])), unread: unread.count ?? 0 };
  }
  async function notifRead(type: string, id: string | null, b: Row) {
    let uq = sb.from('notifications').update({ read_at: nowIso() }).eq('recipient_type', type).is('read_at', null);
    if (id) uq = uq.eq('recipient_id', id);
    if (Array.isArray(b.ids) && b.ids.length) uq = uq.in('id', b.ids.map(Number).filter(Number.isFinite).slice(0, 200));
    else if (b.leadId) uq = uq.eq('lead_id', str(b.leadId, 40));
    await q(uq);
    return { ok: true };
  }

  // Unggah bukti transfer (privat).
  async function storeProof(req: Request, l: Row, what: string) {
    const { buf, type, ext } = await readImage(req);
    const path = `leads/${l.id}/${what}-${Date.now()}.${ext}`;
    await putFile('private', path, buf, type);
    return path;
  }

  // PDF bukti booking & invoice fee
  async function bookingDoc(l: Row) {
    if (l.status !== 'berhasil' && !(l.status === 'batal' && l.invoiceNo)) throw bad('Bukti booking terbit setelah admin menyetujui transaksi.');
    const { p, room } = await leadContext(l);
    const owner = p?.ownerId ? await one('owners', p.ownerId) : null;
    const refunded = l.refundStatus === 'selesai';
    return await transactionPdf({
      title: 'BUKTI BOOKING', number: l.invoiceNo, issuedAt: l.approvedAt || nowIso(), subtitle: `${p?.name || ''}${p?.city ? `, ${p.city}` : ''}`,
      intro: `Bonaasina menyatakan booking berikut sudah dibayar DP-nya kepada pemilik kos dan telah diperiksa admin.${refunded ? ' Booking ini kemudian DIBATALKAN dan DP sudah dikembalikan.' : ''}`,
      rows: [
        ['Nama penyewa', `${l.name}${l.people === 2 ? ' (2 orang)' : ''}`], ['Nomor reservasi', `#${l.code}`], ['Kos', `${p?.name || '-'}${p?.address ? `, ${p.address}` : ''}`],
        ['Kamar', room ? `${room.code}${room.type ? `, ${room.type}` : ''}` : '-'], ['Lama sewa', periodText(l.period, l.duration)],
        ['Mulai tinggal', tanggal(l.moveDate)], ['Sampai', tanggal(endDateOf(l))], ['Total sewa', rupiah(l.priceTotal || 0)],
        ['DP dibayar', `${rupiah(l.dpAmount || 0)} (diterima pemilik ${WAKTU(l.dpConfirmedAt)})`],
        ['Sisa pembayaran', `${rupiah(Math.max(0, (l.priceTotal || 0) - (l.dpAmount || 0)))}, dibayar langsung ke pemilik`],
        ['Pemilik / pengelola', owner ? `${owner.name}${owner.phone ? `, ${owner.phone}` : ''}` : 'Bonaasina'],
      ],
      amountLabel: 'DP / booking yang sudah dibayar', amount: l.dpAmount || 0, stamp: refunded ? 'DIBATALKAN' : 'BERHASIL',
      notes: [p?.bookingPolicy ? `Aturan booking kos: ${p.bookingPolicy}` : 'Aturan pembatalan mengikuti kesepakatan dengan pemilik kos.', 'Tunjukkan bukti ini saat datang ke kos. Keaslian bisa dicek dengan memindai kode QR.'],
      signer: 'Admin Bonaasina', verifyCode: l.invoiceCode,
    });
  }
  async function feeDoc(l: Row) {
    if (!l.feeInvoiceNo) throw bad('Invoice fee terbit setelah admin menerima fee.');
    const { p } = await leadContext(l);
    const owner = p?.ownerId ? await one('owners', p.ownerId) : null;
    return await transactionPdf({
      title: 'INVOICE FEE', number: l.feeInvoiceNo, issuedAt: l.feePaidAt || l.approvedAt || nowIso(), subtitle: `Kemitraan Kos Sekitar — ${p?.name || ''}`,
      intro: `Fee kemitraan atas booking yang terjadi lewat website Bonaasina telah diterima dari ${owner?.name || 'pemilik kos'}.`,
      rows: [
        ['Ditagihkan kepada', `${owner?.name || '-'} (pemilik ${p?.name || '-'})`], ['Booking', `#${l.code}, ${l.name}, mulai ${tanggal(l.moveDate)}`],
        ['Bukti booking', l.invoiceNo || '-'], ['DP booking', rupiah(l.dpAmount || 0)], ['Ketentuan fee', feeText(l.feeType, Number(l.feeValue))],
        ['Status', l.feeStatus === 'dikembalikan' ? 'Dikembalikan karena booking dibatalkan' : 'Lunas'], ['Tanggal diterima', WAKTU(l.feePaidAt)],
      ],
      amountLabel: 'Fee Bonaasina', amount: l.feeAmount || 0, stamp: l.feeStatus === 'dikembalikan' ? 'DIKEMBALIKAN' : 'LUNAS',
      notes: ['Biaya layanan dihitung dari DP yang ditransfer penyewa langsung ke rekening pemilik.', 'Bila booking dibatalkan dan DP dikembalikan ke penyewa, biaya layanan dikembalikan ke pemilik.'],
      signer: 'Admin Bonaasina', verifyCode: null,
    });
  }
  async function verifyBooking(code: string) {
    const l = toCamel(await q(sb.from('leads').select('*').eq('invoice_code', code).maybeSingle()));
    if (!l) return null;
    const { p, room } = await leadContext(l);
    return { type: 'booking', valid: l.status === 'berhasil', invoiceNo: l.invoiceNo, name: l.name, propertyName: p?.name || '', roomCode: room?.code || '', periodLabel: `${periodText(l.period, l.duration)} mulai ${tanggal(l.moveDate)}`, amount: l.dpAmount, approvedAt: l.approvedAt, refunded: l.refundStatus === 'selesai' };
  }

  // ================================================================ CUSTOMER (/akun)
  on('POST', '/akun/logout', async ({ req }: Row, log: (e: Row) => void) => { log({ action: 'customer.logout', summary: 'Keluar dari dashboard reservasi' }); return await logout('lead', req); });
  on('POST', '/akun/password', async ({ req, body: b, lead: l }: Row, log: (e: Row) => void) => {
    const out = await changePassword('lead', l, req, b);
    log({ action: 'customer.password', summary: l.mustChange ? 'Mengganti kata sandi bawaan' : 'Mengganti kata sandi' });
    return out;
  });
  on('PUT', '/akun/email', async ({ body: b, lead: l }: Row, log: (e: Row) => void) => {
    const out = await setEmail('lead', l, b);
    log({ action: 'customer.email', summary: out.email ? 'Mengatur email notifikasi' : 'Menghapus email notifikasi' });
    return out;
  });
  on('GET', '/akun/me', async ({ lead: l }: Row) => {
    await expireLeads();
    const cur = await one('leads', l.id);
    const [full, n, unread] = await Promise.all([leadFull(cur, 'customer'), notifList('customer', cur.id), unreadFor([cur], 'customer')]);
    return { lead: full, unreadMessages: unread.get(cur.id) || 0, notifications: n };
  });
  const myLead = async (l: Row) => (await one('leads', l.id)) as Row;
  on('POST', '/akun/dp-proof', async ({ req, lead }: Row, log: (e: Row) => void) => {
    await expireLeads();
    const l = await myLead(lead);
    need(l, 'menunggu_dp');
    const path = await storeProof(req, l, 'dp');
    // Perubahan status dicek ulang di database: bila reservasi dibatalkan/kedaluwarsa saat berkas
    // sedang diunggah, status tidak boleh ditimpa menjadi "DP dikirim".
    const { data: updated, error } = await sb.from('leads')
      .update({ status: 'dp_dikirim', dp_proof_path: path, dp_uploaded_at: nowIso(), dp_reject_note: '' })
      .eq('id', l.id).eq('status', 'menunggu_dp').select('*').maybeSingle();
    if (error) { console.error(error); throw new HttpError(500, 'Gagal menyimpan bukti DP.'); }
    if (!updated) {
      await sb.storage.from('private').remove([path]).catch(() => {});
      throw bad('Reservasi ini sudah berubah status (mungkin dibatalkan atau kedaluwarsa), jadi bukti DP tidak disimpan. Muat ulang halaman reservasi Anda.');
    }
    Object.assign(l, toCamel(updated));
    const p = await one('properties', l.propertyId);
    await sysMsg(l, `Penyewa mengunggah bukti transfer DP ${rupiah(l.dpAmount)}. Pemilik: periksa mutasi rekening lalu konfirmasi.`);
    await notifyOwner(p, l, 'dp', `Bukti DP dari ${l.name}`, `Periksa transfer ${rupiah(l.dpAmount)} di rekening Anda, lalu konfirmasi di menu Reservasi.`);
    if (isMitra(p)) await notifyAdmin(l, 'dp', `Bukti DP ${l.name} di ${p.name}`, rupiah(l.dpAmount));
    log({ action: 'customer.dp_proof', summary: `Mengunggah bukti DP ${rupiah(l.dpAmount)} untuk ${p?.name || ''}` });
    return { ok: true };
  }, { raw: true });
  on('POST', '/akun/cancel', async ({ body: b, lead }: Row, log: (e: Row) => void) => {
    const l = await myLead(lead);
    need(l, 'baru', 'menunggu_dp', 'kedaluwarsa');
    const reason = str(b.reason, 400);
    await save(l, { status: 'batal', cancelReason: reason || 'Dibatalkan penyewa.', cancelledBy: 'customer' });
    const p = await one('properties', l.propertyId);
    await sysMsg(l, `Penyewa membatalkan reservasi.${reason ? ` Alasan: ${reason}` : ''}`);
    await notifyOwner(p, l, 'status', `${l.name} membatalkan reservasi`, reason);
    log({ action: 'customer.cancel', summary: `Membatalkan reservasi ${p?.name || ''}` });
    return { ok: true };
  });
  on('POST', '/akun/refund', async ({ body: b, lead }: Row, log: (e: Row) => void) => {
    const l = await myLead(lead);
    const p = await one('properties', l.propertyId);
    const account = str(b.account, 200);
    if (!account) throw bad('Tulis rekening tujuan refund (bank, nomor, nama pemilik rekening).');
    if (l.refundStatus === 'diminta') {
      // Melengkapi/mengubah rekening tujuan saat refund sedang diproses.
      await save(l, { refundAccount: account });
      await sysMsg(l, `Penyewa memperbarui rekening tujuan refund: ${account}`);
      await notifyOwner(p, l, 'refund', `Rekening refund ${l.name} diperbarui`, account);
      return { ok: true };
    }
    need(l, 'dp_dikirim', 'dp_diterima', 'berhasil');
    if (l.refundStatus && l.refundStatus !== 'ditolak') throw bad('Refund sudah berjalan.');
    const reason = str(b.reason, 400);
    if (!reason) throw bad('Tulis alasan meminta refund.');
    await save(l, { refundStatus: 'diminta', refundReason: reason, refundAccount: account, refundRequestedAt: nowIso(), refundAmount: l.dpAmount, cancelledBy: 'customer' });
    await sysMsg(l, `Penyewa meminta pengembalian DP. Alasan: ${reason}\nRekening tujuan: ${account}`);
    await notifyOwner(p, l, 'refund', `${l.name} meminta refund DP`, `${reason}. Proses sesuai aturan booking kos Anda.`);
    if (isMitra(p)) await notifyAdmin(l, 'refund', `Permintaan refund ${l.name} di ${p.name}`, reason);
    log({ action: 'customer.refund', summary: `Meminta refund DP ${p?.name || ''}` });
    return { ok: true };
  });
  on('POST', '/akun/refund/confirm', async ({ body: b, lead }: Row, log: (e: Row) => void) => {
    const l = await myLead(lead);
    const p = await one('properties', l.propertyId);
    const received = b.received === true || b.received === 'true';
    if (received) {
      if (l.refundStatus !== 'dikirim') throw bad('Pemilik belum mengirim bukti refund.');
      await finishRefund(l, p, 'Penyewa mengonfirmasi dana refund sudah diterima.');
      log({ action: 'customer.refund_ok', summary: 'Mengonfirmasi refund sudah diterima' });
      return { ok: true };
    }
    if (!['dikirim', 'ditolak', 'diminta'].includes(l.refundStatus)) throw bad('Tidak ada refund yang bisa dilaporkan.');
    const note = str(b.note, 400);
    if (!note) throw bad('Ceritakan singkat masalahnya supaya admin bisa membantu.');
    await save(l, { refundStatus: 'dilaporkan', refundNote: note });
    await sysMsg(l, `Penyewa melaporkan masalah refund ke admin Bonaasina: ${note}`);
    await notifyAdmin(l, 'refund', `Laporan refund dari ${l.name} (${p?.name || ''})`, note);
    if (p?.ownerId) await notify('pemilik', p.ownerId, l.id, 'refund', `${l.name} melaporkan refund ke admin`, note);
    log({ action: 'customer.refund_report', summary: 'Melaporkan masalah refund ke admin' });
    return { ok: true };
  });
  on('POST', '/akun/visit', async ({ body: b, lead }: Row, log: (e: Row) => void) => {
    const l = await myLead(lead);
    if (!ACTIVE.includes(l.status) && l.status !== 'berhasil') throw bad('Reservasi ini sudah selesai.');
    if (!isDate(b.visitDate) || b.visitDate < todayStr()) throw bad('Pilih tanggal kunjungan hari ini atau setelahnya.');
    await save(l, { visitStatus: 'diminta', visitDate: b.visitDate, visitTime: str(b.visitTime, 20), visitNote: str(b.visitNote, 300) });
    const p = await one('properties', l.propertyId);
    await sysMsg(l, `Penyewa meminta kunjungan ${tanggal(l.visitDate)}${l.visitTime ? ` pukul ${l.visitTime}` : ''}.${l.visitNote ? ` ${l.visitNote}` : ''}`);
    await notifyOwner(p, l, 'visit', `${l.name} minta jadwal kunjungan`, `${tanggal(l.visitDate)} ${l.visitTime}`);
    log({ action: 'customer.visit', summary: `Meminta kunjungan ${p?.name || ''} ${tanggal(l.visitDate)}` });
    return { ok: true };
  });
  on('GET', '/akun/messages', async ({ url, lead }: Row) => {
    const l = await myLead(lead);
    return await listMessages(l, Number(url.searchParams.get('after')) || 0, 'customer');
  });
  on('POST', '/akun/messages', async ({ body: b, lead }: Row) => {
    const l = await myLead(lead);
    const p = await one('properties', l.propertyId);
    if (p?.chatEnabled === false) throw bad('Chat untuk kos ini sedang dimatikan pemilik. Hubungi lewat WhatsApp.');
    return pick(await postMessage(l, 'customer', b.body), ['id', 'sender', 'body', 'createdAt']);
  });
  on('GET', '/akun/notifications', async ({ lead: l }: Row) => notifList('customer', l.id));
  on('POST', '/akun/notifications/read', async ({ body: b, lead: l }: Row) => notifRead('customer', l.id, b));
  on('GET', '/akun/booking.pdf', async ({ lead }: Row, log: (e: Row) => void) => {
    const l = await myLead(lead);
    const bytes = await bookingDoc(l);
    log({ action: 'customer.booking_pdf', summary: `Mengunduh bukti booking ${l.invoiceNo}`, dedupeMinutes: 10 });
    return pdfOut(bytes, `bukti-booking-${fileSafe(l.invoiceNo)}.pdf`);
  });

  // ================================================================ PEMILIK (/pemilik)
  const ownerProps = async (o: Row) => ((await q(sb.from('properties').select('*').eq('owner_id', o.id))) as Row[] || []).map((p) => toCamel(p)).sort(bySort) as Row[];
  async function ownerProp(o: Row, id: string) {
    const p = await one('properties', str(id, 60));
    if (!p || p.ownerId !== o.id) throw notFound('Kos tidak ditemukan.');
    return p;
  }
  async function ownerLead(o: Row, id: string) {
    const l = await one('leads', str(id, 40));
    if (!l) throw notFound('Reservasi tidak ditemukan.');
    const p = await one('properties', l.propertyId);
    if (!p || p.ownerId !== o.id) throw notFound('Reservasi tidak ditemukan.');
    return { l, p };
  }
  async function leadList(props: Row[], side: 'pemilik' | 'admin') {
    if (!props.length) return [];
    await expireLeads();
    const s = await setting();
    const ids = props.map((p) => p.id);
    // Id kos dipotong per 100: ratusan kos mitra tidak lagi membuat permintaan gagal.
    const [rows, rooms] = await Promise.all([
      rowsIn('leads', 'property_id', ids, '*', (b: any) => b.order('created_at', { ascending: false })) as Promise<Row[]>,
      roomsOf(ids),
    ]);
    const leads = ((rows as Row[]) || []).map((r) => toCamel(r)) as Row[];
    const pm = new Map(props.map((p) => [p.id, p])); const rm = new Map(rooms.map((r) => [r.id, r]));
    const unread = await unreadFor(leads, 'pemilik');
    const slow = Date.now() - (s.leadResponseHours || 24) * 3600e3;
    const today = todayStr();
    return leads.map((l) => {
      const p = pm.get(l.propertyId)!;
      return {
        ...leadBase(l, p, rm.get(l.roomId) || null),
        feeAmount: l.feeAmount, feeStatus: l.feeStatus, feeDue: l.feeDue,
        unread: unread.get(l.id) || 0,
        noResponse: l.status === 'baru' && !l.respondedAt && Date.parse(l.createdAt) < slow,
        feeOverdue: ['belum', 'ditolak'].includes(l.feeStatus) && l.feeDue && l.feeDue < today,
        needsApproval: l.status === 'dp_diterima' && (['dikirim', 'bebas'].includes(l.feeStatus)),
        feeToReturn: l.refundStatus === 'selesai' && ['diterima', 'dikirim'].includes(l.feeStatus),
        ownerId: p.ownerId,
        ...(side === 'admin' ? { feeProof: !!l.feeProofPath, dpProof: !!l.dpProofPath } : {}),
      };
    });
  }
  function ownerRoomsOut(rooms: Row[], occ: Set<string>) {
    return rooms.map((r) => ({ ...r, effectiveStatus: occ.has(r.id) ? 'terisi' : r.status })).sort(byCode);
  }

  on('POST', '/pemilik/logout', async ({ req }: Row, log: (e: Row) => void) => { log({ action: 'owner.logout', summary: 'Keluar dari dashboard pemilik' }); return await logout('owner', req); });
  on('POST', '/pemilik/password', async ({ req, body: b, owner: o }: Row, log: (e: Row) => void) => {
    const out = await changePassword('owner', o, req, b);
    log({ action: 'owner.password', summary: o.mustChange ? 'Mengganti kata sandi bawaan' : 'Mengganti kata sandi' });
    return out;
  });
  on('PUT', '/pemilik/email', async ({ body: b, owner: o }: Row, log: (e: Row) => void) => {
    const out = await setEmail('owner', o, b);
    log({ action: 'owner.email', summary: out.email ? 'Mengatur email notifikasi' : 'Menghapus email notifikasi' });
    return out;
  });
  on('GET', '/pemilik/me', async ({ owner: o }: Row) => {
    const s = await setting();
    const base = { owner: pick(o, ['id', 'name', 'phone', 'email', 'username', 'mustChange', 'lastLoginAt']), bonaBankInfo: s.bonaBankInfo || '', feeDueDays: s.feeDueDays, dpHours: s.dpHours, leadResponseHours: s.leadResponseHours };
    if (o.mustChange) return { ...base, properties: [], rooms: [], leads: [], notifications: { items: [], unread: 0 } };
    const props = await ownerProps(o);
    const [rooms, occ, leads, n] = await Promise.all([roomsOf(props.map((p) => p.id)), activeRoomIds(), leadList(props, 'pemilik'), notifList('pemilik', o.id)]);
    return {
      ...base,
      properties: props.map((p) => ({ ...p, feeRule: (() => { const f = feeOf(p, s, 100); return feeText(f.type, f.value); })() })),
      rooms: ownerRoomsOut(rooms, occ), leads, notifications: n,
    };
  });
  on('PUT', '/pemilik/properties/:id', async ({ params, body: b, owner: o }: Row, log: (e: Row) => void) => {
    const p = await ownerProp(o, params.id);
    const patch = propertyPatch(b);
    const rec = await update('properties', p.id, patch);
    log({ action: 'owner.property', summary: `Mengubah info ${rec.name}`, target: rec.name });
    return rec;
  });
  on('POST', '/pemilik/properties/:id/submit', async ({ params, owner: o }: Row, log: (e: Row) => void) => {
    const p = await ownerProp(o, params.id);
    if (!['draf', 'nonaktif'].includes(p.status)) throw bad(p.status === 'aktif' ? 'Kos ini sudah tampil di website.' : 'Kos ini sedang dicek admin.');
    const rooms = (await roomsOf([p.id])).filter((r) => !r.hidden);
    const missing = [!p.address && 'alamat', !(p.photos || []).length && 'minimal 1 foto', !rooms.length && 'minimal 1 kamar', !p.bankInfo && 'rekening untuk DP', !p.whatsapp && p.waEnabled !== false && 'nomor WhatsApp'].filter(Boolean);
    if (missing.length) throw bad(`Lengkapi dulu: ${missing.join(', ')}.`);
    const rec = await update('properties', p.id, { status: 'menunggu', submittedAt: nowIso() });
    await notifyAdmin(null, 'partner', `${o.name} minta ${p.name} ditampilkan`, 'Cek data kosnya, lalu tekan “Tampilkan di website” di menu Mitra kos.');
    log({ action: 'owner.submit', summary: `Minta ${p.name} ditampilkan di website`, target: p.name });
    return rec;
  });
  on('POST', '/pemilik/properties/:id/checked', async ({ params, owner: o }: Row, log: (e: Row) => void) => {
    const p = await ownerProp(o, params.id);
    const rec = await update('properties', p.id, { checkedAt: nowIso() });
    log({ action: 'owner.checked', summary: `Memastikan status kamar ${p.name} sudah benar`, target: p.name, dedupeMinutes: 60 });
    return rec;
  });
  on('POST', '/pemilik/upload', async ({ req, owner: o }: Row, log: (e: Row) => void) => {
    const { buf, type, ext } = await readImage(req);
    const path = `mitra/${o.id}/${Date.now()}-${randomToken(6)}.${ext}`;
    await putFile('photos', path, buf, type);
    log({ action: 'owner.photo', summary: 'Mengunggah foto kos/kamar' });
    return created({ url: PHOTO_PREFIX + path });
  }, { raw: true });
  on('POST', '/pemilik/rooms', async ({ body, owner: o }: Row, log: (e: Row) => void) => {
    const r = roomFromBody(body);
    const p = await ownerProp(o, r.propertyId);
    if (!r.code) throw bad('Isi nomor/kode kamar.');
    const rec = await insert('rooms', { status: 'kosong', ...r, propertyId: p.id });
    await update('properties', p.id, { checkedAt: nowIso() });
    log({ action: 'owner.room_create', summary: `Menambah kamar ${rec.code} di ${p.name}`, target: rec.code });
    return created(rec);
  });
  on('PUT', '/pemilik/rooms/:id', async ({ params, body, owner: o }: Row, log: (e: Row) => void) => {
    const room = await one('rooms', str(params.id, 40)); if (!room) throw notFound('Kamar tidak ditemukan.');
    const p = await ownerProp(o, room.propertyId);
    const r = roomFromBody(body); delete r.propertyId;
    const rec = await update('rooms', room.id, r);
    await update('properties', p.id, { checkedAt: nowIso() });
    log({ action: 'owner.room_update', summary: Object.keys(r).length === 1 && r.status ? `Mengubah status kamar ${rec.code} menjadi ${rec.status}` : `Mengubah kamar ${rec.code}`, target: rec.code });
    return rec;
  });
  on('DELETE', '/pemilik/rooms/:id', async ({ params, owner: o }: Row, log: (e: Row) => void) => {
    const room = await one('rooms', str(params.id, 40)); if (!room) throw notFound('Kamar tidak ditemukan.');
    await ownerProp(o, room.propertyId);
    const used = await sb.from('leads').select('id', { count: 'exact', head: true }).eq('room_id', room.id).in('status', [...ACTIVE, 'berhasil']);
    if ((used.count ?? 0) > 0) throw bad('Kamar ini masih punya reservasi berjalan. Sembunyikan saja dari website.');
    await q(sb.from('rooms').delete().eq('id', room.id));
    log({ action: 'owner.room_delete', summary: `Menghapus kamar ${room.code}`, target: room.code });
    return { ok: true };
  });
  on('GET', '/pemilik/leads/:id', async ({ params, owner: o }: Row) => {
    await expireLeads();
    const { l } = await ownerLead(o, params.id);
    return await leadFull(l, 'pemilik');
  });
  on('GET', '/pemilik/leads/:id/wa', async ({ params, url, owner: o }: Row, log: (e: Row) => void) => {
    const { l, p } = await ownerLead(o, params.id);
    const out = await waMessage(l, p, str(url.searchParams.get('kind'), 20));
    log({ action: 'owner.wa', summary: `Menyiapkan pesan WhatsApp untuk ${l.name}`, dedupeMinutes: 5 });
    return out;
  });
  on('GET', '/pemilik/leads/:id/messages', async ({ params, url, owner: o }: Row) => {
    const { l } = await ownerLead(o, params.id);
    return await listMessages(l, Number(url.searchParams.get('after')) || 0, 'pemilik');
  });
  on('POST', '/pemilik/leads/:id/messages', async ({ params, body: b, owner: o }: Row) => {
    const { l, p } = await ownerLead(o, params.id);
    if (p.chatEnabled === false) throw bad('Chat kos ini sedang dimatikan. Nyalakan di menu Kos saya, atau hubungi lewat WhatsApp.');
    return pick(await postMessage(l, 'pemilik', b.body), ['id', 'sender', 'body', 'createdAt']);
  });
  on('POST', '/pemilik/leads/:id/fee-proof', async ({ req, params, owner: o }: Row, log: (e: Row) => void) => {
    const { l, p } = await ownerLead(o, params.id);
    if (!['dp_diterima', 'berhasil'].includes(l.status) || !['belum', 'ditolak'].includes(l.feeStatus)) throw bad('Fee untuk reservasi ini tidak sedang menunggu pembayaran.');
    const path = await storeProof(req, l, 'fee');
    await save(l, { feeStatus: 'dikirim', feeProofPath: path, feeUploadedAt: nowIso(), feeNote: '' });
    await notifyAdmin(l, 'approval', `Bukti fee ${rupiah(l.feeAmount)} dari ${o.name}`, `Booking ${l.name} di ${p.name} siap diperiksa dan disetujui.`);
    log({ action: 'owner.fee_proof', summary: `Mengunggah bukti fee ${rupiah(l.feeAmount)} untuk booking ${l.name}` });
    return { ok: true };
  }, { raw: true });
  on('POST', '/pemilik/leads/:id/refund-proof', async ({ req, url, params, owner: o }: Row, log: (e: Row) => void) => {
    const { l, p } = await ownerLead(o, params.id);
    await refundProof(req, url, l, p, 'pemilik');
    log({ action: 'owner.refund_proof', summary: `Mengunggah bukti refund untuk ${l.name}` });
    return { ok: true };
  }, { raw: true });
  async function refundProof(req: Request, url: URL, l: Row, p: Row, role: Role) {
    if (!['diminta', 'dilaporkan'].includes(l.refundStatus)) throw bad('Tidak ada refund yang perlu dikirim.');
    const amount = num(url.searchParams.get('amount')) || l.refundAmount || l.dpAmount || 0;
    const path = await storeProof(req, l, 'refund');
    await save(l, { refundStatus: 'dikirim', refundProofPath: path, refundSentAt: nowIso(), refundAmount: amount });
    await sysMsg(l, `${who(role)} sudah mentransfer refund ${rupiah(amount)}. Penyewa: periksa rekening lalu tekan “Sudah saya terima” di halaman reservasi.`);
    await notifyCustomer(l, 'refund', 'Refund sudah dikirim', `Periksa rekening Anda (${rupiah(amount)}) lalu tekan "Sudah saya terima".`);
    if (role !== 'admin' && isMitra(p)) await notifyAdmin(l, 'refund', `Refund ${l.name} dikirim pemilik`, rupiah(amount));
  }
  on('POST', '/pemilik/leads/:id/:action', async ({ params, body: b, owner: o }: Row, log: (e: Row) => void) => {
    const fn = ACTIONS[params.action];
    if (!fn || ['approve', 'fee-reject', 'refund-done', 'refund-reopen', 'fee-returned'].includes(params.action)) throw notFound('Aksi tidak dikenal.');
    const { l, p } = await ownerLead(o, params.id);
    const summary = await fn(l, p, b, 'pemilik');
    log({ action: `owner.lead_${params.action}`, summary, target: p.name });
    return await leadFull(l, 'pemilik');
  });
  on('GET', '/pemilik/leads/:id/booking.pdf', async ({ params, owner: o }: Row) => {
    const { l } = await ownerLead(o, params.id);
    return pdfOut(await bookingDoc(l), `bukti-booking-${fileSafe(l.invoiceNo || l.code)}.pdf`);
  });
  on('GET', '/pemilik/leads/:id/fee.pdf', async ({ params, owner: o }: Row) => {
    const { l } = await ownerLead(o, params.id);
    return pdfOut(await feeDoc(l), `invoice-fee-${fileSafe(l.feeInvoiceNo || l.code)}.pdf`);
  });
  on('GET', '/pemilik/notifications', async ({ owner: o }: Row) => notifList('pemilik', o.id));
  on('POST', '/pemilik/notifications/read', async ({ body: b, owner: o }: Row) => notifRead('pemilik', o.id, b));

  // ================================================================ ADMIN — Kos Sekitar
  const USER_RE = /^[a-z0-9._-]{3,32}$/;
  function ownerOut(o: Row) { return pick(o, ['id', 'name', 'phone', 'email', 'username', 'mustChange', 'status', 'note', 'lastLoginAt', 'passwordSetAt', 'createdAt']); }
  async function usernameTaken(u: string, exceptOwner?: string) {
    const [o, l, t] = await Promise.all([
      q(sb.from('owners').select('id').ilike('username', u).maybeSingle()), q(sb.from('leads').select('id').ilike('username', u).maybeSingle()), q(sb.from('tenants').select('id').eq('username', u).maybeSingle()),
    ]) as (Row | null)[];
    return (o && o.id !== exceptOwner) || l || t;
  }
  on('GET', '/admin/owners', async () => {
    const [owners, props] = await Promise.all([q(sb.from('owners').select('*').order('created_at')), q(sb.from('properties').select('id, name, owner_id, status'))]);
    return ((owners as Row[]) || []).map((o) => ({ ...ownerOut(toCamel(o)), properties: ((props as Row[]) || []).filter((p) => p.owner_id === o.id).map((p) => ({ id: p.id, name: p.name, status: p.status })) }));
  });
  on('POST', '/admin/owners', async ({ body: b }: Row, log: (e: Row) => void) => {
    const name = str(b.name, 100); if (!name) throw bad('Isi nama pemilik kos.');
    const username = str(b.username, 40).toLowerCase();
    if (!USER_RE.test(username)) throw bad('Username 3–32 karakter: huruf kecil, angka, titik, minus, atau garis bawah.');
    if (await usernameTaken(username)) throw bad(`Username "${username}" sudah dipakai.`);
    const password = String(b.password || '') || ownerPassword();
    if (password.length < 8) throw bad('Kata sandi minimal 8 karakter.');
    const rec = await insert('owners', { name, phone: str(b.phone, 20), email: emailField(b.email), note: str(b.note, 600), username, passwordHash: await bcrypt.hash(password, 10), mustChange: true });
    log({ action: 'owner.create', summary: `Membuat akun pemilik kos ${name} (${username})` });
    return created({ ...ownerOut(rec), password });
  });
  on('PUT', '/admin/owners/:id', async ({ params, body: b }: Row, log: (e: Row) => void) => {
    const cur = await one('owners', str(params.id, 40)); if (!cur) throw notFound('Pemilik tidak ditemukan.');
    const patch: Row = {};
    for (const [k, m] of [['name', 100], ['phone', 20], ['note', 600]] as const) if (b[k] !== undefined) patch[k] = str(b[k], m);
    if (b.email !== undefined) patch.email = emailField(b.email);
    if (patch.name === '') throw bad('Isi nama pemilik kos.');
    if (b.status !== undefined) patch.status = b.status === 'nonaktif' ? 'nonaktif' : 'aktif';
    if (b.username !== undefined) {
      const u = str(b.username, 40).toLowerCase();
      if (!USER_RE.test(u)) throw bad('Username 3–32 karakter: huruf kecil, angka, titik, minus, atau garis bawah.');
      if (await usernameTaken(u, cur.id)) throw bad(`Username "${u}" sudah dipakai.`);
      patch.username = u;
    }
    const rec = await update('owners', cur.id, patch);
    if (patch.status === 'nonaktif') { await q(sb.from('owner_sessions').delete().eq('owner_id', cur.id)); clearCaches(); }
    log({ action: 'owner.update', summary: `Mengubah akun pemilik ${rec.name}${patch.status === 'nonaktif' ? ' (dinonaktifkan)' : ''}` });
    return ownerOut(rec);
  });
  on('POST', '/admin/owners/:id/reset', async ({ params }: Row, log: (e: Row) => void) => {
    const cur = await one('owners', str(params.id, 40)); if (!cur) throw notFound('Pemilik tidak ditemukan.');
    const password = ownerPassword();
    await update('owners', cur.id, { passwordHash: await bcrypt.hash(password, 10), mustChange: true });
    await q(sb.from('owner_sessions').delete().eq('owner_id', cur.id)); clearCaches();
    log({ action: 'owner.reset', summary: `Mengatur ulang kata sandi pemilik ${cur.name}` });
    return { ...ownerOut(cur), password, mustChange: true };
  });
  on('DELETE', '/admin/owners/:id', async ({ params }: Row, log: (e: Row) => void) => {
    const cur = await one('owners', str(params.id, 40)); if (!cur) throw notFound('Pemilik tidak ditemukan.');
    const used = await sb.from('properties').select('id', { count: 'exact', head: true }).eq('owner_id', cur.id);
    if ((used.count ?? 0) > 0) throw bad('Pemilik ini masih punya kos. Nonaktifkan akunnya saja, atau pindahkan kosnya dulu.');
    await q(sb.from('owners').delete().eq('id', cur.id));
    log({ action: 'owner.delete', summary: `Menghapus akun pemilik ${cur.name}` });
    return { ok: true };
  });
  on('GET', '/admin/partners', async () => {
    const s = await setting();
    const [props, owners] = await Promise.all([
      pages((from: number, to: number) => sb.from('properties').select('*').eq('kind', 'mitra').order('id').range(from, to)) as Promise<Row[]>,
      pages((from: number, to: number) => sb.from('owners').select('id, name, phone, username, status').order('id').range(from, to)) as Promise<Row[]>,
    ]);
    const list = ((props as Row[]) || []).map((p) => toCamel(p)) as Row[];
    const [rooms, occ, leads] = await Promise.all([roomsOf(list.map((p) => p.id)), activeRoomIds(), list.length ? rowsIn('leads', 'property_id', list.map((p) => p.id), 'property_id, status, fee_amount, fee_status') : []]);
    const om = new Map(((owners as Row[]) || []).map((o) => [o.id, o]));
    return list.sort(bySort).map((p) => {
      const rs = rooms.filter((r) => r.propertyId === p.id); const ls = ((leads as Row[]) || []).filter((l) => l.property_id === p.id);
      const f = feeOf(p, s, 100);
      return {
        ...p, owner: om.get(p.ownerId) || null, totalRooms: rs.length, freeRooms: rs.filter((r) => !occ.has(r.id) && r.status === 'kosong' && !r.hidden).length,
        leadsTotal: ls.length, leadsActive: ls.filter((l) => ACTIVE.includes(l.status)).length, bookings: ls.filter((l) => l.status === 'berhasil').length,
        feeReceived: ls.filter((l) => l.fee_status === 'diterima').reduce((a, l) => a + (l.fee_amount || 0), 0),
        feeOpen: ls.filter((l) => ['belum', 'dikirim', 'ditolak'].includes(l.fee_status)).reduce((a, l) => a + (l.fee_amount || 0), 0),
        feeRule: `${feeText(f.type, f.value)}${p.feeType ? '' : ' (bawaan)'}`,
      };
    });
  });
  on('GET', '/admin/leads', async () => {
    const props = await all('properties') as Row[];
    const owners = ((await q(sb.from('owners').select('id, name'))) as Row[]) || [];
    const om = new Map(owners.map((o) => [o.id, o.name]));
    return (await leadList(props, 'admin')).map((l: Row) => ({ ...l, ownerName: l.ownerId ? om.get(l.ownerId) || '-' : 'Bonaasina' }));
  });
  on('GET', '/admin/leads/:id', async ({ params }: Row) => {
    await expireLeads();
    const l = await one('leads', str(params.id, 40)); if (!l) throw notFound('Reservasi tidak ditemukan.');
    return await leadFull(l, 'admin');
  });
  on('GET', '/admin/leads/:id/wa', async ({ params, url }: Row) => {
    const l = await one('leads', str(params.id, 40)); if (!l) throw notFound('Reservasi tidak ditemukan.');
    return await waMessage(l, await one('properties', l.propertyId), str(url.searchParams.get('kind'), 20));
  });
  on('GET', '/admin/leads/:id/messages', async ({ params, url }: Row) => {
    const l = await one('leads', str(params.id, 40)); if (!l) throw notFound('Reservasi tidak ditemukan.');
    return await listMessages(l, Number(url.searchParams.get('after')) || 0, 'admin');
  });
  on('POST', '/admin/leads/:id/messages', async ({ params, body: b }: Row, log: (e: Row) => void) => {
    const l = await one('leads', str(params.id, 40)); if (!l) throw notFound('Reservasi tidak ditemukan.');
    const m = await postMessage(l, 'admin', b.body);
    log({ action: 'lead.message', summary: `Mengirim pesan di reservasi ${l.name}`, dedupeMinutes: 10 });
    return pick(m, ['id', 'sender', 'body', 'createdAt']);
  });
  on('POST', '/admin/leads/:id/refund-proof', async ({ req, url, params }: Row, log: (e: Row) => void) => {
    const l = await one('leads', str(params.id, 40)); if (!l) throw notFound('Reservasi tidak ditemukan.');
    await refundProof(req, url, l, await one('properties', l.propertyId), 'admin');
    log({ action: 'lead.refund_proof', summary: `Mengunggah bukti refund untuk ${l.name}` });
    return { ok: true };
  }, { raw: true });
  on('POST', '/admin/leads/:id/:action', async ({ params, body: b, adminEmail }: Row, log: (e: Row) => void) => {
    const fn = ACTIONS[params.action]; if (!fn) throw notFound('Aksi tidak dikenal.');
    const l = await one('leads', str(params.id, 40)); if (!l) throw notFound('Reservasi tidak ditemukan.');
    const p = await one('properties', l.propertyId);
    const summary = await fn(l, p, { ...b, adminEmail }, 'admin');
    log({ action: `lead.${params.action}`, summary, target: p?.name });
    return await leadFull(l, 'admin');
  });
  on('GET', '/admin/leads/:id/booking.pdf', async ({ params }: Row) => {
    const l = await one('leads', str(params.id, 40)); if (!l) throw notFound('Reservasi tidak ditemukan.');
    return pdfOut(await bookingDoc(l), `bukti-booking-${fileSafe(l.invoiceNo || l.code)}.pdf`);
  });
  on('GET', '/admin/leads/:id/fee.pdf', async ({ params }: Row) => {
    const l = await one('leads', str(params.id, 40)); if (!l) throw notFound('Reservasi tidak ditemukan.');
    return pdfOut(await feeDoc(l), `invoice-fee-${fileSafe(l.feeInvoiceNo || l.code)}.pdf`);
  });
  on('GET', '/admin/notifications', async () => notifList('admin', null));
  on('POST', '/admin/notifications/read', async ({ body: b }: Row) => notifRead('admin', null, b));

  // ================================================================ PENDAFTARAN MITRA (/mitra/)
  const GENDERS = ['Putra', 'Putri', 'Campur', 'Pasutri'];
  on('POST', '/mitra/daftar', async ({ req, body: b }: Row, log: (e: Row) => void) => {
    if (b.website) return { ok: true }; // honeypot
    const name = str(b.name, 80), phone = str(b.phone, 20), kosName = str(b.kosName, 80).replace(/^kos\s+/i, ''), email = emailField(b.email);
    if (!name) throw bad('Isi nama Anda.');
    if (normalizePhone(phone).length < 10) throw bad('Nomor WhatsApp belum benar. Contoh: 0812 3456 7890.');
    if (!kosName) throw bad('Isi nama kos Anda.');
    const city = str(b.city, 80);
    if (!city) throw bad('Isi kota atau daerah kos Anda.');
    const periods = (Array.isArray(b.periods) ? b.periods : []).filter((x: string) => CYCLES.includes(x));
    const { ip } = clientInfo(req);
    const dayAgo = new Date(Date.now() - DAY).toISOString(), hourAgo = new Date(Date.now() - 3600e3).toISOString();
    const [byPhone, byIp] = await Promise.all([
      sb.from('partner_applications').select('id', { count: 'exact', head: true }).eq('phone', phone).gte('created_at', dayAgo),
      sb.from('partner_applications').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', hourAgo),
    ]);
    if ((byPhone.count ?? 0) >= 2 || (ip && (byIp.count ?? 0) >= 5)) throw new HttpError(429, 'Pendaftaran dari nomor ini sudah kami terima. Admin akan menghubungi Anda lewat WhatsApp.');
    const rooms = Math.round(Number(b.roomCount) || 0);
    const rec = toCamel(await q(sb.from('partner_applications').insert({
      name, phone, email, kos_name: `Kos ${kosName}`, city, address: str(b.address, 300), gender: GENDERS.includes(b.gender) ? b.gender : 'Campur',
      room_count: rooms >= 1 && rooms <= 500 ? rooms : null, periods: periods.length ? CYCLES.filter((c: string) => periods.includes(c)) : ['bulanan'],
      price_from: num(b.priceFrom) || null, note: str(b.note, 600), ip,
    }).select().single()));
    await notifyAdmin(null, 'mitra', `Pendaftaran mitra baru: ${rec.kosName}`, `${name} (${phone}), ${city}${rooms ? `, ${rooms} kamar` : ''}. Periksa di menu Pendaftaran mitra.`);
    mail.send({
      to: email, kind: 'partner.received', dedupeKey: `partner.received:${rec.id}`, subject: `Pendaftaran mitra ${rec.kosName} kami terima`,
      title: 'Pendaftaran mitra sudah kami terima', intro: `Horas ${name}, terima kasih sudah mendaftarkan ${rec.kosName} di Kos Sekitar Bonaasina. Admin akan meninjau dan menghubungi Anda lewat WhatsApp.`,
      rows: [['Kos', rec.kosName], ['Kota', city], ['Jumlah kamar', rooms ? String(rooms) : '']],
    });
    log({ action: 'partner.apply', summary: `Mendaftar sebagai mitra: ${rec.kosName}, ${city}`, meta: { name } });
    return created({ ok: true });
  });
  on('GET', '/admin/applications', async () => ((await q(sb.from('partner_applications').select('*').order('created_at', { ascending: false }).limit(300))) as Row[] || []).map((r) => toCamel(r)));
  const slugUser = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^kos\s+/, '').replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'mitra';
  function accountMessage(o: Row, kosName: string, password: string) {
    return `Horas ${o.name}, selamat bergabung sebagai mitra Kos Sekitar Bonaasina! 🎉\n\n` +
      `Akun untuk ${kosName} sudah siap:\nAlamat: ${site()}/pemilik/\nUsername: ${o.username}\nKata sandi sementara: ${password}\n\n` +
      `Langkah berikutnya:\n1. Masuk, lalu buat kata sandi Anda sendiri.\n2. Lengkapi info kos, foto, kamar & harga, rekening, dan nomor WhatsApp.\n3. Tekan "Minta ditampilkan di website". Setelah kami cek, kos Anda tampil dan siap dipesan.\n\n` +
      `Ada pertanyaan? Balas pesan ini saja. Terima kasih 🙏`;
  }
  on('POST', '/admin/applications/:id/approve', async ({ params, body: b }: Row, log: (e: Row) => void) => {
    const a = toCamel(await q(sb.from('partner_applications').select('*').eq('id', str(params.id, 60)).maybeSingle()));
    if (!a) throw notFound('Pendaftaran tidak ditemukan.');
    if (a.status === 'disetujui') throw bad('Pendaftaran ini sudah disetujui.');
    let username = str(b.username, 40).toLowerCase() || slugUser(a.kosName);
    if (!USER_RE.test(username)) throw bad('Username 3–32 karakter: huruf kecil, angka, titik, minus, atau garis bawah.');
    if (!b.username) { const base = username; for (let i = 2; await usernameTaken(username); i++) username = `${base}${i}`; }
    else if (await usernameTaken(username)) throw bad(`Username "${username}" sudah dipakai.`);
    const password = ownerPassword();
    const owner = await insert('owners', { name: a.name, phone: a.phone, email: a.email || '', username, passwordHash: await bcrypt.hash(password, 10), mustChange: true, note: `Dari pendaftaran ${a.kosName}` });
    const feeType = ['persen', 'nominal'].includes(b.feeType) ? b.feeType : null;
    const prop = await createProperty('mitra', {
      name: a.kosName, ownerId: owner.id, city: a.city, address: a.address, gender: a.gender, periods: a.periods?.length ? a.periods : ['bulanan'], whatsapp: a.phone,
      feeType, feeValue: feeType ? Math.max(0, Number(b.feeValue) || 0) : null,
    });
    await q(sb.from('partner_applications').update({ status: 'disetujui', owner_id: owner.id, property_id: prop.id, decided_at: nowIso(), admin_note: str(b.note, 300) }).eq('id', a.id));
    const text = accountMessage(owner, a.kosName, password);
    // Kata sandi sementara tidak dikirim lewat email; tetap lewat WhatsApp dari admin.
    mail.send({
      to: a.email, kind: 'partner.approved', dedupeKey: `partner.approved:${a.id}`, subject: `Selamat, ${a.kosName} diterima sebagai mitra Bonaasina`,
      title: 'Pendaftaran mitra disetujui', intro: `Horas ${a.name}, akun pemilik untuk ${a.kosName} sudah siap.`,
      rows: [['Username', username], ['Kata sandi sementara', 'dikirim admin lewat WhatsApp']],
      note: 'Langkah berikutnya: masuk, buat kata sandi sendiri, lengkapi info kos, foto, kamar & harga, rekening, lalu tekan "Minta ditampilkan di website".',
      cta: { label: 'Masuk ke dashboard pemilik', url: `${site()}/pemilik/` },
    });
    log({ action: 'partner.approve', summary: `Menyetujui mitra ${a.kosName} dan membuat akun ${username}` });
    return { owner: ownerOut(owner), password, property: pick(prop, ['id', 'name', 'slug']), text, url: waLink(a.phone, text) };
  });
  on('POST', '/admin/applications/:id/reject', async ({ params, body: b }: Row, log: (e: Row) => void) => {
    const a = toCamel(await q(sb.from('partner_applications').select('*').eq('id', str(params.id, 60)).maybeSingle()));
    if (!a) throw notFound('Pendaftaran tidak ditemukan.');
    if (a.status === 'disetujui') throw bad('Pendaftaran ini sudah disetujui.');
    const note = str(b.note, 300);
    await q(sb.from('partner_applications').update({ status: 'ditolak', admin_note: note, decided_at: nowIso() }).eq('id', a.id));
    const text = `Horas ${a.name}, terima kasih sudah mendaftarkan ${a.kosName} sebagai mitra Bonaasina.\n\nMohon maaf, untuk saat ini kami belum bisa menerimanya${note ? `: ${note}` : '.'}\n\nSilakan hubungi kami bila ada pertanyaan.`;
    mail.send({ to: a.email, kind: 'partner.rejected', dedupeKey: `partner.rejected:${a.id}`, subject: `Pendaftaran mitra ${a.kosName}`, title: 'Pendaftaran mitra belum bisa diterima', intro: text.replace(/^Horas [^,]+, /, `Horas ${a.name}, `) });
    log({ action: 'partner.reject', summary: `Menolak pendaftaran mitra ${a.kosName}` });
    return { text, url: waLink(a.phone, text) };
  });
  on('POST', '/admin/applications/:id/resend', async ({ params }: Row, log: (e: Row) => void) => {
    // Kirim ulang akun: kata sandi sementara baru (kata sandi lama tidak bisa dibaca).
    const a = toCamel(await q(sb.from('partner_applications').select('*').eq('id', str(params.id, 60)).maybeSingle()));
    if (!a?.ownerId) throw bad('Pendaftaran ini belum disetujui.');
    const o = await one('owners', a.ownerId); if (!o) throw notFound('Akun pemilik sudah dihapus.');
    const password = ownerPassword();
    await update('owners', o.id, { passwordHash: await bcrypt.hash(password, 10), mustChange: true });
    await q(sb.from('owner_sessions').delete().eq('owner_id', o.id)); clearCaches();
    const text = accountMessage(o, a.kosName, password);
    log({ action: 'partner.resend', summary: `Membuat kata sandi sementara baru untuk ${o.name}` });
    return { text, url: waLink(o.phone || a.phone, text), password };
  });

  // Angka untuk lencana menu admin.
  async function adminCounts() {
    await expireLeads();
    const s = await setting();
    const slow = new Date(Date.now() - (s.leadResponseHours || 24) * 3600e3).toISOString();
    const c = (f: (x: any) => any) => f(sb.from('leads').select('id', { count: 'exact', head: true })).then((r: any) => r.count ?? 0);
    const applications = await sb.from('partner_applications').select('id', { count: 'exact', head: true }).eq('status', 'baru').then((r: any) => r.count ?? 0);
    const [leadsNew, noResponse, approvals, refunds, feeOverdue, partnersPending, notifUnread, feeToReturn] = await Promise.all([
      c((x) => x.eq('status', 'baru')), c((x) => x.eq('status', 'baru').is('responded_at', null).lt('created_at', slow)),
      c((x) => x.eq('status', 'dp_diterima').in('fee_status', ['dikirim', 'bebas'])), c((x) => x.in('refund_status', ['diminta', 'dilaporkan', 'ditolak'])),
      c((x) => x.in('fee_status', ['belum', 'ditolak']).lt('fee_due', todayStr())),
      sb.from('properties').select('id', { count: 'exact', head: true }).eq('status', 'menunggu').then((r: any) => r.count ?? 0),
      sb.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_type', 'admin').is('read_at', null).then((r: any) => r.count ?? 0),
      c((x) => x.eq('refund_status', 'selesai').in('fee_status', ['diterima', 'dikirim'])),
    ]);
    return { leadsNew, noResponse, approvals, refunds, feeOverdue, partnersPending, notifUnread, feeToReturn, applications };
  }
  async function propertyStatusChanged(p: Row, before: string) {
    if (!p.ownerId) return;
    const text: Record<string, string> = { aktif: 'sudah tampil di Kos Sekitar Bonaasina', nonaktif: 'disembunyikan dari website', draf: 'perlu dilengkapi dulu', menunggu: 'sedang dicek admin' };
    await notify('pemilik', p.ownerId, null, 'partner', `${p.name} ${text[p.status] || p.status}`, p.reviewNote || (before === 'menunggu' && p.status === 'aktif' ? 'Calon penyewa sekarang bisa melihat dan memesan kos Anda.' : ''));
  }

  return { requireOwner, requireLead, marketDefaults, marketTemplates, verifyBooking, adminCounts, propertyStatusChanged, periodText, LEAD_STATUS };
}
