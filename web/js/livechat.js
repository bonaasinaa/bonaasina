// Live chat publik: bot sambutan lebih dulu, lalu percakapan dengan admin lewat polling.
// Tanpa skrip atau gaya inline, sesuai CSP di _headers.
(() => {
  const API = (window.BONA_CONFIG?.apiBase || '/api').replace(/\/$/, '');
  const TOKEN_KEY = 'bonaasina-chat';
  const DRAFT_KEY = 'bonaasina-chat-bot'; // percakapan dengan bot sebelum terhubung (per tab)
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const linkify = (s) => esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}${u.length > 60 ? '…' : ''}</a>`);
  const jam = (iso) => { try { return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const store = {
    get(k, s = localStorage) { try { return s.getItem(k); } catch { return null; } },
    set(k, v, s = localStorage) { try { v == null ? s.removeItem(k) : s.setItem(k, v); } catch { /* mode privat */ } },
  };
  const track = (name, p) => { try { window.bonaEvent?.(name, p); } catch { /* abaikan */ } };

  let token = store.get(TOKEN_KEY);
  let cfg = null, thread = null, open = false, last = 0, unread = 0, timer = 0, busy = false;
  let botLog = []; // [{sender, body, options, id}] sebelum terhubung
  try { botLog = JSON.parse(store.get(DRAFT_KEY, sessionStorage) || '[]'); } catch { botLog = []; }
  let pending = ''; // pertanyaan yang belum dipahami bot, dikirim ke admin saat terhubung
  let askingName = false;

  async function call(method, path, body) {
    const headers = {};
    if (token) headers['X-Chat-Session'] = token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Gagal terhubung. Coba lagi.'); e.status = res.status; throw e; }
    return data;
  }

  // Tampilan
  const root = document.createElement('div');
  root.className = 'lc';
  root.innerHTML = `
    <section class="lc__panel" id="lcPanel" role="dialog" aria-modal="false" aria-labelledby="lcTitle" hidden>
      <header class="lc__head">
        <img src="/assets/img/mark.webp" alt="" width="40" height="27">
        <div><strong id="lcTitle">Chat Bonaasina</strong><span class="lc__status" id="lcStatus"></span></div>
        <button class="lc__close" type="button" aria-label="Tutup chat">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </header>
      <div class="lc__list" id="lcList" aria-live="polite" data-lenis-prevent></div>
      <form class="lc__form" id="lcForm">
        <textarea id="lcInput" rows="1" maxlength="1000" placeholder="Tulis pertanyaan…" aria-label="Tulis pesan"></textarea>
        <button class="lc__send" type="submit" aria-label="Kirim">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6l-.1 6.5L15 12 3.3 13.9z"/></svg>
        </button>
      </form>
      <p class="lc__alt" id="lcAlt" hidden>Lebih suka WhatsApp? <a id="lcWa" href="#" target="_blank" rel="noopener">Chat di WhatsApp</a></p>
    </section>
    <button class="lc__launch" id="lcLaunch" type="button" aria-controls="lcPanel" aria-expanded="false">
      <span class="lc__mark" aria-hidden="true">
        <svg class="lc__ico-chat" viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M12 3C6.5 3 2 6.7 2 11.2c0 2.4 1.3 4.6 3.4 6.1L4.6 21l4.2-2.2c1 .3 2.1.4 3.2.4 5.5 0 10-3.7 10-8.1S17.5 3 12 3Zm-4.5 9.3a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm4.5 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm4.5 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Z"/></svg>
        <svg class="lc__ico-close" viewBox="0 0 24 24" width="22" height="22"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
      </span>
      <span class="lc__copy"><strong>Ada pertanyaan?</strong><span>Chat dengan kami</span></span>
      <span class="lc__badge" id="lcBadge" hidden></span>
    </button>`;
  const $ = (s) => root.querySelector(s);
  const panel = $('#lcPanel'), list = $('#lcList'), form = $('#lcForm'), input = $('#lcInput'), launch = $('#lcLaunch');

  function setStatus() {
    const st = $('#lcStatus');
    if (!cfg) return;
    if (!cfg.enabled) { st.textContent = 'Chat sedang tidak aktif'; st.className = 'lc__status'; return; }
    st.className = `lc__status${cfg.online ? ' is-on' : ''}`;
    st.textContent = cfg.online ? `Jam layanan · ${cfg.hoursText}` : `Admin membalas ${cfg.hoursText}`;
  }
  // Tautan WhatsApp di panel: pakai tautan halaman (sudah berisi sapaan) bila ada, atau nomor dari pengaturan.
  function setWa() {
    const wa = document.getElementById('waFloat');
    const href = wa && wa.getAttribute('href') && wa.getAttribute('href') !== '#' ? wa.href : cfg?.whatsapp ? `https://wa.me/${cfg.whatsapp}` : '';
    if (href) $('#lcWa').href = href;
    $('#lcAlt').hidden = !href;
  }
  function setBadge() {
    const b = $('#lcBadge');
    b.textContent = unread > 9 ? '9+' : String(unread); b.hidden = !unread || open;
    launch.setAttribute('aria-label', `${open ? 'Tutup chat' : 'Buka chat dengan Bonaasina'}${unread && !open ? `, ${unread} pesan baru` : ''}`);
  }
  const WHO = { admin: 'Admin Bonaasina', bot: 'Asisten otomatis', pengunjung: 'Anda' };
  function bubble(m, live = true) {
    const div = document.createElement('div');
    div.className = `lc-msg lc-msg--${m.sender}`;
    div.innerHTML = `${m.sender === 'admin' || m.sender === 'bot' ? `<span class="lc-msg__who">${WHO[m.sender]}</span>` : ''}<div class="lc-msg__body">${linkify(m.body)}</div>${m.createdAt ? `<small>${jam(m.createdAt)}</small>` : ''}`;
    if (m.options?.length && live) {
      const chips = document.createElement('div'); chips.className = 'lc-chips';
      chips.innerHTML = m.options.map((o) => `<button type="button" data-topic="${esc(o.id)}">${esc(o.label)}</button>`).join('');
      div.appendChild(chips);
    }
    return div;
  }
  function scrollEnd() { list.scrollTop = list.scrollHeight; }
  // Tombol topik hanya aktif pada jawaban terakhir.
  function retireChips() { list.querySelectorAll('.lc-chips').forEach((c) => c.remove()); }
  function addBubbles(msgs) {
    if (!msgs.length) return;
    retireChips();
    for (const m of msgs) { if (m.id && m.id <= last) continue; if (m.id) last = m.id; list.appendChild(bubble(m)); }
    // Chip tetap hanya pada pesan bot terakhir.
    const bots = [...list.querySelectorAll('.lc-chips')]; bots.slice(0, -1).forEach((c) => c.remove());
    scrollEnd();
  }

  function renderBot() {
    list.innerHTML = '';
    const greet = cfg.botEnabled ? { sender: 'bot', body: cfg.greeting, options: cfg.menu }
      : { sender: 'sistem', body: 'Horas! Tulis pertanyaan Anda, admin Bonaasina akan membalas di sini.' };
    [greet, ...botLog].forEach((m) => list.appendChild(bubble(m)));
    const chips = [...list.querySelectorAll('.lc-chips')]; chips.slice(0, -1).forEach((c) => c.remove());
    if (askingName) list.appendChild(nameCard());
    scrollEnd();
  }
  function saveBotLog() { botLog = botLog.slice(-30); store.set(DRAFT_KEY, JSON.stringify(botLog), sessionStorage); }

  function nameCard() {
    const f = document.createElement('form');
    f.className = 'lc-card'; f.id = 'lcStart';
    f.innerHTML = `<p><strong>Hubungkan ke admin</strong>${cfg.online ? '' : `<br><span>Di luar jam layanan, pesan tetap kami terima dan dibalas ${esc(cfg.hoursText)}.</span>`}</p>
      <label>Nama panggilan<input name="name" maxlength="60" autocomplete="given-name" required></label>
      <label>WhatsApp <span>(opsional, supaya bisa dikabari)</span><input name="contact" maxlength="80" inputmode="tel" autocomplete="tel"></label>
      ${pending || !cfg.botEnabled ? '' : '<label>Pesan untuk admin<textarea name="message" rows="2" maxlength="1000" placeholder="Tulis pertanyaan Anda…"></textarea></label>'}
      <input name="website" tabindex="-1" autocomplete="off" class="lc-hp" aria-hidden="true">
      <p class="lc-card__err" role="alert" hidden></p>
      <div class="lc-card__actions"><button type="button" class="lc-link" data-cancel>Batal</button><button type="submit" class="lc-btn">Hubungkan</button></div>`;
    return f;
  }
  function showNameCard() {
    if (!cfg.enabled) { addBubbles([{ sender: 'sistem', body: 'Live chat dengan admin sedang tidak aktif. Silakan hubungi kami lewat WhatsApp.' }]); return; }
    askingName = true;
    list.querySelector('#lcStart')?.remove();
    list.appendChild(nameCard()); scrollEnd();
    setTimeout(() => list.querySelector('#lcStart input[name=name]')?.focus(), 30);
  }

  function renderThread(msgs) {
    list.innerHTML = ''; last = 0;
    addBubbles(msgs);
    if (!msgs.length) list.innerHTML = '<p class="lc-empty">Belum ada pesan.</p>';
  }

  // Alur
  async function askBot(payload, shown) {
    retireChips();
    const mine = { sender: 'pengunjung', body: shown, topic: payload.topic || null, text: payload.text || null };
    botLog.push(mine); list.appendChild(bubble(mine)); scrollEnd();
    const typing = document.createElement('div'); typing.className = 'lc-msg lc-msg--bot lc-typing'; typing.innerHTML = '<i></i><i></i><i></i>'; list.appendChild(typing); scrollEnd();
    try {
      const r = await call('POST', '/chat/ask', payload);
      typing.remove();
      if (r.handoff) { botLog.pop(); saveBotLog(); renderBot(); showNameCard(); return; }
      if (!r.topic && payload.text) pending = payload.text; // belum dipahami: ikut dikirim bila terhubung ke admin
      const reply = { sender: 'bot', body: r.text, options: r.options };
      botLog.push(reply); saveBotLog(); addBubbles([reply]);
      track('chat_bot', { topic: r.topic || 'tidak_paham' });
    } catch (ex) { typing.remove(); addBubbles([{ sender: 'sistem', body: ex.message }]); }
  }

  async function startThread(f) {
    const err = f.querySelector('.lc-card__err'); err.hidden = true;
    const data = Object.fromEntries(new FormData(f));
    const message = (data.message || '').trim() || pending;
    const history = botLog.filter((m) => m.sender === 'pengunjung' && (m.topic || m.text) && m.text !== pending).map((m) => (m.topic ? { topic: m.topic } : { text: m.text }));
    if (!message && !history.length) { err.textContent = 'Tulis pertanyaan Anda untuk admin.'; err.hidden = false; return; }
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try {
      const out = await call('POST', '/chat/start', { name: data.name, contact: data.contact, message, website: data.website, history, page: location.pathname });
      if (out.token) { token = out.token; store.set(TOKEN_KEY, token); }
      thread = out.thread; askingName = false; pending = ''; botLog = []; saveBotLog();
      renderThread(out.messages || []);
      track('chat_start', { from_bot: history.length ? 'ya' : 'tidak' });
      schedule();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; }
  }

  async function sendInThread(payload) {
    busy = true;
    try {
      const out = await call('POST', '/chat/messages', payload);
      addBubbles(out.messages || []);
    } catch (ex) {
      if (ex.status === 401) { forget(); return; }
      addBubbles([{ sender: 'sistem', body: ex.message }]);
      throw ex;
    } finally { busy = false; }
  }
  // Token tidak berlaku lagi (percakapan dihapus admin): mulai dari bot lagi.
  function forget() { token = null; thread = null; last = 0; store.set(TOKEN_KEY, null); renderBot(); }

  async function poll() {
    clearTimeout(timer);
    if (document.hidden || busy) return schedule();
    try {
      const out = await call('GET', `/chat?after=${last}${open ? '&read=1' : ''}`);
      cfg = out.config; setStatus();
      if (!out.thread) { if (thread || token) forget(); return; }
      thread = out.thread;
      const fresh = (out.messages || []).filter((m) => m.id > last);
      if (fresh.length) {
        list.querySelector('.lc-empty')?.remove();
        addBubbles(fresh);
      }
      unread = open ? 0 : out.thread.unreadVisitor || 0; setBadge();
    } catch (ex) { if (ex.status === 401) forget(); }
    schedule();
  }
  function schedule() {
    clearTimeout(timer);
    if (!thread) return;
    timer = setTimeout(poll, open ? 4000 : 25000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && thread) poll(); });

  function toggle(want = !open) {
    open = want;
    panel.hidden = !open; root.classList.toggle('is-open', open);
    launch.setAttribute('aria-expanded', String(open));
    if (open) {
      unread = 0; setWa(); scrollEnd();
      if (thread) poll();
      setTimeout(() => input.focus({ preventScroll: true }), 50);
      track('chat_open', {});
    } else schedule();
    setBadge();
  }

  launch.addEventListener('click', () => toggle());
  $('.lc__close').addEventListener('click', () => { toggle(false); launch.focus(); });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { toggle(false); launch.focus(); } });

  list.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-topic]');
    if (chip) {
      const topic = chip.dataset.topic, label = chip.textContent;
      if (thread) { retireChips(); sendInThread({ topic }).catch(() => {}); }
      else if (topic === 'admin') { retireChips(); showNameCard(); }
      else askBot({ topic }, label);
      return;
    }
    if (e.target.closest('[data-cancel]')) { askingName = false; e.target.closest('form').remove(); renderBot(); }
  });
  list.addEventListener('submit', (e) => { if (e.target.id === 'lcStart') { e.preventDefault(); startThread(e.target); } });

  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer:fine)').matches) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim(); if (!text || busy) return;
    if (thread) {
      const btn = form.querySelector('button'); btn.disabled = true;
      try { await sendInThread({ body: text }); input.value = ''; input.style.height = ''; } catch { /* pesan galat sudah tampil */ }
      finally { btn.disabled = false; input.focus(); }
      return;
    }
    input.value = ''; input.style.height = '';
    if (cfg.botEnabled) askBot({ text }, text);
    else { pending = text; const mine = { sender: 'pengunjung', body: text }; botLog.push(mine); saveBotLog(); addBubbles([mine]); showNameCard(); }
  });

  // Mulai
  async function init() {
    let out;
    try { out = await call('GET', '/chat'); } catch { return; } // API tidak terjangkau: tombol WhatsApp tetap ada
    cfg = out.config;
    if (!out.thread && token) { token = null; store.set(TOKEN_KEY, null); }
    thread = out.thread;
    // Tombol chat disembunyikan admin, atau chat mati dan belum pernah chat: biarkan tombol WhatsApp biasa.
    if (!cfg.visible || (!cfg.enabled && !thread)) return;
    // Tombol WhatsApp melayang digantikan tombol chat; WhatsApp tetap tersedia di dalam panel.
    const wa = document.getElementById('waFloat');
    if (wa) { wa.hidden = true; wa.closest('aside')?.setAttribute('hidden', ''); }
    setWa();
    document.body.appendChild(root);
    root.classList.add('is-ready');
    setStatus();
    if (thread) { renderThread(out.messages || []); unread = thread.unreadVisitor || 0; setBadge(); schedule(); }
    else renderBot();
    setBadge();
    // Tombol "chat" di halaman (data-livechat) membuka panel ini; disembunyikan bila chat tidak tampil.
    document.querySelectorAll('[data-livechat-wrap]').forEach((el) => { el.hidden = false; });
    document.addEventListener('click', (e) => { const a = e.target.closest('[data-livechat]'); if (a) { e.preventDefault(); toggle(true); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
