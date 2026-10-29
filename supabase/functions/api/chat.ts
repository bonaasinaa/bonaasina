// Live chat website tanpa akun; token acak di header X-Chat-Session, hanya hash SHA-256 yang disimpan.
// Pembaruan lewat polling ke fungsi api, jadi sesuai CSP. Pengaturan ada di settings.data.liveChat.
import { ADMIN_TOPIC, DEFAULT_KAMUS, PLACEHOLDERS, botReply, menuOptions, sanitizeKamus, type BotData, type KamusEntry } from './chatbot.ts';
type Row = Record<string, any>;

export const CHAT_DEFAULTS = {
  enabled: true, // menerima pesan baru dari pengunjung
  visible: true, // tombol chat tampil di website
  botEnabled: true, // bot sambutan & jawaban otomatis
  days: [0, 1, 2, 3, 4, 5, 6], // 0 = Minggu (WIB)
  opens: '09:00',
  closes: '18:00',
  greeting: 'Horas! Saya asisten otomatis Bonaasina. Mau info apa? Pilih topik di bawah atau tulis pertanyaan Anda.',
  offlineText: 'Pesan Anda sudah kami terima. Admin akan membalas di jam layanan. Buka lagi chat ini nanti dari perangkat yang sama untuk melihat balasan.',
};
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const isHm = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
// Bot tidak ikut menjawab bila admin membalas dalam 30 menit terakhir (sedang dilayani langsung).
const BOT_QUIET_MS = 30 * 60e3;

// Jam layanan dalam WIB. Jam tutup ≤ jam buka berarti melewati tengah malam (mis. 20:00–02:00).
export function chatOnline(c: Row, now = Date.now()) {
  const d = new Date(now + 7 * 3600e3);
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  const day = d.getUTCDay(), prev = (day + 6) % 7;
  const days: number[] = c.days || [];
  if (c.opens === c.closes) return days.includes(day);
  if (c.opens < c.closes) return days.includes(day) && hm >= c.opens && hm < c.closes;
  return (days.includes(day) && hm >= c.opens) || (days.includes(prev) && hm < c.closes);
}
export function chatHoursText(c: Row) {
  const days = [...new Set((c.days || []) as number[])].sort();
  if (!days.length) return 'belum ada jam layanan';
  const order = [1, 2, 3, 4, 5, 6, 0].filter((x) => days.includes(x));
  let label = order.map((x) => HARI[x]).join(', ');
  if (days.length === 7) label = 'Setiap hari';
  else if (order.join() === '1,2,3,4,5') label = 'Senin–Jumat';
  else if (order.join() === '1,2,3,4,5,6') label = 'Senin–Sabtu';
  const jam = c.opens === c.closes ? '24 jam' : `${c.opens.replace(':', '.')}–${c.closes.replace(':', '.')} WIB`;
  return `${label}, ${jam}`;
}

export function createChat(H: Record<string, any>) {
  const { sb, q, str, toCamel, pick, bad, notFound, HttpError, on, created, sha256, randomToken, clientInfo, getSettings, normalizePhone, SITE_URL, mail } = H;
  // Email ke admin (mailer.ts): percakapan baru, dan pesan pengunjung pertama setelah semua pesan dibaca
  // (bukan setiap pesan, supaya kotak masuk email tidak banjir).
  const mailAdmin = (t: Row, kind: 'chat.new' | 'chat.message', text: string, key: string) => mail?.sendAdmin({
    kind, dedupeKey: key,
    subject: kind === 'chat.new' ? `Live chat baru dari ${t.name}` : `Pesan live chat dari ${t.name}`,
    title: kind === 'chat.new' ? `${t.name} memulai live chat` : `${t.name} mengirim pesan`,
    rows: [['Pesan', text.slice(0, 500)], ['Kontak', t.contact || ''], ['Halaman', t.page || '']],
    note: 'Balas dari dashboard admin supaya muncul di jendela chat pengunjung.',
    cta: { label: 'Balas di dashboard', url: `${SITE_URL}/admin/#chat?id=${t.id}` },
  });

  async function chatSettings(): Promise<Row> {
    const s = await getSettings();
    return { ...CHAT_DEFAULTS, ...(s.liveChat || {}), whatsapp: normalizePhone(s.whatsapp || ''), site: s };
  }
  const kamusOf = (c: Row): KamusEntry[] => (Array.isArray(c.kamus) && c.kamus.length ? c.kamus : DEFAULT_KAMUS);
  const publicConfig = (c: Row) => ({
    enabled: !!c.enabled, visible: !!c.visible, online: !!c.enabled && chatOnline(c), hoursText: chatHoursText(c),
    greeting: c.greeting, whatsapp: c.whatsapp, botEnabled: !!c.botEnabled,
    menu: c.botEnabled ? menuOptions(kamusOf(c)) : [],
  });

  // Data kos & kamar untuk jawaban bot (sama dengan halaman publik). Disimpan 60 detik per instance.
  let botCache: { at: number; d: Omit<BotData, 'hoursText' | 'whatsapp' | 'site'> } | null = null;
  async function botData(c: Row): Promise<BotData> {
    if (!botCache || Date.now() - botCache.at > 60e3) {
      const [props, rooms, active] = await Promise.all([
        q(sb.from('properties').select('*')), q(sb.from('rooms').select('*')), q(sb.from('tenants').select('room_id').eq('status', 'aktif')),
      ]);
      const own: Row[] = ((props as Row[]) || []).map((x) => toCamel(x) as Row).filter((p: Row) => p.kind !== 'mitra' && p.status === 'aktif').sort((a: Row, b: Row) => (a.sort ?? 0) - (b.sort ?? 0));
      const ids = new Set(own.map((p: Row) => p.id));
      const occ = new Set(((active as Row[]) || []).map((t) => t.room_id));
      const rs: Row[] = ((rooms as Row[]) || []).map((x) => toCamel(x) as Row).filter((r: Row) => !r.hidden && ids.has(r.propertyId))
        .map((r: Row) => ({ ...r, status: occ.has(r.id) ? 'terisi' : r.status })).sort((a: Row, b: Row) => String(a.code).localeCompare(String(b.code), 'id', { numeric: true }));
      botCache = { at: Date.now(), d: { properties: own, rooms: rs, siteUrl: SITE_URL } };
    }
    return { ...botCache!.d, site: c.site, hoursText: chatHoursText(c), whatsapp: c.whatsapp };
  }

  const THREAD_PUBLIC = ['id', 'name', 'status', 'unreadVisitor', 'createdAt'];
  const THREAD_ADMIN = ['id', 'name', 'contact', 'page', 'status', 'lastMessageAt', 'lastSender', 'lastPreview', 'unreadAdmin', 'unreadVisitor', 'adminNote', 'ip', 'userAgent', 'createdAt'];
  const msgOut = (m: Row) => { const x = toCamel(m); return { ...pick(x, ['id', 'sender', 'body', 'createdAt']), ...(x.options?.length ? { options: x.options } : {}) }; };

  async function visitorThread(req: Request): Promise<Row | null> {
    const token = req.headers.get('x-chat-session') || '';
    if (token.length < 20 || token.length > 200) return null;
    return toCamel(await q(sb.from('chat_threads').select('*').eq('visitor_hash', await sha256(token)).maybeSingle()));
  }
  async function getThread(id: string) {
    const t = toCamel(await q(sb.from('chat_threads').select('*').eq('id', id).maybeSingle()));
    if (!t) throw notFound('Percakapan tidak ditemukan.');
    return t;
  }
  const listAfter = async (threadId: string, after: number) =>
    ((await q(sb.from('chat_messages').select('*').eq('thread_id', threadId).gt('id', after).order('id', { ascending: true }).limit(300))) as Row[]) || [];

  // Tambah pesan, lalu hitung ulang ringkasan percakapan (pratinjau & jumlah belum dibaca tiap sisi).
  // seen: jawaban bot/sistem yang muncul langsung di layar pengunjung tidak dihitung "belum dibaca".
  type Sender = 'pengunjung' | 'admin' | 'bot' | 'sistem';
  async function addMessage(t: Row, sender: Sender, body: string, opt: { adminEmail?: string; options?: Row[]; seen?: boolean } = {}) {
    const text = str(body, sender === 'bot' ? 1900 : 1000);
    if (!text) throw bad('Tulis pesannya dulu.');
    if (sender === 'pengunjung' || sender === 'admin') {
      const since = new Date(Date.now() - 60e3).toISOString();
      const { count } = await sb.from('chat_messages').select('id', { count: 'exact', head: true }).eq('thread_id', t.id).eq('sender', sender).gte('created_at', since);
      if ((count ?? 0) >= (sender === 'pengunjung' ? 12 : 30)) throw new HttpError(429, 'Terlalu banyak pesan dalam satu menit. Tunggu sebentar.');
    }
    const m = await q(sb.from('chat_messages').insert({ thread_id: t.id, sender, body: text, admin_email: opt.adminEmail ?? null, options: opt.options?.length ? opt.options : null }).select().single()) as Row;
    const patch: Row = { last_message_at: m.created_at, last_sender: sender, last_preview: text.slice(0, 140) };
    if (sender === 'pengunjung' || opt.seen) { patch.visitor_read_id = m.id; patch.unread_visitor = 0; }
    if (sender === 'pengunjung') patch.status = 'terbuka';
    if (sender === 'admin') { patch.admin_read_id = m.id; patch.unread_admin = 0; patch.last_admin_at = m.created_at; }
    const adminRead = patch.admin_read_id ?? t.adminReadId ?? 0, visitorRead = patch.visitor_read_id ?? t.visitorReadId ?? 0;
    const [ua, uv] = await Promise.all([
      sender === 'pengunjung' ? sb.from('chat_messages').select('id', { count: 'exact', head: true }).eq('thread_id', t.id).eq('sender', 'pengunjung').gt('id', adminRead) : null,
      sender !== 'pengunjung' && !opt.seen ? sb.from('chat_messages').select('id', { count: 'exact', head: true }).eq('thread_id', t.id).neq('sender', 'pengunjung').gt('id', visitorRead) : null,
    ]);
    if (ua) patch.unread_admin = ua.count ?? 0;
    if (sender === 'pengunjung' && !t.isNew && !(t.unreadAdmin > 0)) mailAdmin(t, 'chat.message', text, `chat:${t.id}:${m.id}`);
    if (uv) patch.unread_visitor = uv.count ?? 0;
    await q(sb.from('chat_threads').update(patch).eq('id', t.id));
    Object.assign(t, toCamel(patch));
    return msgOut(m);
  }

  // Pertanyaan pengunjung (teks bebas atau topik dari tombol) → pesan pengunjung + jawaban bot.
  async function askInThread(t: Row, c: Row, input: { text?: string; topic?: string }, forceBot: boolean) {
    const kamus = kamusOf(c);
    const label = input.topic ? (kamus.find((e) => e.id === input.topic)?.label || '') : '';
    const out = [await addMessage(t, 'pengunjung', input.text || label)];
    const adminActive = t.lastAdminAt && Date.now() - new Date(t.lastAdminAt).getTime() < BOT_QUIET_MS;
    if (!c.botEnabled || (adminActive && !forceBot)) return out;
    const r = botReply(input, kamus, await botData(c));
    // Teks bebas hanya dijawab bot bila cukup yakin; selebihnya menunggu admin.
    if (input.topic || r.score >= 2) {
      if (r.handoff && !chatOnline(c)) r.text += `\n${c.offlineText}`;
      out.push(await addMessage(t, 'bot', r.text, { options: r.options, seen: true }));
    }
    return out;
  }

  // Pengunjung
  on('GET', '/chat/config', async () => publicConfig(await chatSettings()));

  // Bot sebelum terhubung ke admin: tanpa menyimpan apa pun (belum ada percakapan).
  const askHits = new Map<string, number[]>();
  on('POST', '/chat/ask', async ({ req, body: b }: Row) => {
    const c = await chatSettings();
    if (!c.botEnabled) throw new HttpError(403, 'Bot sedang tidak aktif.');
    const { ip } = clientInfo(req);
    const now = Date.now(), list = (askHits.get(ip || 'x') || []).filter((x) => now - x < 600e3);
    if (list.length >= 60) throw new HttpError(429, 'Terlalu banyak pertanyaan. Tunggu sebentar.');
    list.push(now); askHits.set(ip || 'x', list); if (askHits.size > 5000) askHits.clear();
    const text = str(b.text, 500), topic = str(b.topic, 30);
    if (!text && !topic) throw bad('Tulis pertanyaan Anda.');
    const r = botReply({ text, topic }, kamusOf(c), await botData(c));
    return { ...r, online: chatOnline(c) };
  });

  // Riwayat & pesan baru. ?after=<id terakhir>, ?read=1 bila panel chat sedang terbuka.
  on('GET', '/chat', async ({ req, url }: Row) => {
    const [c, t] = await Promise.all([chatSettings(), visitorThread(req)]);
    if (!t) return { config: publicConfig(c), thread: null, messages: [] };
    const rows = await listAfter(t.id, Number(url.searchParams.get('after')) || 0);
    if (url.searchParams.get('read') === '1' && t.unreadVisitor > 0) {
      const mark: Row = { unread_visitor: 0 };
      if (rows.length) mark.visitor_read_id = Math.max(rows[rows.length - 1].id, t.visitorReadId || 0);
      else {
        const lastRow = await q(sb.from('chat_messages').select('id').eq('thread_id', t.id).order('id', { ascending: false }).limit(1).maybeSingle()) as Row | null;
        if (lastRow) mark.visitor_read_id = lastRow.id;
      }
      await q(sb.from('chat_threads').update(mark).eq('id', t.id));
      t.unreadVisitor = 0;
    }
    return { config: publicConfig(c), thread: pick(t, THREAD_PUBLIC), messages: rows.map(msgOut) };
  });

  // Terhubung ke admin. history = pertanyaan ke bot sebelumnya (dijawab ulang di server, supaya admin
  // melihat konteksnya dan isi jawaban bot tidak bisa dipalsukan dari browser).
  on('POST', '/chat/start', async ({ req, body: b }: Row, log: (e: Row) => void) => {
    if (b.website) return created({ ok: true }); // honeypot
    const c = await chatSettings();
    if (!c.enabled) throw new HttpError(403, 'Live chat sedang tidak aktif. Silakan hubungi kami lewat WhatsApp.');
    const message = str(b.message, 1000);
    const history = (Array.isArray(b.history) ? b.history : []).slice(-6)
      .map((h: Row) => ({ text: str(h?.text, 500), topic: str(h?.topic, 30) })).filter((h: Row) => h.text || h.topic);
    if (!message && !history.length) throw bad('Tulis pertanyaan Anda.');
    const existing = await visitorThread(req);
    if (existing) {
      const msgs = message ? await askInThread(existing, c, { text: message }, false) : [];
      return created({ thread: pick(existing, THREAD_PUBLIC), messages: msgs });
    }
    const name = str(b.name, 60);
    if (!name) throw bad('Isi nama panggilan Anda.');
    const contact = str(b.contact, 80);
    const { ip, ua } = clientInfo(req);
    if (ip) {
      const { count } = await sb.from('chat_threads').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', new Date(Date.now() - 3600e3).toISOString());
      if ((count ?? 0) >= 5) throw new HttpError(429, 'Terlalu banyak percakapan baru dari jaringan ini. Coba lagi nanti atau hubungi kami lewat WhatsApp.');
    }
    const token = randomToken(32);
    const t = toCamel(await q(sb.from('chat_threads').insert({
      visitor_hash: await sha256(token), name, contact, page: str(b.page, 120), ip, user_agent: ua, last_preview: (message || '').slice(0, 140),
    }).select().single()));
    t.isNew = true; // email "percakapan baru" dikirim sekali di bawah, bukan per pesan
    const out: Row[] = [];
    if (c.botEnabled && history.length) {
      const kamus = kamusOf(c), d = await botData(c);
      for (const h of history) {
        const label = h.topic ? kamus.find((e) => e.id === h.topic)?.label : '';
        if (!h.text && !label) continue;
        out.push(await addMessage(t, 'pengunjung', h.text || label!));
        const r = botReply(h, kamus, d);
        if (!r.handoff) out.push(await addMessage(t, 'bot', r.text, { options: r.options, seen: true }));
      }
    }
    if (message) out.push(await addMessage(t, 'pengunjung', message));
    out.push(await addMessage(t, 'sistem', chatOnline(c)
      ? `${name}, pesan Anda sudah diteruskan ke admin. Balasan akan muncul di sini. Jam layanan: ${chatHoursText(c)}.`
      : `${c.offlineText} Jam layanan: ${chatHoursText(c)}.`, { seen: true }));
    const asked = out.filter((m) => m.sender === 'pengunjung').map((m) => `• ${m.body}`).join('\n');
    mailAdmin(t, 'chat.new', asked, `chat-new:${t.id}`);
    log({ action: 'chat.start', summary: `Memulai live chat${message ? `: ${message.slice(0, 80)}` : ''}`, target: name });
    return created({ token, thread: pick(t, THREAD_PUBLIC), messages: out });
  });

  on('POST', '/chat/messages', async ({ req, body: b }: Row) => {
    const t = await visitorThread(req);
    if (!t) throw new HttpError(401, 'Percakapan tidak ditemukan. Mulai chat baru.');
    const c = await chatSettings();
    if (!c.enabled) throw new HttpError(403, 'Live chat sedang tidak aktif. Silakan hubungi kami lewat WhatsApp.');
    const topic = str(b.topic, 30);
    if (topic) {
      if (!kamusOf(c).some((e) => e.id === topic && e.enabled)) throw bad('Topik tidak dikenal.');
      return created({ messages: await askInThread(t, c, { topic }, true) });
    }
    return created({ messages: await askInThread(t, c, { text: str(b.body, 1000) }, false) });
  });

  // Admin
  on('GET', '/admin/chats', async ({ url }: Row) => {
    const status = url.searchParams.get('status') || 'semua';
    let lq = sb.from('chat_threads').select('*').order('last_message_at', { ascending: false }).limit(200);
    if (status === 'terbuka' || status === 'selesai') lq = lq.eq('status', status);
    if (status === 'belum') lq = lq.gt('unread_admin', 0);
    const rows = (((await q(lq)) as Row[]) || []).map((r) => pick(toCamel(r), THREAD_ADMIN));
    return { threads: rows, ...(await counts()) };
  });

  // Untuk lencana menu & widget Ringkasan (dipanggil berkala, harus ringan).
  async function counts() {
    const rows = ((await q(sb.from('chat_threads').select('id, name, last_preview, last_message_at, unread_admin').gt('unread_admin', 0).order('last_message_at', { ascending: false }).limit(50))) as Row[]) || [];
    return {
      unread: rows.reduce((a, r) => a + (r.unread_admin || 0), 0),
      unreadThreads: rows.length,
      latest: rows.slice(0, 5).map((r) => ({ id: r.id, name: r.name, preview: r.last_preview, at: r.last_message_at, unread: r.unread_admin })),
    };
  }
  on('GET', '/admin/chats/unread', counts);

  on('GET', '/admin/chats/:id', async ({ params, url }: Row) => {
    const t = await getThread(params.id);
    const rows = await listAfter(t.id, Number(url.searchParams.get('after')) || 0);
    const last = rows.length ? rows[rows.length - 1].id : 0;
    if (t.unreadAdmin > 0 || last > (t.adminReadId || 0)) {
      await q(sb.from('chat_threads').update({ unread_admin: 0, admin_read_id: Math.max(last, t.adminReadId || 0) }).eq('id', t.id));
      t.unreadAdmin = 0;
    }
    return { thread: pick(t, THREAD_ADMIN), messages: rows.map(msgOut) };
  });

  on('POST', '/admin/chats/:id/messages', async ({ params, body: b, adminEmail }: Row, log: (e: Row) => void) => {
    const t = await getThread(params.id);
    const m = await addMessage(t, 'admin', b.body, { adminEmail });
    log({ action: 'chat.reply', summary: `Membalas live chat ${t.name}`, target: t.name, dedupeMinutes: 30 });
    return created(m);
  });

  on('PUT', '/admin/chats/:id', async ({ params, body: b }: Row, log: (e: Row) => void) => {
    const t = await getThread(params.id);
    const patch: Row = {};
    if (b.status !== undefined) patch.status = b.status === 'selesai' ? 'selesai' : 'terbuka';
    if (b.adminNote !== undefined) patch.admin_note = str(b.adminNote, 500);
    if (b.name !== undefined && str(b.name, 60)) patch.name = str(b.name, 60);
    if (!Object.keys(patch).length) throw bad('Tidak ada yang diubah.');
    const out = toCamel(await q(sb.from('chat_threads').update(patch).eq('id', t.id).select().single()));
    if (patch.status) log({ action: 'chat.status', summary: `${patch.status === 'selesai' ? 'Menandai selesai' : 'Membuka lagi'} live chat ${t.name}`, target: t.name });
    return pick(out, THREAD_ADMIN);
  });

  on('DELETE', '/admin/chats/:id', async ({ params }: Row, log: (e: Row) => void) => {
    const t = await getThread(params.id);
    await q(sb.from('chat_threads').delete().eq('id', t.id));
    log({ action: 'chat.delete', summary: `Menghapus live chat ${t.name}`, target: t.name });
    return { ok: true };
  });

  const settingsOut = (c: Row) => {
    const { site: _s, ...rest } = c;
    return { ...rest, kamus: kamusOf(c), online: chatOnline(c), hoursText: chatHoursText(c), defaults: { ...CHAT_DEFAULTS, kamus: DEFAULT_KAMUS }, placeholders: PLACEHOLDERS };
  };
  on('GET', '/admin/chat-settings', async () => settingsOut(await chatSettings()));
  on('PUT', '/admin/chat-settings', async ({ body: b }: Row, log: (e: Row) => void) => {
    const cur = await getSettings();
    const next: Row = { ...CHAT_DEFAULTS, ...(cur.liveChat || {}) };
    for (const k of ['enabled', 'visible', 'botEnabled']) if (b[k] !== undefined) next[k] = b[k] === true || b[k] === 'on' || b[k] === 'true';
    if (b.days !== undefined) {
      const list = (Array.isArray(b.days) ? b.days : String(b.days).split(',')).map(Number).filter((x: number) => Number.isInteger(x) && x >= 0 && x <= 6);
      next.days = [...new Set(list)].sort();
    }
    for (const k of ['opens', 'closes']) if (b[k] !== undefined) { if (!isHm(b[k])) throw bad('Format jam harus JJ:MM, misalnya 09:00.'); next[k] = b[k]; }
    if (b.greeting !== undefined) next.greeting = str(b.greeting, 300) || CHAT_DEFAULTS.greeting;
    if (b.offlineText !== undefined) next.offlineText = str(b.offlineText, 400) || CHAT_DEFAULTS.offlineText;
    if (b.kamus !== undefined) {
      if (b.kamus === null) delete next.kamus; // kembali ke kamus bawaan
      else { try { next.kamus = sanitizeKamus(b.kamus); } catch (e) { throw bad((e as Error).message); } }
    }
    await q(sb.from('settings').upsert({ id: 1, data: { ...cur, liveChat: next } }));
    log({ action: 'chat.settings', summary: b.kamus !== undefined ? 'Mengubah kamus bot live chat' : `Mengubah pengaturan live chat (${next.enabled ? 'aktif' : 'nonaktif'}, ${next.visible ? 'tampil' : 'disembunyikan'}, bot ${next.botEnabled ? 'aktif' : 'mati'})` });
    return settingsOut({ ...next, whatsapp: normalizePhone(cur.whatsapp || ''), site: cur });
  });
  // Coba bot dari admin (tanpa menyimpan). kamus opsional: uji kamus yang belum disimpan.
  on('POST', '/admin/chat-bot/test', async ({ body: b }: Row) => {
    const c = await chatSettings();
    let kamus = kamusOf(c);
    if (b.kamus !== undefined) { try { kamus = sanitizeKamus(b.kamus); } catch (e) { throw bad((e as Error).message); } }
    return botReply({ text: str(b.text, 500), topic: str(b.topic, 30) }, kamus, await botData(c));
  });

  return { counts, ADMIN_TOPIC };
}
