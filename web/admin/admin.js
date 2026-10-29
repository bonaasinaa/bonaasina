/* Admin Bonaasina — satu halaman, tanpa framework. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const tgl = (s) => { if (!s) return '-'; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return `${d} ${BULAN[m - 1]} ${y}`; };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const STATUS_KAMAR = { kosong: 'Kosong', terisi: 'Terisi', dipesan: 'Dipesan', perbaikan: 'Perbaikan' };
  const STATUS_SURVEI = { baru: 'Baru', dikonfirmasi: 'Dikonfirmasi', selesai: 'Selesai', batal: 'Batal' };
  const main = $('#main');
  let cache = { properties: [], allProps: [], settings: null };
  // Menu lama (penghuni, tagihan, kamar) hanya untuk kos milik Bonaasina; kos mitra dikelola di menu Kos Sekitar.
  const setProps = (list) => { cache.allProps = list; cache.properties = list.filter((p) => p.kind !== 'mitra'); };
  const CYCLE_NAME = { harian: 'Harian', bulanan: 'Bulanan', semesteran: '6 bulanan', tahunan: 'Tahunan' };
  const CYCLE_PRICE = { harian: 'priceDaily', bulanan: 'priceMonthly', semesteran: 'priceSemester', tahunan: 'priceYearly' };

  // ---------- API ----------
  const API = (window.BONA_CONFIG?.apiBase || '/api').replace(/\/$/, '') + '/admin';
  const SESSION_KEY = 'bonaasina-admin-session';
  const getSession = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } };
  const setSession = (s) => { try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch { /* abaikan */ } };
  const PUBLIC_PATHS = ['/login', '/refresh', '/setup'];
  async function refreshSession() {
    const s = getSession(); if (!s?.refreshToken) return false;
    const res = await fetch(API + '/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: s.refreshToken }) });
    if (!res.ok) { setSession(null); return false; }
    setSession(await res.json()); return true;
  }
  async function rawFetch(method, path, body, raw) {
    const opt = { method, headers: {} };
    const s = getSession();
    if (s?.accessToken && !PUBLIC_PATHS.includes(path)) opt.headers.Authorization = `Bearer ${s.accessToken}`;
    if (raw) { opt.body = raw; opt.headers['Content-Type'] = raw.type; }
    else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
    return fetch(API + path, opt);
  }
  // Kegagalan yang tidak ditangani tetap diberitahukan ke pengguna (dulu beberapa tombol gagal tanpa pesan).
  window.addEventListener('unhandledrejection', (e) => {
    e.preventDefault();
    console.error(e.reason);
    toast(e.reason?.message || 'Terjadi kesalahan. Coba lagi.', true);
  });
  async function api(method, path, body, raw) {
    // Perpanjang sesi sebelum habis (token login berlaku sekitar 1 jam).
    const s = getSession();
    if (s?.expiresAt && s.expiresAt * 1000 < Date.now() + 60000 && !PUBLIC_PATHS.includes(path)) await refreshSession();
    let res;
    try { res = await rawFetch(method, path, body, raw); }
    catch { throw new Error('Tidak bisa terhubung ke server. Periksa koneksi internet lalu coba lagi.'); }
    if (res.status === 401 && !PUBLIC_PATHS.includes(path) && (await refreshSession())) res = await rawFetch(method, path, body, raw);
    if (res.status === 401 && !PUBLIC_PATHS.includes(path)) { setSession(null); showLogin(); throw new Error('Silakan masuk dulu.'); }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : ct.includes('csv') || ct.includes('pdf') ? await res.blob() : await res.text();
    if (!res.ok) throw new Error(data.error || 'Terjadi kesalahan.');
    // Setiap perubahan data membuat cache usang; halaman berikutnya diambil ulang dari server.
    if (method !== 'GET' && !PUBLIC_PATHS.includes(path)) { for (const v of store.values()) v.stale = true; forceFresh = true; }
    return data;
  }

  // ---------- cache data (supaya pindah menu terasa instan) ----------
  // Data terakhir tiap alamat disimpan di memori. Menu dibuka langsung dari cache, lalu diperbarui
  // dari server di latar belakang; tampilan hanya digambar ulang bila datanya memang berubah.
  const store = new Map(); // path → { data, json, t, stale }
  const inflight = new Map();
  let forceFresh = false;
  function fetchFresh(path) {
    if (inflight.has(path)) return inflight.get(path);
    const p = api('GET', path).then((data) => {
      const json = JSON.stringify(data); const prev = store.get(path);
      store.set(path, { data, json, t: Date.now(), stale: false });
      return { changed: !prev || prev.json !== json };
    }).finally(() => inflight.delete(path));
    inflight.set(path, p); return p;
  }
  // Dipakai oleh halaman: data dari cache (selalu terisi oleh route sebelum halaman digambar).
  async function get(path) {
    if (!store.has(path)) await fetchFresh(path);
    return store.get(path).data;
  }
  const isFresh = (path, maxAge = 30000) => { const c = store.get(path); return c && !c.stale && Date.now() - c.t < maxAge; };
  function saveBlob(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  let toastTimer;
  function toast(msg, isError) {
    const t = $('#toast'); t.textContent = msg; t.classList.toggle('is-error', !!isError); t.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('is-on'), 3200);
  }

  // ---------- dialog ----------
  const dlg = $('#dlg'); let dlgHandler = null;
  function openDialog({ title, body, ok = 'Simpan', okClass = 'btn--red', onOk, onOpen, wide = false }) {
    dlg.classList.toggle('dlg--wide', wide);
    $('#dlgTitle').textContent = title; $('#dlgBody').innerHTML = body;
    $('#dlgOk').textContent = ok; $('#dlgOk').className = `btn ${okClass}`; $('#dlgOk').hidden = !onOk;
    $('.dlg__foot .btn--ghost').textContent = onOk ? 'Batal' : 'Tutup';
    $('#dlgErr').hidden = true; dlgHandler = onOk; dlg.showModal();
    onOpen?.($('#dlgBody'));
    setTimeout(() => $('#dlgBody input:not([type=hidden]), #dlgBody select, #dlgBody textarea')?.focus(), 30);
  }
  $('#dlgForm').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'ok' || !dlgHandler) return;
    e.preventDefault();
    const btn = $('#dlgOk'); btn.disabled = true;
    try {
      const data = Object.fromEntries(new FormData($('#dlgForm')));
      await dlgHandler(data, $('#dlgBody'));
      if (dlg.open && !dlg.dataset.keep) dlg.close();
    } catch (ex) { if (!ex.keepOpen) { $('#dlgErr').textContent = ex.message; $('#dlgErr').hidden = false; } }
    finally { btn.disabled = false; }
  });
  dlg.addEventListener('close', () => { if (dlg.dataset.refresh) { delete dlg.dataset.refresh; route(); } });
  const normPhone = (p) => { let x = String(p || '').replace(/[^0-9+]/g, ''); if (x.startsWith('+')) x = x.slice(1); if (x.startsWith('0')) x = '62' + x.slice(1); if (x.startsWith('8')) x = '62' + x; return x; };

  // Konfirmasi di dalam halaman (dialog bawaan browser tidak selalu tersedia).
  function askConfirm(title, text, ok = 'Ya, lanjutkan') {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
      const show = () => {
        openDialog({ title, ok, body: `<p>${esc(text)}</p>`, onOk: async () => { finish(true); } });
        dlg.addEventListener('close', () => finish(false), { once: true });
      };
      // Event 'close' dari dialog yang baru ditutup dikirim tertunda; pendengar baru dipasang setelah
      // event itu lewat, supaya konfirmasi tidak langsung dibatalkan sendiri.
      if (dlg.open) { dlg.close(); setTimeout(show, 0); } else show();
    });
  }
  // Tampilkan teks (CSV/cadangan) untuk disalin, dipakai bila unduhan tidak tersedia.
  function showTextDialog(title, note, text) {
    openDialog({
      title, body: `<p class="muted">${esc(note)}</p><textarea id="txtOut" rows="12" readonly style="font-size:12px;margin-top:10px">${esc(text)}</textarea>
        <div class="btn-row mt"><button type="button" class="btn btn--ghost btn--sm" id="txtCopy">Salin semua</button></div>`,
      onOpen: (b) => { $('#txtCopy', b).onclick = () => copyText($('#txtOut', b)); },
    });
  }
  async function copyText(el) {
    try { await navigator.clipboard.writeText(el.value ?? el.textContent); toast('Disalin.'); }
    catch { if (el.select) el.select(); else getSelection().selectAllChildren(el); toast('Teks sudah dipilih. Tekan Ctrl+C untuk menyalin.'); }
  }

  // ---------- login ----------
  function showLogin() {
    $('#app').hidden = true; $('#login').hidden = false; $('#setupForm').hidden = true; $('#loginForm').hidden = false;
    $('#loginForm [name=email]').focus();
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = $('button[type=submit]', e.target); btn.disabled = true;
    const id = e.target.email.value.trim(); const password = e.target.password.value;
    try {
      if (!id.includes('@')) {
        // Username penghuni, pemilik kos mitra, atau customer → dashboard masing-masing.
        const out = await window.BonaMarket.login(id, password);
        location.href = out.home; return;
      }
      setSession(await api('POST', '/login', { email: id, password }));
      e.target.password.value = ''; $('#loginErr').hidden = true; start();
    } catch (ex) { $('#loginErr').textContent = ex.message; $('#loginErr').hidden = false; }
    finally { btn.disabled = false; }
  });
  $('#showSetup').addEventListener('click', () => { $('#loginForm').hidden = true; $('#setupForm').hidden = false; $('#setupForm [name=email]').value = $('#loginForm [name=email]').value; $('#setupForm [name=code]').focus(); });
  $('#backToLogin').addEventListener('click', () => { $('#setupForm').hidden = true; $('#loginForm').hidden = false; });
  $('#setupForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    if (f.password.value !== f.password2.value) { $('#setupErr').textContent = 'Kedua kata sandi belum sama.'; $('#setupErr').hidden = false; return; }
    try {
      await api('POST', '/setup', { email: f.email.value, code: f.code.value, password: f.password.value });
      setSession(await api('POST', '/login', { email: f.email.value, password: f.password.value }));
      f.reset(); toast('Kata sandi disimpan.'); start();
    } catch (ex) { $('#setupErr').textContent = ex.message; $('#setupErr').hidden = false; }
  });
  $('#logout').addEventListener('click', async () => {
    try { await rawFetch('POST', '/logout'); } catch { /* tetap keluar */ }
    setSession(null); store.clear(); showLogin();
  });

  async function start() {
    $('#login').hidden = true; $('#app').hidden = false;
    main.innerHTML = skeleton();
    BonaLoader.show('Menyiapkan dashboard…', 0);
    try { const [props, settings] = await Promise.all([get('/properties'), get('/settings')]); setProps(props); cache.settings = settings; }
    catch (ex) { BonaLoader.hide(); if (ex.message !== 'Silakan masuk dulu.') main.innerHTML = `<div class="empty">${esc(ex.message)}</div>`; return; }
    try { await route(); } finally { BonaLoader.hide(); }
    prefetchAll();
  }

  // ---------- router ----------
  const views = { ringkasan, tagihan, laporan, penghuni, kontrak, pengumuman, piket, kerusakan, kamar, survei, tunggu, aktivitas, pengaturan, reservasi, persetujuan, daftar, mitra, pemilik, fee, notifikasi, titip, tempat };
  const TITLES = { ringkasan: 'Ringkasan', tagihan: 'Tagihan', laporan: 'Laporan', penghuni: 'Penghuni', kontrak: 'Kontrak', pengumuman: 'Pengumuman', piket: 'Piket', kerusakan: 'Kerusakan', kamar: 'Kamar & kos', survei: 'Survei', tunggu: 'Daftar tunggu', aktivitas: 'Log aktivitas', pengaturan: 'Pengaturan',
    reservasi: 'Reservasi', persetujuan: 'Persetujuan & refund', daftar: 'Pendaftaran mitra', mitra: 'Mitra kos', pemilik: 'Pemilik kos', fee: 'Fee & aturan', notifikasi: 'Notifikasi', titip: 'Titip jualan', tempat: 'Tempat sekitar' };
  const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');
  // Data yang dibutuhkan tiap menu; diambil bersamaan sebelum halaman digambar.
  const deps = (name, p = new URLSearchParams()) => ({
    ringkasan: ['/summary', '/invoices', `/reports?year=${new Date().getFullYear()}`], tagihan: ['/invoices', '/tenants'],
    penghuni: p.get('id') ? [`/tenants/${p.get('id')}/detail`, '/settings'] : ['/tenants', '/rooms'],
    kontrak: ['/contracts', '/summary', '/tenants'], pengumuman: ['/announcements'], piket: ['/chores'], tunggu: ['/waitlist'],
    kamar: ['/rooms', '/properties'], survei: ['/surveys'], kerusakan: ['/issues'],
    reservasi: ['/leads', '/rooms', '/properties'], persetujuan: ['/leads'], daftar: ['/applications'], mitra: ['/partners', '/owners', '/rooms'], pemilik: ['/owners'], fee: ['/settings', '/leads', '/partners'], notifikasi: ['/notifications'], titip: ['/listings'], tempat: ['/places'],
    laporan: [`/reports?year=${repYear}`, '/expenses'], aktivitas: [activityPath()], pengaturan: ['/settings'],
  }[name] || []);
  const currentView = () => { const n = (location.hash.slice(1) || 'ringkasan').split('?')[0]; return views[n] ? n : 'ringkasan'; };
  let routeSeq = 0, shownView = null;

  async function route() {
    const seq = ++routeSeq;
    const name = currentView(); const view = views[name];
    const key = `${name}?${hashParams()}`;
    const paths = deps(name, hashParams());
    const fresh = forceFresh; forceFresh = false;
    const isNewView = shownView !== key;
    $$('#sideNav a').forEach((a) => { if (a.dataset.view === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $('#topTitle').textContent = TITLES[name];
    document.title = `${TITLES[name]} — Admin Bonaasina`;
    closeNav();
    if (isNewView) { window.bonaTrack?.(`/admin/${name}`, `Admin: ${TITLES[name]}`); trackView(name); }

    const draw = async () => {
      main.onclick = null; main.onchange = null;
      const y = isNewView ? 0 : scrollY;
      await view();
      shownView = key;
      if (isNewView) { main.classList.remove('is-in'); void main.offsetWidth; main.classList.add('is-in'); scrollTo(0, 0); } else scrollTo(0, y);
    };
    const fail = (ex) => { if (seq === routeSeq && ex.message !== 'Silakan masuk dulu.') main.innerHTML = `<div class="empty">${esc(ex.message)}</div>`; };

    // 1) Gambar langsung dari cache bila ada (kecuali tepat setelah data diubah).
    const cached = !fresh && paths.every((p) => store.has(p));
    // Pindah ke menu yang datanya belum ada: layar muat penuh sampai tampilan tujuan siap.
    const blocking = !cached && isNewView;
    if (cached) { try { await draw(); } catch (ex) { fail(ex); } }
    else if (isNewView) { main.innerHTML = skeleton(); BonaLoader.show(`Memuat ${TITLES[name].toLowerCase()}…`); }
    else progress(true);
    renderBadges();

    // 2) Ambil data terbaru; gambar ulang hanya bila berubah dan pengguna tidak sedang mengisi sesuatu.
    const need = paths.filter((p) => !(cached && isFresh(p, 5000)));
    if (!need.length) return;
    progress(true);
    try {
      const results = await Promise.all(need.map(fetchFresh));
      if (seq !== routeSeq) return;
      const changed = !cached || results.some((r) => r.changed);
      const busy = dlg.open || (main.contains(document.activeElement) && document.activeElement.matches('input:not(.search), textarea'));
      if (changed && busy && dlg.open) dlg.dataset.refresh = '1';
      else if (changed && !busy) await draw();
    } catch (ex) {
      // Data cache boleh tetap tampil, tetapi kegagalan menyegarkan tidak boleh hilang tanpa kabar.
      if (!cached) fail(ex); else toast(ex.message, true);
    }
    finally { if (seq === routeSeq) progress(false); if (blocking) BonaLoader.hide(); }
    refreshBadges();
  }
  addEventListener('hashchange', () => route());

  // Ambil data semua menu di latar belakang setelah masuk, supaya klik pertama ke tiap menu juga instan.
  async function prefetchAll() {
    const list = [...new Set(Object.keys(views).flatMap((n) => deps(n)))].filter((p) => !store.has(p));
    for (let i = 0; i < list.length; i += 3) {
      await Promise.all(list.slice(i, i + 3).map((p) => fetchFresh(p).catch(() => {})));
    }
  }
  // Arahkan kursor/jari ke menu → mulai ambil datanya lebih dulu.
  const warm = (e) => { const a = e.target.closest('#sideNav a'); if (!a) return; deps(a.dataset.view).filter((p) => !isFresh(p)).forEach((p) => fetchFresh(p).catch(() => {})); };
  $('#sideNav').addEventListener('pointerenter', warm, true);
  $('#sideNav').addEventListener('touchstart', warm, { passive: true, capture: true });

  // Catat menu yang dibuka (paling sering sekali per 15 menit per menu).
  const viewLogged = {};
  function trackView(name) {
    if (Date.now() - (viewLogged[name] || 0) < 15 * 60e3) return;
    viewLogged[name] = Date.now();
    rawFetch('POST', '/activity/view', { view: name, label: TITLES[name] }).catch(() => {});
  }

  function progress(on) { $('#progress').classList.toggle('is-on', on); }
  function skeleton() {
    return `<div class="skeleton" aria-busy="true" aria-label="Memuat"><div class="sk sk--title"></div><div class="sk sk--line"></div>
      <div class="grid grid--stats" style="margin-top:22px">${'<div class="sk sk--card"></div>'.repeat(4)}</div><div class="sk sk--table"></div></div>`;
  }

  function renderBadges() {
    const s = store.get('/summary')?.data; if (!s) return;
    const set = (id, n) => { const b = $(id); b.textContent = n; b.hidden = !n; };
    set('#badgeTagihan', s.overdue + s.proofsPending); set('#badgeSurvei', s.newSurveys); set('#badgeKerusakan', s.openIssues);
    set('#badgeKontrak', (s.contractsEnding || 0) + (s.contractDecisions || 0)); set('#badgeTunggu', s.waitlistToNotify || 0);
    const m = s.market || {};
    set('#badgeRes', (m.leadsNew || 0)); set('#badgeAppr', (m.approvals || 0) + (m.refunds || 0) + (m.feeToReturn || 0)); set('#badgeMitra', m.partnersPending || 0); set('#badgeDaftar', m.applications || 0); set('#badgeNotif', m.notifUnread || 0);
    const cm = s.community || {}; set('#badgeTitip', cm.listingsNew || 0); set('#badgeTempat', cm.placesSuggested || 0);
    const total = s.overdue + s.proofsPending + s.newSurveys + s.openIssues + (s.contractsEnding || 0) + (s.contractDecisions || 0) + (s.waitlistToNotify || 0) + (m.leadsNew || 0) + (m.approvals || 0) + (m.refunds || 0) + (m.partnersPending || 0) + (m.applications || 0) + (s.community?.listingsNew || 0) + (s.community?.placesSuggested || 0);
    $('#navDot').hidden = !total;
  }
  async function refreshBadges() {
    if (isFresh('/summary')) return renderBadges();
    try { await fetchFresh('/summary'); renderBadges(); } catch { /* abaikan */ }
  }

  // ---------- menu di layar kecil ----------
  const nav = $('#side');
  function openNav() { nav.classList.add('is-open'); $('#navScrim').hidden = false; $('#menuBtn').setAttribute('aria-expanded', 'true'); document.body.classList.add('nav-open'); }
  function closeNav() { nav.classList.remove('is-open'); $('#navScrim').hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); document.body.classList.remove('nav-open'); }
  $('#menuBtn').addEventListener('click', () => (nav.classList.contains('is-open') ? closeNav() : openNav()));
  $('#navScrim').addEventListener('click', closeNav);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('is-open')) closeNav(); });
  const propName = (id) => cache.allProps.find((p) => p.id === id)?.name || '-';
  const head = (title, sub, actions = '') => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="actions">${actions}</div></div>`;

  // ========== RINGKASAN ==========
  async function ringkasan() {
    const D = window.BonaDash;
    const [s, inv, rep] = await Promise.all([get('/summary'), get('/invoices'), get(`/reports?year=${new Date().getFullYear()}`).catch(() => null)]);
    const overdue = inv.filter((i) => i.status === 'belum' && i.overdue).slice(0, 6);
    const soon = inv.filter((i) => i.status === 'belum' && !i.overdue).slice(0, 6);
    const proofs = inv.filter((i) => i.status === 'belum' && i.proofStatus === 'menunggu');
    const sample = s.isSample ? `<div class="notice"><p><strong>Kamar, harga, deskripsi, nomor WhatsApp, dan rekening masih contoh.</strong> Perbarui di menu Kamar & kos dan Pengaturan sebelum website dibagikan ke calon penyewa.</p><button class="btn btn--sm" id="clearSample">Sudah saya perbarui</button></div>` : '';
    const sum = (k) => s.perProperty.reduce((a, p) => a + (p[k] || 0), 0);
    const tot = sum('total'), filled = sum('terisi');
    const occPct = tot ? Math.round((filled / tot) * 100) : 0;
    const donut = D.donut([
      { label: 'Terisi', value: filled, color: 'var(--ink)' }, { label: 'Dipesan', value: sum('dipesan'), color: '#C99A3B' },
      { label: 'Kosong', value: sum('kosong'), color: 'var(--green)' }, { label: 'Perbaikan', value: sum('perbaikan'), color: 'var(--red)' },
    ], { value: `${occPct}%`, label: 'terisi' });
    const perProp = s.perProperty.map((p) => `<div class="occ__row"><div class="occ__top"><strong>${esc(p.name)}</strong><span>${p.terisi} dari ${p.total} terisi${p.kosong ? `, <b style="color:var(--green)">${p.kosong} kosong</b>` : ''}</span></div>
        <div class="meter"><i data-w="${p.total ? (p.terisi / p.total) * 100 : 0}"></i></div></div>`).join('');
    const m0 = new Date().getMonth();
    const months = rep ? rep.months.map((m, i) => ({ ...m, i })).slice(Math.max(0, m0 - 5), m0 + 1) : [];
    const income = months.some((m) => m.income) ? D.colbars(months.map((m) => ({ label: BULAN[m.i], value: m.income, text: rp(m.income), short: m.income ? D.short(m.income) : '–', now: m.i === m0 })), 'Uang masuk per bulan') : '<div class="empty empty--calm">Belum ada pembayaran tercatat dalam 6 bulan terakhir. Grafik akan terisi setelah tagihan ditandai lunas.</div>';
    const mk = s.market || {};
    const check = s.proofsPending + s.openIssues + s.newSurveys;
    const invRows = (list, emptyText) => list.length ? `<table><tbody>${list.map((i) => `<tr>
        <td data-label="Penghuni"><div class="who-cell">${D.avatar(i.tenantName)}<div><strong>${esc(i.tenantName)}</strong><span class="sub">${esc(i.roomCode)}, ${esc(i.periodLabel)}</span></div></div></td>
        <td data-label="Jatuh tempo" class="nowrap">${tgl(i.dueDate)}${i.overdue ? `<span class="sub" style="color:var(--red)">lewat ${i.overdueDays} hari</span>` : ''}</td>
        <td class="num" data-label="Jumlah"><strong>${rp(i.amount)}</strong></td>
        <td class="actions"><button class="btn btn--ghost btn--sm btn--wa" data-remind="${i.id}" title="Kirim pengingat lewat WhatsApp">${D.ico('wa')}Ingatkan</button><button class="btn btn--ghost btn--sm" data-pay="${i.id}">Tandai lunas</button></td></tr>`).join('')}</tbody></table>` : `<div class="empty empty--calm">${emptyText}</div>`;
    const todoCount = todoItems(s).reduce((a, [n]) => a + n, 0);
    main.innerHTML = `
      <section class="hello">
        <div><p class="hello__kicker">${D.longDate(s.today)}</p>
          <h1>${D.greet()}, ${esc((cache.settings?.ownerName || 'Admin').split(' ')[0])}.</h1>
          <p>${todoCount ? `Ada <strong>${todoCount} hal</strong> yang menunggu Anda hari ini${s.overdue ? `, termasuk <strong>${s.overdue} tagihan telat</strong>` : ''}.` : 'Semua beres hari ini. Tidak ada yang mendesak.'}${s.newInvoices ? ` ${s.newInvoices} tagihan baru dibuat otomatis.` : ''}</p></div>
        <div class="hello__actions"><a class="btn btn--ghost" href="/" target="_blank" rel="noopener">Lihat website</a><a class="btn btn--light" href="#tagihan">Buka tagihan</a></div>
      </section>${sample}
      <div class="grid grid--stats grid--hero">
        <a class="panel stat stat--green stat--link" href="#laporan"><p class="stat__label">Uang masuk bulan ini</p><span class="stat__ico">${D.ico('wallet')}</span><p class="stat__value" data-count="${s.incomeThisMonth}" data-fmt="rp">${rp(s.incomeThisMonth)}</p><p class="stat__sub">Pengeluaran ${rp(s.expensesThisMonth)}</p>${rep && rep.months.some((m) => m.income) ? D.spark(rep.months.slice(0, m0 + 1).map((m) => m.income)) : ''}</a>
        <a class="panel stat stat--red stat--link ${s.overdue ? 'stat--alert' : ''}" href="#tagihan"><p class="stat__label">Tunggakan</p><span class="stat__ico">${D.ico('alarm')}</span><p class="stat__value" data-count="${s.overdueAmount}" data-fmt="rp">${rp(s.overdueAmount)}</p><p class="stat__sub">${s.overdue ? `${s.overdue} tagihan lewat jatuh tempo` : 'Tidak ada yang telat'}</p></a>
        <a class="panel stat stat--amber stat--link" href="#tagihan"><p class="stat__label">Jatuh tempo ${cache.settings?.invoiceLeadDays ?? 7} hari lagi</p><span class="stat__ico">${D.ico('calendar')}</span><p class="stat__value" data-count="${s.dueSoonAmount}" data-fmt="rp">${rp(s.dueSoonAmount)}</p><p class="stat__sub">${s.dueSoon} tagihan</p></a>
        <div class="panel stat stat--blue ${check ? 'stat--alert' : ''}"><p class="stat__label">Perlu dicek</p><span class="stat__ico">${D.ico('inbox')}</span><p class="stat__value" data-count="${check}">${check}</p><p class="stat__sub"><a href="#tagihan">${s.proofsPending} bukti bayar</a>, <a href="#kerusakan">${s.openIssues} kerusakan</a>, <a href="#survei">${s.newSurveys} survei</a></p></div>
      </div>
      <div class="dash-split mt">
        <div class="panel"><h2>Uang masuk 6 bulan terakhir <a class="small" href="#laporan">Laporan lengkap</a></h2>${income}</div>
        <div class="panel"><h2>Hunian kamar <a class="small" href="#kamar">Kelola kamar</a></h2>${donut}<div class="occ mt">${perProp}</div></div>
      </div>
      ${todoPanel(s)}
      ${proofs.length ? `<div class="panel mt"><h2>Bukti bayar menunggu dicek</h2><table><tbody>${proofs.map((i) => `<tr>
        <td data-label="Penghuni"><div class="who-cell">${D.avatar(i.tenantName)}<div><strong>${esc(i.tenantName)}</strong><span class="sub">${esc(i.roomCode)}, ${esc(i.periodLabel)}</span></div></div></td>
        <td data-label="Dikirim" class="nowrap">${tgl(i.proofUploadedAt)}</td>
        <td class="num" data-label="Jumlah">${rp(i.amount)}</td>
        <td class="actions"><button class="btn btn--red btn--sm" data-proof="${i.id}">Cek bukti</button></td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="panel mt"><h2>Perlu ditagih sekarang <a class="small" href="#tagihan">Semua tagihan</a></h2>${invRows(overdue, 'Tidak ada tunggakan. Semua penghuni membayar tepat waktu.')}</div>
      <div class="panel mt"><h2>Akan jatuh tempo</h2>${invRows(soon, 'Belum ada tagihan yang akan jatuh tempo dalam waktu dekat.')}</div>
      <div class="panel mt"><h2>Kos Sekitar &amp; komunitas <a class="small" href="#reservasi">Semua reservasi</a></h2>
        <div class="mini-stats">
          <a href="#reservasi"><span class="stat__ico" style="--tint:var(--amber-50);--tone:var(--amber)">${D.ico('calendar')}</span><b>${mk.leadsNew || 0}</b><span>reservasi baru</span></a>
          <a href="#persetujuan"><span class="stat__ico" style="--tint:var(--blue-50);--tone:var(--blue)">${D.ico('check')}</span><b>${(mk.approvals || 0) + (mk.refunds || 0)}</b><span>perlu disetujui</span></a>
          <a href="#daftar"><span class="stat__ico" style="--tint:var(--red-50);--tone:var(--red)">${D.ico('people')}</span><b>${mk.applications || 0}</b><span>pendaftaran mitra</span></a>
          <a href="#mitra"><span class="stat__ico" style="--tint:var(--green-50);--tone:var(--green)">${D.ico('home')}</span><b>${mk.partnersPending || 0}</b><span>kos minta tampil</span></a>
          <a href="#titip"><span class="stat__ico" style="--tint:var(--amber-50);--tone:var(--amber)">${D.ico('bag')}</span><b>${s.community?.listingsNew || 0}</b><span>titip jualan baru</span></a>
          <a href="#tempat"><span class="stat__ico" style="--tint:var(--blue-50);--tone:var(--blue)">${D.ico('pin')}</span><b>${s.community?.placesSuggested || 0}</b><span>usulan tempat</span></a>
        </div></div>`;
    D.sideWidget(`<small>Kamar terisi</small><strong>${filled}<span>dari ${tot}</span></strong><div class="meter"><i data-w="${occPct}"></i></div><small>${sum('kosong')} kamar siap disewakan</small>`);
    $('#clearSample')?.addEventListener('click', async () => {
      if (!(await askConfirm('Data sudah diperbarui?', 'Pengingat ini akan disembunyikan. Pastikan harga, nomor WhatsApp, dan rekening sudah benar.', 'Ya, sembunyikan'))) return;
      cache.settings = await api('PUT', '/settings', { isSample: false }); toast('Pengingat disembunyikan.'); route();
    });
    bindInvoiceActions(inv);
  }

  function todoItems(s) {
    return [
      [s.proofsPending, '#tagihan', 'bukti bayar menunggu dicek', true],
      [s.contractDecisions, '#kontrak', 'penghuni memilih perpanjang atau berhenti', true],
      [s.waitlistToNotify, '#tunggu', 'calon penyewa perlu dikabari, ada kamar kosong', true],
      [s.contractsEnding, '#kontrak', 'kontrak berakhir dalam 30 hari tanpa keputusan', false],
      [s.contractsPending, '#kontrak', 'kontrak menunggu persetujuan penghuni', false],
      [s.tenantsWithoutContract, '#penghuni', 'penghuni aktif belum punya kontrak', false],
      [s.newSurveys, '#survei', 'permintaan survei baru', false],
      [s.openIssues, '#kerusakan', 'laporan kerusakan terbuka', false],
      [s.market?.approvals, '#persetujuan', 'transaksi Kos Sekitar menunggu persetujuan', true],
      [s.market?.refunds, '#persetujuan', 'refund perlu dipantau', true],
      [s.market?.noResponse, '#reservasi', 'reservasi belum direspons pemilik', true],
      [s.market?.leadsNew, '#reservasi', 'reservasi baru (semua kos)', false],
      [s.market?.feeOverdue, '#fee', 'fee pemilik lewat batas bayar', false],
      [s.market?.applications, '#daftar', 'pendaftaran mitra baru menunggu ditinjau', true],
      [s.market?.partnersPending, '#mitra', 'kos mitra minta ditampilkan di website', true],
      [s.market?.feeToReturn, '#persetujuan', 'fee perlu dikembalikan ke pemilik (refund)', false],
      [s.community?.listingsNew, '#titip', 'titip jualan/jasa baru menunggu dicek', true],
      [s.community?.placesSuggested, '#tempat', 'usulan tempat sekitar menunggu dicek', false],
    ].filter(([n]) => n);
  }
  function todoPanel(s) {
    const items = todoItems(s);
    return `<div class="panel mt"><h2>Perlu tindakan</h2>${items.length ? `<div class="todo">${items.map(([n, href, text, urgent]) => `<a href="${href}" class="${urgent ? 'is-urgent' : ''}"><span class="count">${n}</span><span>${text}</span></a>`).join('')}</div>` : '<p class="empty--ok">Semua beres. Tidak ada yang perlu ditindaklanjuti.</p>'}</div>`;
  }

  // ---------- aksi tagihan (dipakai di beberapa halaman) ----------
  function bindInvoiceActions(list) {
    main.onclick = async (e) => {
      const r = e.target.closest('[data-remind]'), p = e.target.closest('[data-pay]'), u = e.target.closest('[data-unpay]'), x = e.target.closest('[data-del-inv]'), pf = e.target.closest('[data-proof]');
      const kw = e.target.closest('[data-receipt]');
      if (kw) { const inv = list.find((i) => i.id === kw.dataset.receipt); download(`/invoices/${inv.id}/receipt.pdf`, `kuitansi-${safeName(inv.tenantName)}-${safeName(inv.periodLabel)}.pdf`); }
      if (pf) {
        const inv = list.find((i) => i.id === pf.dataset.proof);
        try {
          const { url } = await api('GET', `/file?path=${encodeURIComponent(inv.proofPath)}`);
          openDialog({
            title: 'Cek bukti bayar', ok: 'Terima & tandai lunas', okClass: 'btn--green',
            body: `<p class="muted">${esc(inv.tenantName)}, kamar ${esc(inv.roomCode)}, ${esc(inv.periodLabel)}. Tagihan <strong>${rp(inv.amount)}</strong>. Dikirim ${tgl(inv.proofUploadedAt)}.</p>
              <a href="${esc(url)}" target="_blank" rel="noopener" class="proof-img"><img src="${esc(url)}" alt="Bukti bayar ${esc(inv.tenantName)}"></a>
              <p class="hint">Cocokkan nominal dan nama pengirim dengan mutasi rekening sebelum menerima.</p>
              <div class="fields fields--2 mt">
                <label>Tanggal uang masuk<input type="date" name="paidAt" value="${today()}" max="${today()}"></label>
                <label>Jumlah diterima<input type="number" name="paidAmount" value="${inv.amount}" min="0" step="1000"></label>
                <label>Cara bayar<select name="method"><option value="transfer">Transfer bank</option><option value="qris">QRIS</option><option value="lainnya">Lainnya</option></select></label>
              </div>
              <details class="reject"><summary>Tolak bukti ini</summary>
                <label class="mt">Alasan (tampil di dashboard penghuni)<input id="rejectNote" placeholder="Contoh: nominal kurang Rp50.000"></label>
                <button type="button" class="btn btn--ghost btn--sm mt" id="rejectBtn">Tolak bukti</button></details>`,
            onOpen: (b) => {
              $('#rejectBtn', b).onclick = async () => {
                try { await api('POST', `/invoices/${inv.id}/reject-proof`, { note: $('#rejectNote', b).value }); dlg.close(); toast('Bukti ditolak. Penghuni akan melihat alasannya di dashboard.'); route(); }
                catch (ex) { $('#dlgErr').textContent = ex.message; $('#dlgErr').hidden = false; }
              };
            },
            onOk: async (d) => { const out = await api('POST', `/invoices/${inv.id}/pay`, d); toast(`Bukti diterima. Kuitansi ${out.receiptNo} terbit di dashboard ${inv.tenantName}.`); route(); },
          });
        } catch (ex) { toast(ex.message, true); }
      }
      if (r) {
        // Tampilkan pesan dulu supaya pemilik bisa memeriksa, lalu buka WhatsApp lewat tautan biasa.
        try {
          const out = await api('GET', `/invoices/${r.dataset.remind}/reminder?site=${encodeURIComponent(location.origin)}`);
          openDialog({
            title: out.url ? 'Pengingat WhatsApp' : 'Pengingat email',
            body: `${out.emailedTo ? `<p class="muted">Pengingat email juga dikirim otomatis ke ${esc(out.emailedTo)} (sekali per hari).</p>` : ''}
              ${out.url ? '<p class="muted">Periksa pesannya, lalu tekan Buka WhatsApp dan kirim dari sana.</p>' : ''}
              <div class="preview" id="remText">${esc(out.text)}</div>
              <div class="btn-row mt">
                ${out.url ? `<a class="btn btn--green" href="${esc(out.url)}" target="_blank" rel="noopener">Buka WhatsApp</a>` : ''}
                <button type="button" class="btn btn--ghost" id="remCopy">Salin pesan</button></div>`,
            onOpen: (b) => { $('#remCopy', b).onclick = () => copyText($('#remText', b)); },
          });
        } catch (ex) { toast(ex.message, true); }
      }
      if (p) {
        const inv = list.find((i) => i.id === p.dataset.pay);
        openDialog({
          title: 'Tandai lunas', ok: 'Tandai lunas', okClass: 'btn--green',
          body: `<p class="muted">${esc(inv.tenantName)}, kamar ${esc(inv.roomCode)}, ${esc(inv.periodLabel)}. Tagihan ${rp(inv.amount)}.</p>
            <div class="fields fields--2 mt">
              <label>Tanggal bayar<input type="date" name="paidAt" value="${today()}" max="${today()}"></label>
              <label>Jumlah dibayar<input type="number" name="paidAmount" value="${inv.amount}" min="0" step="1000"></label>
              <label>Cara bayar<select name="method"><option value="transfer">Transfer bank</option><option value="qris">QRIS</option><option value="tunai">Tunai</option><option value="lainnya">Lainnya</option></select></label>
              <label>Catatan <span class="hint">opsional</span><input name="note" value="${esc(inv.note || '')}"></label>
            </div>`,
          onOk: async (d) => { const out = await api('POST', `/invoices/${inv.id}/pay`, d); toast(`Tagihan ${inv.tenantName} lunas. Kuitansi ${out.receiptNo} dibuat.`); route(); },
        });
      }
      if (u) {
        if (!(await askConfirm('Batalkan lunas', 'Tagihan ini akan kembali berstatus belum bayar.', 'Batalkan lunas'))) return;
        await api('POST', `/invoices/${u.dataset.unpay}/unpay`); toast('Status lunas dibatalkan.'); route();
      }
      if (x) {
        if (!(await askConfirm('Hapus tagihan', 'Tagihan otomatis untuk periode yang sama tidak akan dibuat ulang.', 'Hapus tagihan'))) return;
        await api('DELETE', `/invoices/${x.dataset.delInv}`); toast('Tagihan dihapus.'); route();
      }
    };
  }

  // ========== TAGIHAN ==========
  let invFilter = 'belum', invQuery = '';
  async function tagihan() {
    const [inv, tenants] = await Promise.all([get('/invoices'), get('/tenants')]);
    const counts = { bukti: inv.filter((i) => i.status === 'belum' && i.proofStatus === 'menunggu').length, belum: inv.filter((i) => i.status === 'belum').length, terlambat: inv.filter((i) => i.overdue).length, lunas: inv.filter((i) => i.status === 'lunas').length, semua: inv.length };
    if (invFilter === 'belum' && counts.bukti && !tagihan.visited) invFilter = 'bukti';
    tagihan.visited = true;
    const draw = () => {
      let list = inv;
      if (invFilter === 'belum') list = list.filter((i) => i.status === 'belum');
      if (invFilter === 'bukti') list = list.filter((i) => i.status === 'belum' && i.proofStatus === 'menunggu');
      if (invFilter === 'terlambat') list = list.filter((i) => i.overdue);
      if (invFilter === 'lunas') list = list.filter((i) => i.status === 'lunas').sort((a, b) => (b.paidAt || '').localeCompare(a.paidAt || ''));
      const q = invQuery.toLowerCase();
      if (q) list = list.filter((i) => `${i.tenantName} ${i.roomCode} ${i.periodLabel}`.toLowerCase().includes(q));
      $('#invTable').innerHTML = list.length ? `<table><thead><tr><th>Penghuni</th><th>Periode</th><th>Jatuh tempo</th><th class="num">Jumlah</th><th>Status</th><th></th></tr></thead><tbody>${list.map((i) => `<tr>
        <td data-label="Penghuni"><div class="who-cell">${window.BonaDash.avatar(i.tenantName)}<div><strong>${esc(i.tenantName)}</strong><span class="sub">Kamar ${esc(i.roomCode)}, ${esc(propName(i.propertyId))}</span></div></div></td>
        <td data-label="Periode">${esc(i.periodLabel)}${i.cycle !== 'bulanan' && CYCLE_NAME[i.cycle] ? `<span class="sub">Sewa ${CYCLE_NAME[i.cycle].toLowerCase()}</span>` : ''}</td>
        <td data-label="Jatuh tempo">${tgl(i.dueDate)}${i.overdue ? `<span class="sub" style="color:var(--red)">lewat ${i.overdueDays} hari</span>` : ''}${i.lastRemindedAt ? `<span class="sub">Diingatkan ${tgl(i.lastRemindedAt)}</span>` : ''}</td>
        <td class="num" data-label="Jumlah">${rp(i.amount)}${i.status === 'lunas' && i.paidAmount !== i.amount ? `<span class="sub">dibayar ${rp(i.paidAmount)}</span>` : ''}</td>
        <td data-label="Status">${i.status === 'lunas' ? `<span class="pill pill--lunas">Lunas ${tgl(i.paidAt)}</span>` : i.proofStatus === 'menunggu' ? '<span class="pill pill--dikonfirmasi">Bukti dikirim</span>' : i.overdue ? '<span class="pill pill--terlambat">Terlambat</span>' : '<span class="pill pill--belum">Belum bayar</span>'}${i.proofStatus === 'ditolak' && i.status === 'belum' ? `<span class="sub">Bukti ditolak: ${esc(i.proofNote)}</span>` : ''}</td>
        <td class="actions">${i.status === 'belum'
          ? (i.proofStatus === 'menunggu' ? `<button class="btn btn--red btn--sm" data-proof="${i.id}">Cek bukti</button>` : `<button class="btn btn--ghost btn--sm btn--wa" data-remind="${i.id}" title="Kirim pengingat lewat WhatsApp">${window.BonaDash.ico('wa')}Ingatkan</button>`) + `<button class="btn btn--ghost btn--sm" data-pay="${i.id}">Tandai lunas</button>`
          : `<button class="btn btn--ghost btn--sm" data-receipt="${i.id}">Kuitansi</button><button class="btn btn--ghost btn--sm" data-unpay="${i.id}">Batalkan lunas</button>`}</td></tr>`).join('')}</tbody></table>`
        : `<div class="empty">${invFilter === 'terlambat' ? 'Tidak ada tagihan terlambat.' : 'Tidak ada tagihan untuk pilihan ini.'}</div>`;
    };
    main.innerHTML = head('Tagihan', 'Tagihan sewa dibuat otomatis dari tanggal mulai sewa setiap penghuni.', '<button class="btn btn--red" id="addInv">Tagihan tambahan</button>') + `
      <div class="toolbar">
        <div class="seg" id="invSeg">${[['bukti', 'Bukti masuk'], ['belum', 'Belum bayar'], ['terlambat', 'Terlambat'], ['lunas', 'Lunas'], ['semua', 'Semua']].map(([k, l]) => `<button aria-pressed="${invFilter === k}" data-k="${k}">${l} (${counts[k]})</button>`).join('')}</div>
        <input class="search" type="search" placeholder="Cari nama, kamar, atau periode" value="${esc(invQuery)}" id="invSearch" aria-label="Cari tagihan">
      </div>
      <div class="table-wrap" id="invTable"></div>`;
    draw();
    $('#invSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; invFilter = b.dataset.k; $$('#invSeg button').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(); };
    $('#invSearch').oninput = (e) => { invQuery = e.target.value; draw(); };
    bindInvoiceActions(inv);
    $('#addInv').onclick = () => {
      const active = tenants.filter((t) => t.status === 'aktif');
      if (!active.length) return toast('Tambahkan penghuni dulu.', true);
      openDialog({
        title: 'Tagihan tambahan', ok: 'Buat tagihan',
        body: `<p class="muted">Untuk biaya di luar sewa, misalnya listrik tambahan, denda keterlambatan, atau ganti kerusakan.</p>
          <div class="fields fields--2 mt">
            <label class="span-all">Penghuni<select name="tenantId">${active.map((t) => `<option value="${t.id}">${esc(t.name)} (${esc(t.room?.code || '-')})</option>`).join('')}</select></label>
            <label class="span-all">Keterangan<input name="label" placeholder="Contoh: Denda telat bayar September" required></label>
            <label>Jumlah<input type="number" name="amount" min="0" step="1000" required></label>
            <label>Jatuh tempo<input type="date" name="dueDate" value="${today()}"></label>
          </div>`,
        onOk: async (d) => { await api('POST', '/invoices', d); toast('Tagihan tambahan dibuat.'); route(); },
      });
    };
  }

  // ========== PENGHUNI ==========
  let tenantFilter = 'aktif';
  async function penghuni() {
    const id = hashParams().get('id');
    if (id) return penghuniDetail(id);
    const [tenants, rooms] = await Promise.all([get('/tenants'), get('/rooms')]);
    const draw = () => {
      const list = tenants.filter((t) => tenantFilter === 'semua' || t.status === tenantFilter);
      $('#tnTable').innerHTML = list.length ? `<table><thead><tr><th>Nama</th><th>Kamar</th><th>Sewa</th><th>Mulai</th><th>Akun</th><th>Tagihan</th><th></th></tr></thead><tbody>${list.map((t) => `<tr>
        <td data-label="Nama"><div class="who-cell">${window.BonaDash.avatar(t.name)}<div><a href="#penghuni?id=${t.id}"><strong>${esc(t.name)}</strong></a><span class="sub">${esc(t.phone || 'Belum ada nomor WA')}${t.occupation ? `, ${esc(t.occupation)}` : ''}</span></div></div></td>
        <td data-label="Kamar">${esc(t.room?.code || '-')}<span class="sub">${esc(propName(t.room?.propertyId))}</span></td>
        <td data-label="Sewa">${rp(t.rentAmount)}<span class="sub">per ${cycleWord(t.rentCycle)}${t.coName ? ', 2 orang' : ''}</span></td>
        <td data-label="Mulai">${tgl(t.startDate)}${t.endDate ? `<span class="sub">${t.status === 'keluar' ? 'Keluar' : 'Sampai'} ${tgl(t.endDate)}</span>` : ''}</td>
        <td data-label="Akun">${t.username ? `<span class="pill pill--${t.loginEnabled && t.status === 'aktif' ? 'aktif' : 'nonaktif'}">${esc(t.username)}</span>` : '<span class="pill pill--nonaktif">Belum ada</span>'}</td>
        <td data-label="Tagihan">${t.status !== 'aktif' ? `<span class="pill pill--keluar">Sudah keluar</span>` : t.unpaidCount ? `<span class="pill ${t.overdue ? 'pill--terlambat' : 'pill--belum'}">${t.unpaidCount} belum bayar, ${rp(t.unpaidAmount)}</span>` : '<span class="pill pill--lunas">Lunas semua</span>'}</td>
        <td class="actions"><a class="btn btn--ghost btn--sm" href="#penghuni?id=${t.id}">Detail</a>${t.status === 'aktif' && !t.username ? `<button class="btn btn--green btn--sm" data-acc="${t.id}">Buat akun</button>` : ''}<button class="btn btn--ghost btn--sm" data-edit="${t.id}">Ubah</button></td></tr>`).join('')}</tbody></table>`
        : `<div class="empty">${tenantFilter === 'aktif' ? 'Belum ada penghuni aktif.' : 'Tidak ada data.'}<br><button class="btn btn--red" data-add>Tambah penghuni</button></div>`;
    };
    main.innerHTML = head('Penghuni', `${tenants.filter((t) => t.status === 'aktif').length} penghuni aktif. Buka detail untuk akun login, kontrak, kondisi kamar, dan kartu penghuni.`, '<button class="btn btn--red" data-add>Tambah penghuni</button>') + `
      <div class="toolbar"><div class="seg" id="tnSeg">${[['aktif', 'Aktif'], ['keluar', 'Sudah keluar'], ['semua', 'Semua']].map(([k, l]) => `<button aria-pressed="${tenantFilter === k}" data-k="${k}">${l}</button>`).join('')}</div></div>
      <div class="table-wrap" id="tnTable"></div>`;
    draw();
    $('#tnSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; tenantFilter = b.dataset.k; $$('#tnSeg button').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(); };
    main.onclick = (e) => {
      if (e.target.closest('[data-add]')) tenantDialog(null, rooms);
      const ed = e.target.closest('[data-edit]'); if (ed) tenantDialog(tenants.find((t) => t.id === ed.dataset.edit), rooms);
      const ac = e.target.closest('[data-acc]'); if (ac) accountDialog(tenants.find((t) => t.id === ac.dataset.acc));
    };
  }
  function tenantDialog(t, rooms, pre = {}) {
    const isNew = !t;
    const free = rooms.filter((r) => r.effectiveStatus !== 'terisi' || (t && r.id === t.roomId));
    const opts = cache.properties.map((p) => `<optgroup label="${esc(p.name)}">${free.filter((r) => r.propertyId === p.id).map((r) => `<option value="${r.id}" data-harian="${r.priceDaily || 0}" data-bulanan="${r.priceMonthly}" data-semesteran="${r.priceSemester || 0}" data-tahunan="${r.priceYearly}" data-cap="${r.capacity || 1}" ${t?.roomId === r.id ? 'selected' : ''}>${esc(r.code)}, ${esc(r.type)}${r.effectiveStatus !== 'kosong' && r.id !== t?.roomId ? ` (${STATUS_KAMAR[r.effectiveStatus]})` : ''}</option>`).join('')}</optgroup>`).join('');
    const v = (k) => esc(t?.[k] ?? pre[k] ?? '');
    openDialog({
      title: isNew ? (pre.leadId ? `Jadikan penghuni: ${pre.name}` : 'Tambah penghuni') : `Ubah data ${t.name}`, ok: isNew ? 'Tambah penghuni' : 'Simpan perubahan',
      body: `<div class="fields fields--2">
          <p class="fieldset-title span-all">Data penghuni</p>
          <label>Nama lengkap<input name="name" value="${v('name')}" required></label>
          <label>Nomor WhatsApp<input name="phone" inputmode="tel" value="${v('phone')}" placeholder="0812…"></label>
          <label>Email <span class="hint">opsional, untuk kabar tagihan & kontrak</span><input name="email" type="email" inputmode="email" value="${v('email')}" placeholder="nama@gmail.com"></label>
          <label>Pekerjaan / kampus<input name="occupation" value="${v('occupation')}"></label>
          <label>Asal daerah<input name="origin" value="${v('origin')}"></label>
          <p class="fieldset-title span-all">Sewa</p>
          <label>Kamar<select name="roomId" id="tRoom">${opts}</select></label>
          <label>Jenis sewa<select name="rentCycle" id="tCycle">${Object.entries(CYCLE_NAME).map(([k, v]) => `<option value="${k}" ${(t?.rentCycle || pre.rentCycle || 'bulanan') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Harga sewa<input type="number" name="rentAmount" id="tAmount" value="${t?.rentAmount ?? ''}" min="0" step="1000"><span class="hint">Terisi otomatis dari harga kamar, bisa diubah.</span></label>
          <label>Deposit<input type="number" name="deposit" value="${t?.deposit ?? ''}" min="0" step="1000"></label>
          <label>Tanggal mulai sewa<input type="date" name="startDate" value="${v('startDate') || pre.startDate || today()}"><span class="hint">Jatuh tempo berikutnya mengikuti tanggal ini.</span></label>
          <label id="tEndWrap">Tanggal keluar <span class="hint">wajib untuk sewa harian</span><input type="date" name="endDate" value="${v('endDate') || pre.endDate || ''}"></label>
          <label>Tagih mulai <span class="hint">opsional</span><input type="date" name="billFrom" value="${v('billFrom')}"><span class="hint">Isi jika penghuni lama: tagihan sebelum tanggal ini dianggap sudah beres.</span></label>
          <p class="fieldset-title span-all t-co">Penghuni kedua <span class="hint">kamar untuk 2 orang</span></p>
          <label class="t-co">Nama<input name="coName" value="${v('coName')}"></label>
          <label class="t-co">Nomor WA<input name="coPhone" inputmode="tel" value="${v('coPhone')}"></label>
          <label class="t-co">Hubungan<input name="coRelation" value="${v('coRelation')}" placeholder="Saudara, teman, pasangan…"></label>
          <label class="t-co">Pekerjaan / kampus<input name="coOccupation" value="${v('coOccupation')}"></label>
          <p class="fieldset-title span-all">Kontak darurat</p>
          <label>Nama<input name="emergencyName" value="${v('emergencyName')}"></label>
          <label>Nomor<input name="emergencyPhone" inputmode="tel" value="${v('emergencyPhone')}"></label>
          <label>Hubungan<input name="emergencyRelation" value="${v('emergencyRelation')}" placeholder="Orang tua, saudara…"></label>
          <label class="span-all">Catatan<textarea name="note" rows="2">${v('note')}</textarea></label>
          ${isNew ? `<p class="fieldset-title span-all">Akun login dashboard</p>
          <label class="span-all"><input type="checkbox" name="makeAccount" id="tMake" checked>Buat akun supaya penghuni bisa masuk ke dashboard</label>
          <label class="t-acc">Username<input name="username" id="tUser" autocapitalize="none" spellcheck="false" autocomplete="off"><span class="hint">Huruf kecil, angka, titik, minus, atau garis bawah.</span></label>
          <label class="t-acc">Kata sandi<span class="pw-row"><input name="password" id="tPw" value="${genPassword()}" autocomplete="off"><button type="button" class="btn btn--ghost btn--sm" id="tPwGen">Buat acak</button></span><span class="hint">Minimal 8 karakter. Ditampilkan sekali untuk dikirim ke penghuni.</span></label>` : ''}
          <p class="hint span-all">Foto KTP sengaja tidak disimpan di sistem ini. Cukup periksa KTP saat penghuni masuk, sesuai prinsip UU Pelindungan Data Pribadi.</p>
        </div>`,
      onOpen: (body) => {
        const fill = () => {
          const o = $('#tRoom', body).selectedOptions[0]; if (!o) return;
          if (isNew || !$('#tAmount', body).dataset.touched) $('#tAmount', body).value = o.dataset[$('#tCycle', body).value] || '';
        };
        // Kolom orang kedua hanya untuk kamar berkapasitas 2; tanggal keluar wajib untuk harian.
        const syncCo = () => {
          const two = $('#tRoom', body).selectedOptions[0]?.dataset.cap === '2';
          $$('.t-co', body).forEach((el) => { el.hidden = !two; }); if (!two) $$('.t-co input', body).forEach((i) => { i.value = ''; });
          $('#tAmount', body).closest('label').querySelector('.hint').textContent = $('#tCycle', body).value === 'harian' ? 'Tarif per malam; tagihan = tarif × jumlah malam.' : 'Terisi otomatis dari harga kamar, bisa diubah.';
        };
        $('#tRoom', body).addEventListener('change', syncCo); $('#tCycle', body).addEventListener('change', syncCo); syncCo();
        $('#tAmount', body).addEventListener('input', (e) => { e.target.dataset.touched = 1; });
        if (!isNew) $('#tAmount', body).dataset.touched = 1;
        $('#tRoom', body).addEventListener('change', fill); $('#tCycle', body).addEventListener('change', () => { delete $('#tAmount', body).dataset.touched; fill(); });
        if (isNew) {
          fill();
          // Usulan username dari nama + kamar, selama belum diubah manual.
          const suggest = () => { const u = $('#tUser', body); if (!u.dataset.touched) u.value = suggestUsername($('[name=name]', body).value, $('#tRoom', body).selectedOptions[0]?.textContent.split(',')[0]); };
          $('#tUser', body).addEventListener('input', (e) => { e.target.dataset.touched = 1; });
          $('[name=name]', body).addEventListener('input', suggest); $('#tRoom', body).addEventListener('change', suggest); suggest();
          $('#tPwGen', body).onclick = () => { $('#tPw', body).value = genPassword(); };
          $('#tMake', body).onchange = (e) => $$('.t-acc', body).forEach((el) => { el.hidden = !e.target.checked; });
        }
      },
      onOk: async (d) => {
        if (!d.billFrom) d.billFrom = '';
        // Dikosongkan saat mengubah = hapus tanggalnya (null), bukan "tidak berubah".
        if (isNew && !d.endDate) delete d.endDate; else d.endDate = d.endDate || null;
        if (pre.leadId) d.leadId = pre.leadId;
        if (isNew) {
          const withAcc = d.makeAccount === 'on'; delete d.makeAccount;
          if (!withAcc) { delete d.username; delete d.password; } else d.username = (d.username || '').trim().toLowerCase();
          const rec = await api('POST', '/tenants', d);
          toast(`${d.name} ditambahkan. Tagihannya dibuat otomatis.`);
          if (withAcc) setTimeout(() => showCredentials(rec, d.username, d.password), 80);
        } else { await api('PUT', `/tenants/${t.id}`, d); toast('Perubahan disimpan.'); }
        route();
      },
    });
  }

  // ========== KAMAR & KOS ==========
  async function kamar() {
    const [allRooms, allProps] = await Promise.all([get('/rooms'), get('/properties')]);
    setProps(allProps); const props = cache.properties;
    const own = new Set(props.map((p) => p.id)); const rooms = allRooms.filter((r) => own.has(r.propertyId));
    main.innerHTML = head('Kamar & kos', 'Ubah status, harga, foto, dan informasi yang tampil di website.', '<button class="btn btn--red" data-add-room>Tambah kamar</button>') +
      `<div class="prop-cards">${props.map((p) => `<div class="panel prop-card"><div class="logo-box"><img src="${esc(p.logo)}" alt="Logo ${esc(p.name)}"></div><div style="flex:1"><strong>${esc(p.name)}</strong><p class="small muted">${esc(p.gender ? 'Kos ' + p.gender.toLowerCase() + ', ' : '')}${(p.photos || []).length} foto, ${p.mapsQuery ? 'peta sudah diatur' : 'peta belum diatur'}</p></div><button class="btn btn--ghost btn--sm" data-edit-prop="${p.id}">Ubah info kos</button></div>`).join('')}</div>` +
      props.map((p) => {
        const list = rooms.filter((r) => r.propertyId === p.id);
        return `<div class="room-head"><h2>${esc(p.name)}</h2><span class="muted small">${list.filter((r) => r.effectiveStatus === 'kosong').length} kosong dari ${list.length} kamar</span></div>
        <div class="table-wrap">${list.length ? `<table class="table--rooms"><colgroup><col style="width:10%"><col style="width:22%"><col style="width:12%"><col style="width:13%"><col style="width:15%"><col style="width:18%"><col style="width:10%"></colgroup><thead><tr><th>Kamar</th><th>Tipe</th><th class="num">Bulanan</th><th class="num">Tahunan</th><th>Status</th><th>Penghuni</th><th></th></tr></thead><tbody>${list.map((r) => `<tr>
          <td data-label="Kamar"><strong>${esc(r.code)}</strong>${r.hidden ? '<span class="sub">Disembunyikan dari website</span>' : ''}</td>
          <td data-label="Tipe">${esc(r.type)}<span class="sub">${[r.sizeM2, r.floor].filter(Boolean).map(esc).join(', ')}${(r.photos || []).length ? `, ${r.photos.length} foto` : ''}</span></td>
          <td class="num" data-label="Bulanan">${rp(r.priceMonthly)}</td>
          <td class="num" data-label="Tahunan">${rp(r.priceYearly)}</td>
          <td data-label="Status">${r.tenant ? '<span class="pill pill--terisi">Terisi</span>' : `<select class="inline" data-status="${r.id}" data-saved="${r.status}" aria-label="Status kamar ${esc(r.code)}">${['kosong', 'dipesan', 'perbaikan', 'terisi'].map((s) => `<option value="${s}" ${r.status === s ? 'selected' : ''}>${STATUS_KAMAR[s]}</option>`).join('')}</select>`}</td>
          <td data-label="Penghuni">${r.tenant ? esc(r.tenant.name) : '<span class="muted">-</span>'}</td>
          <td class="actions"><button class="btn btn--ghost btn--sm" data-edit-room="${r.id}">Ubah</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Belum ada kamar.</div>'}</div>`;
      }).join('');

    main.onchange = async (e) => {
      const s = e.target.closest('[data-status]'); if (!s) return;
      const saved = s.dataset.saved || s.value;
      try {
        await api('PUT', `/rooms/${s.dataset.status}`, { status: s.value });
        s.dataset.saved = s.value;
        toast('Status kamar diperbarui. Website ikut berubah.');
      } catch (ex) {
        // Server menolak: tampilkan lagi status yang benar-benar tersimpan.
        s.value = saved;
        toast(ex.message, true);
      }
    };
    main.onclick = (e) => {
      if (e.target.closest('[data-add-room]')) roomDialog(null);
      const er = e.target.closest('[data-edit-room]'); if (er) roomDialog(rooms.find((r) => r.id === er.dataset.editRoom));
      const ep = e.target.closest('[data-edit-prop]'); if (ep) propDialog(props.find((p) => p.id === ep.dataset.editProp));
    };
  }

  function photoField(name, photos) {
    return `<div class="span-all"><label>Foto <span class="hint">JPG/PNG/WebP, maks. 8 MB. Foto pertama tampil paling besar.</span></label>
      <div class="photos" data-photos="${name}">${photos.map((u) => `<figure><img src="${esc(u)}" alt=""><button type="button" data-rm="${esc(u)}" aria-label="Hapus foto">✕</button></figure>`).join('')}
      <label class="upload">+ Tambah foto<input type="file" accept="image/jpeg,image/png,image/webp" multiple></label></div>
      <input type="hidden" name="${name}" value="${esc(JSON.stringify(photos))}"></div>`;
  }
  function bindPhotos(body, name) {
    const wrap = $(`[data-photos="${name}"]`, body), hidden = $(`input[name="${name}"]`, body);
    const get = () => JSON.parse(hidden.value || '[]');
    const set = (arr) => { hidden.value = JSON.stringify(arr); };
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rm]'); if (!b) return;
      set(get().filter((u) => u !== b.dataset.rm)); b.closest('figure').remove();
    });
    $('input[type=file]', wrap).addEventListener('change', async (e) => {
      for (const file of e.target.files) {
        try {
          const small = await shrink(file);
          const out = await api('POST', '/upload', undefined, small);
          set([...get(), out.url]);
          const fig = document.createElement('figure'); fig.innerHTML = `<img src="${out.url}" alt=""><button type="button" data-rm="${out.url}" aria-label="Hapus foto">✕</button>`;
          wrap.insertBefore(fig, $('.upload', wrap));
        } catch (ex) { toast(ex.message, true); }
      }
      e.target.value = '';
    });
  }
  const uploadBlob = async (blob) => (await api('POST', '/upload', undefined, blob)).url;
  // Perkecil foto dari HP (sering 4–10 MB) sebelum diunggah, supaya website tetap ringan.
  function shrink(file, max = 1800) {
    return new Promise((resolve) => {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return resolve(file);
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob((b) => resolve(b && b.size < file.size ? b : file), 'image/jpeg', 0.82);
      };
      img.onerror = () => resolve(file); img.src = url;
    });
  }
  const lines = (arr) => esc((arr || []).join('\n'));

  function roomDialog(r, forProp) {
    const isNew = !r;
    openDialog({
      title: isNew ? 'Tambah kamar' : `Ubah kamar ${r.code}`, ok: isNew ? 'Tambah kamar' : 'Simpan perubahan',
      body: `<div class="fields fields--2">
        <label>Kos<select name="propertyId" ${isNew ? '' : 'disabled'}>${cache.allProps.map((p) => `<option value="${p.id}" ${(r?.propertyId || forProp) === p.id ? 'selected' : ''}>${esc(p.name)}${p.kind === 'mitra' ? ' (mitra)' : ''}</option>`).join('')}</select></label>
        <label>Kode kamar<input name="code" value="${esc(r?.code || '')}" placeholder="A-09" required></label>
        <label>Tipe<input name="type" value="${esc(r?.type || '')}" placeholder="Kamar mandi dalam"></label>
        <label>Ukuran<input name="sizeM2" value="${esc(r?.sizeM2 || '')}" placeholder="3 × 4 m"></label>
        <label>Lantai<input name="floor" value="${esc(r?.floor || '')}" placeholder="Lantai 1"></label>
        <label>Status<select name="status">${['kosong', 'dipesan', 'perbaikan', 'terisi'].map((s) => `<option value="${s}" ${(r?.status || 'kosong') === s ? 'selected' : ''}>${STATUS_KAMAR[s]}</option>`).join('')}</select></label>
        <label>Harga harian <span class="hint">per malam</span><input type="number" name="priceDaily" value="${r?.priceDaily || ''}" min="0" step="1000"></label>
        <label>Harga bulanan<input type="number" name="priceMonthly" value="${r?.priceMonthly ?? ''}" min="0" step="1000"></label>
        <label>Harga 6 bulanan<input type="number" name="priceSemester" value="${r?.priceSemester || ''}" min="0" step="1000"></label>
        <label>Harga tahunan<input type="number" name="priceYearly" value="${r?.priceYearly ?? ''}" min="0" step="1000"></label>
        <label>Kapasitas<select name="capacity"><option value="1">1 orang</option><option value="2" ${Number(r?.capacity) === 2 ? 'selected' : ''}>Bisa 2 orang</option></select></label>
        <label>Tambahan bila berdua <span class="hint">opsional</span><input type="number" name="extraPersonFee" value="${r?.extraPersonFee || ''}" min="0" step="1000"></label>
        <label>Tambahan berdua dihitung<select name="extraPersonPeriod"><option value="bulanan">per bulan</option><option value="tahunan" ${r?.extraPersonPeriod === 'tahunan' ? 'selected' : ''}>per tahun</option></select></label>
        <p class="hint span-all">Harga hanya tampil di website untuk periode yang dibuka di Info kos.</p>
        <label class="span-all">Fasilitas kamar <span class="hint">satu per baris</span><textarea name="facilities" rows="3">${lines(r?.facilities)}</textarea></label>
        <label class="span-all">Keterangan singkat<input name="note" value="${esc(r?.note || '')}" placeholder="Listrik sudah termasuk"></label>
        ${photoField('photos', r?.photos || [])}
        <label class="span-all"><input type="checkbox" name="hidden" ${r?.hidden ? 'checked' : ''}>Sembunyikan kamar ini dari website</label>
        ${isNew ? '' : '<div class="span-all"><button type="button" class="btn btn--ghost btn--sm" id="rmDel">Hapus kamar</button></div>'}
      </div>`,
      onOpen: (b) => {
        bindPhotos(b, 'photos');
        $('#rmDel', b)?.addEventListener('click', async () => {
          if (!(await askConfirm('Hapus kamar', `Kamar ${r.code} akan dihapus. Kamar dengan reservasi berjalan akan ditolak server.`, 'Hapus'))) return;
          try { await api('DELETE', `/rooms/${r.id}`); toast('Kamar dihapus.'); route(); } catch (ex) { toast(ex.message, true); }
        });
      },
      onOk: async (d) => {
        d.photos = JSON.parse(d.photos || '[]'); d.hidden = d.hidden === 'on';
        if (isNew) await api('POST', '/rooms', d); else { delete d.propertyId; await api('PUT', `/rooms/${r.id}`, d); }
        toast(isNew ? `Kamar ${d.code} ditambahkan.` : 'Perubahan kamar disimpan.'); route();
      },
    });
  }

  function propDialog(p) {
    openDialog({
      title: `Info ${p.name}`, ok: 'Simpan perubahan',
      body: `<div class="fields fields--2">
        <label>Nama kos<input name="name" value="${esc(p.name)}"></label>
        <label>Khusus<select name="gender">${['Putra', 'Putri', 'Campur', 'Pasutri'].map((g) => `<option ${p.gender === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
        <label class="span-all">Kalimat utama<input name="tagline" value="${esc(p.tagline)}"></label>
        <label class="span-all">Deskripsi<textarea name="description" rows="3">${esc(p.description)}</textarea></label>
        <label class="span-all">Alamat lengkap<input name="address" value="${esc(p.address)}"></label>
        <label class="span-all">Titik peta <span class="hint">nama tempat di Google Maps, atau koordinat seperti 2.3333,99.0667</span><input name="mapsQuery" value="${esc(p.mapsQuery)}" placeholder="Contoh: 2.3333,99.0667"></label>
        <label>Fasilitas bersama <span class="hint">satu per baris</span><textarea name="facilities" rows="5">${lines(p.facilities)}</textarea></label>
        <label>Aturan kos <span class="hint">satu per baris, hanya tampil di dashboard penghuni</span><textarea name="rules" rows="5">${lines(p.rules)}</textarea></label>
        ${window.BonaDash.logoField('logo', p.logo, 'Logo kos')}
        <label class="span-all">Dekat dengan <span class="hint">satu per baris, misalnya "Pasar — 5 menit"</span><textarea name="nearby" rows="3">${lines(p.nearby)}</textarea></label>
        ${photoField('photos', p.photos || [])}
        <p class="fieldset-title span-all">Periode sewa yang dibuka</p>
        <div class="span-all chips">${Object.entries(CYCLE_NAME).map(([k, v]) => `<label class="chip"><input type="checkbox" name="per_${k}" ${(p.periods || ['bulanan', 'tahunan']).includes(k) ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
        <p class="hint span-all">Website hanya menampilkan harga & pilihan untuk periode yang dicentang.</p>
        <p class="fieldset-title span-all">Reservasi</p>
        <label>Kota / area<input name="city" value="${esc(p.city || '')}"></label>
        <label>Minimal booking / DP<input type="number" name="minBooking" min="0" step="1000" value="${p.minBooking || ''}"></label>
        <label>Nomor WhatsApp kos <span class="hint">kosong = nomor di Pengaturan</span><input name="whatsapp" inputmode="tel" value="${esc(p.whatsapp || '')}"></label>
        <label>Jam kunjungan<input name="visitHours" value="${esc(p.visitHours || '')}"></label>
        <label class="span-all">Rekening tujuan DP <span class="hint">kosong = info rekening di Pengaturan</span><textarea name="bankInfo" rows="2">${esc(p.bankInfo || '')}</textarea></label>
        <label class="span-all">Aturan booking & refund<textarea name="bookingPolicy" rows="2">${esc(p.bookingPolicy || '')}</textarea></label>
        <label><input type="checkbox" name="chatEnabled" ${p.chatEnabled !== false ? 'checked' : ''}> Chat di dashboard reservasi</label>
        <label><input type="checkbox" name="waEnabled" ${p.waEnabled !== false ? 'checked' : ''}> Tombol WhatsApp</label>
        ${p.kind === 'mitra' ? `<p class="fieldset-title span-all">Kemitraan</p>
        <label>Status tayang<select name="status">${Object.entries(PROP_STATUS).map(([k, v]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Pemilik<select name="ownerId"><option value="">(belum ada)</option>${(store.get('/owners')?.data || []).map((o) => `<option value="${o.id}" ${p.ownerId === o.id ? 'selected' : ''}>${esc(o.name)} (${esc(o.username)})</option>`).join('')}</select></label>
        <label>Jenis fee<select name="feeType"><option value="">Ikut fee bawaan</option><option value="persen" ${p.feeType === 'persen' ? 'selected' : ''}>Persen dari DP</option><option value="nominal" ${p.feeType === 'nominal' ? 'selected' : ''}>Nominal tetap</option></select></label>
        <label>Nilai fee <span class="hint">% atau Rp</span><input type="number" name="feeValue" min="0" step="0.5" value="${p.feeValue ?? ''}"></label>
        <label class="span-all">Catatan untuk pemilik <span class="hint">tampil di dashboard pemilik</span><input name="reviewNote" value="${esc(p.reviewNote || '')}"></label>` : ''}
      </div>`,
      wide: true,
      onOpen: (b) => { bindPhotos(b, 'photos'); window.BonaDash.bindLogo(b, 'logo', uploadBlob, (ex) => toast(ex.message, true)); },
      onOk: async (d) => { d.photos = JSON.parse(d.photos || '[]');
        d.periods = Object.keys(CYCLE_NAME).filter((k) => d[`per_${k}`]); Object.keys(CYCLE_NAME).forEach((k) => delete d[`per_${k}`]);
        d.chatEnabled = d.chatEnabled === 'on'; d.waEnabled = d.waEnabled === 'on'; await api('PUT', `/properties/${p.id}`, d); setProps(await api('GET', '/properties')); toast('Info kos disimpan.'); route(); },
    });
  }

  // ========== SURVEI ==========
  async function survei() {
    const list = await get('/surveys');
    main.innerHTML = head('Survei', 'Permintaan survei dari website. Hubungi lewat WhatsApp, lalu ubah statusnya.') +
      `<div class="table-wrap">${list.length ? `<table><thead><tr><th>Calon penyewa</th><th>Kos & kamar</th><th>Jadwal</th><th>Catatan</th><th>Status</th><th></th></tr></thead><tbody>${list.map((s) => `<tr>
        <td data-label="Calon penyewa"><div class="who-cell">${window.BonaDash.avatar(s.name)}<div><strong>${esc(s.name)}</strong><span class="sub">${esc(s.phone)}${s.occupation ? `, ${esc(s.occupation)}` : ''}</span></div></div></td>
        <td data-label="Kos & kamar">${esc(s.propertyName)}<span class="sub">${s.roomCode ? `Kamar ${esc(s.roomCode)}` : 'Kamar belum dipilih'}, sewa ${esc(s.duration)}</span></td>
        <td data-label="Jadwal">${tgl(s.date)}<span class="sub">${esc(s.time)}</span></td>
        <td data-label="Catatan" class="wrap">${esc(s.note) || '<span class="muted">-</span>'}</td>
        <td data-label="Status"><select class="inline" data-sv="${s.id}" aria-label="Status survei ${esc(s.name)}">${Object.entries(STATUS_SURVEI).map(([k, l]) => `<option value="${k}" ${s.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td class="actions"><a class="btn btn--green btn--sm" href="${esc(s.waUrl)}" target="_blank" rel="noopener">Balas di WA</a><button class="btn btn--ghost btn--sm" data-del-sv="${s.id}" aria-label="Hapus">Hapus</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Belum ada permintaan survei. Permintaan dari formulir di website akan muncul di sini.</div>'}</div>`;
    main.onchange = async (e) => {
      const s = e.target.closest('[data-sv]'); if (!s) return;
      await api('PUT', `/surveys/${s.dataset.sv}`, { status: s.value }); toast('Status survei diperbarui.'); refreshBadges();
    };
    main.onclick = async (e) => {
      const d = e.target.closest('[data-del-sv]'); if (!d) return;
      if (!(await askConfirm('Hapus survei', 'Data permintaan survei ini akan dihapus.', 'Hapus'))) return;
      await api('DELETE', `/surveys/${d.dataset.delSv}`); toast('Data survei dihapus.'); route();
    };
  }

  // ========== KERUSAKAN (Fase 2) ==========
  const STATUS_ISSUE = { baru: 'Baru', dikerjakan: 'Sedang dikerjakan', selesai: 'Selesai' };
  let issueFilter = 'terbuka';
  async function kerusakan() {
    const list = await get('/issues');
    const draw = () => {
      const rows = list.filter((i) => issueFilter === 'semua' || (issueFilter === 'terbuka' ? i.status !== 'selesai' : i.status === 'selesai'));
      $('#issTable').innerHTML = rows.length ? `<table><thead><tr><th>Laporan</th><th>Kamar</th><th>Dilaporkan</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((i) => `<tr>
        <td data-label="Laporan" class="wrap"><strong>${esc(i.title)}</strong><span class="sub">${esc(i.category)}${i.description ? `: ${esc(i.description)}` : ''}</span>${i.ownerNote ? `<span class="sub">Catatan Anda: ${esc(i.ownerNote)}</span>` : ''}</td>
        <td data-label="Kamar">${esc(i.roomCode)}<span class="sub">${esc(i.propertyName)}, ${esc(i.tenantName)}</span></td>
        <td data-label="Dilaporkan" class="nowrap">${tgl(i.createdAt)}</td>
        <td data-label="Status"><span class="pill pill--${i.status === 'selesai' ? 'selesai' : i.status === 'baru' ? 'baru' : 'dikonfirmasi'}">${STATUS_ISSUE[i.status]}</span></td>
        <td class="actions">${i.photoPath ? `<button class="btn btn--ghost btn--sm" data-photo="${esc(i.photoPath)}">Lihat foto</button>` : ''}<button class="btn btn--ghost btn--sm" data-issue="${i.id}">Perbarui</button>${i.waUrl ? `<a class="btn btn--green btn--sm" href="${esc(i.waUrl)}" target="_blank" rel="noopener">Balas di WA</a>` : ''}</td></tr>`).join('')}</tbody></table>`
        : `<div class="empty">${issueFilter === 'terbuka' ? 'Tidak ada laporan kerusakan yang terbuka.' : 'Tidak ada laporan.'}</div>`;
    };
    main.innerHTML = head('Kerusakan', 'Laporan dari dashboard penghuni. Ubah statusnya supaya penghuni tahu perkembangannya.') + `
      <div class="toolbar"><div class="seg" id="issSeg">${[['terbuka', 'Terbuka'], ['selesai', 'Selesai'], ['semua', 'Semua']].map(([k, l]) => `<button aria-pressed="${issueFilter === k}" data-k="${k}">${l}</button>`).join('')}</div></div>
      <div class="table-wrap" id="issTable"></div>`;
    draw();
    $('#issSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; issueFilter = b.dataset.k; $$('#issSeg button').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(); };
    main.onclick = async (e) => {
      const ph = e.target.closest('[data-photo]');
      if (ph) {
        try {
          const { url } = await api('GET', `/file?path=${encodeURIComponent(ph.dataset.photo)}`);
          openDialog({ title: 'Foto kerusakan', body: `<a href="${esc(url)}" target="_blank" rel="noopener" class="proof-img"><img src="${esc(url)}" alt="Foto kerusakan"></a>` });
        } catch (ex) { toast(ex.message, true); }
      }
      const up = e.target.closest('[data-issue]');
      if (up) {
        const i = list.find((x) => x.id === up.dataset.issue);
        openDialog({
          title: i.title, ok: 'Simpan',
          body: `<div class="fields"><label>Status<select name="status">${Object.entries(STATUS_ISSUE).map(([k, l]) => `<option value="${k}" ${i.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label>Catatan untuk penghuni <span class="hint">tampil di dashboard penghuni</span><textarea name="ownerNote" rows="3" placeholder="Contoh: tukang datang Sabtu pagi">${esc(i.ownerNote || '')}</textarea></label></div>`,
          onOk: async (d) => { await api('PUT', `/issues/${i.id}`, d); toast('Laporan diperbarui.'); route(); },
        });
      }
    };
  }

  // ========== LAPORAN ==========
  let repYear = String(new Date().getFullYear());
  async function laporan() {
    const [rep, exps] = await Promise.all([get(`/reports?year=${repYear}`), get('/expenses')]);
    const max = Math.max(1, ...rep.months.map((m) => Math.max(m.income, m.expense)));
    const yearOpts = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i));
    const yExp = exps.filter((e) => e.date.startsWith(repYear));
    main.innerHTML = head('Laporan', 'Uang masuk dihitung dari tagihan yang ditandai lunas, menurut tanggal bayar.',
      `<select class="inline" id="repYear" aria-label="Tahun">${yearOpts.map((y) => `<option ${y === repYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
       <button class="btn btn--ghost" id="csvBtn">Unduh CSV (Excel)</button>
       <button class="btn btn--red" id="addExp">Catat pengeluaran</button>`) + `
      <div class="grid grid--stats">
        <div class="panel stat"><p class="stat__label">Uang masuk ${repYear}</p><p class="stat__value">${rp(rep.totals.income)}</p></div>
        <div class="panel stat"><p class="stat__label">Pengeluaran ${repYear}</p><p class="stat__value">${rp(rep.totals.expense)}</p></div>
        <div class="panel stat"><p class="stat__label">Selisih</p><p class="stat__value">${rp(rep.totals.net)}</p></div>
        <div class="panel stat"><p class="stat__label">Pembayaran tercatat</p><p class="stat__value">${rep.months.reduce((s, m) => s + m.payments, 0)}</p></div>
      </div>
      <div class="panel mt"><h2>Per bulan</h2>
        <div class="bars" role="img" aria-label="Grafik uang masuk dan pengeluaran per bulan">${rep.months.map((m, i) => `<div class="bars__col" title="${BULAN[i]}: masuk ${rp(m.income)}, keluar ${rp(m.expense)}"><div class="bars__pair"><span class="bars__in" style="height:${(m.income / max) * 100}%"></span><span class="bars__out" style="height:${(m.expense / max) * 100}%"></span></div><span class="bars__lbl">${BULAN[i]}</span></div>`).join('')}</div>
        <div class="legend"><span><i class="c-terisi"></i>Uang masuk</span><span><i class="c-perbaikan"></i>Pengeluaran</span></div>
      </div>
      <div class="table-wrap mt"><table class="table--keep"><thead><tr><th>Bulan</th>${rep.properties.map((p) => `<th class="num">${esc(p.name)}</th>`).join('')}<th class="num">Total masuk</th><th class="num">Pengeluaran</th><th class="num">Selisih</th></tr></thead><tbody>
        ${rep.months.map((m, i) => `<tr><td data-label="Bulan">${BULAN[i]} ${repYear}</td>${rep.properties.map((p) => `<td class="num" data-label="${esc(p.name)}">${rp(m.byProp[p.id]?.income)}</td>`).join('')}<td class="num" data-label="Total masuk"><strong>${rp(m.income)}</strong></td><td class="num" data-label="Pengeluaran">${rp(m.expense)}</td><td class="num" data-label="Selisih">${rp(m.net)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="room-head"><h2>Pengeluaran ${repYear}</h2></div>
      <div class="table-wrap">${yExp.length ? `<table><thead><tr><th>Tanggal</th><th>Kategori</th><th>Kos</th><th>Keterangan</th><th class="num">Jumlah</th><th></th></tr></thead><tbody>${yExp.map((e) => `<tr>
        <td data-label="Tanggal">${tgl(e.date)}</td><td data-label="Kategori">${esc(e.category)}</td><td data-label="Kos">${e.propertyId ? esc(propName(e.propertyId)) : 'Umum'}</td><td data-label="Keterangan">${esc(e.note) || '-'}</td><td class="num" data-label="Jumlah">${rp(e.amount)}</td>
        <td class="actions"><button class="btn btn--ghost btn--sm" data-del-exp="${e.id}">Hapus</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Belum ada pengeluaran tercatat tahun ini.</div>'}</div>
      <p class="small muted mt">Catatan pajak: penghasilan kos dikecualikan dari PPh final 10% sewa bangunan (PP 34/2017 Pasal 2 ayat 3), jadi diperlakukan sebagai penghasilan usaha. Pastikan skema yang berlaku untuk Anda ke KPP atau konsultan pajak.</p>`;
    $('#repYear').onchange = (e) => { repYear = e.target.value; route(); };
    $('#csvBtn').addEventListener('click', async () => {
      try { saveBlob(await api('GET', `/reports.csv?year=${repYear}`), `laporan-bonaasina-${repYear}.csv`); }
      catch (ex) { toast(ex.message, true); }
    });
    $('#addExp').onclick = () => openDialog({
      title: 'Catat pengeluaran', ok: 'Simpan',
      body: `<div class="fields fields--2">
        <label>Tanggal<input type="date" name="date" value="${today()}"></label>
        <label>Jumlah<input type="number" name="amount" min="0" step="1000" required></label>
        <label>Kategori<input name="category" list="expCats" placeholder="Listrik bersama"><datalist id="expCats"><option>Listrik bersama</option><option>Air</option><option>WiFi</option><option>Perbaikan</option><option>Kebersihan</option><option>Gaji penjaga</option><option>PBB</option><option>Lainnya</option></datalist></label>
        <label>Kos<select name="propertyId"><option value="">Umum (dua kos)</option>${cache.properties.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <label class="span-all">Keterangan<input name="note"></label></div>`,
      onOk: async (d) => { await api('POST', '/expenses', d); toast('Pengeluaran dicatat.'); route(); },
    });
    main.onclick = async (e) => {
      const d = e.target.closest('[data-del-exp]'); if (!d) return;
      if (!(await askConfirm('Hapus pengeluaran', 'Pengeluaran ini akan dihapus dari laporan.', 'Hapus'))) return;
      await api('DELETE', `/expenses/${d.dataset.delExp}`); toast('Pengeluaran dihapus.'); route();
    };
  }

  // ========== LOG AKTIVITAS ==========
  let actFilter = 'semua', actQuery = '';
  function activityPath(before) {
    const p = new URLSearchParams({ type: actFilter }); if (actQuery) p.set('q', actQuery); if (before) p.set('before', before);
    return `/activity?${p}`;
  }
  const WAKTU = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const ACTOR = { admin: 'Admin', penghuni: 'Penghuni', publik: 'Publik', pemilik: 'Pemilik mitra', customer: 'Penyewa Kos Sekitar' };
  const relTime = (iso) => {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'baru saja'; if (m < 60) return `${m} menit lalu`;
    const h = Math.round(m / 60); if (h < 24) return `${h} jam lalu`;
    const d = Math.round(h / 24); return d < 8 ? `${d} hari lalu` : '';
  };
  const actRows = (items) => items.map((a) => `<tr class="${a.ok ? '' : 'row--fail'}">
      <td data-label="Waktu" class="nowrap">${esc(WAKTU.format(new Date(a.createdAt)))}<span class="sub">${esc(relTime(a.createdAt))}</span></td>
      <td data-label="Pengguna"><span class="pill pill--${a.actorType}">${ACTOR[a.actorType] || esc(a.actorType)}</span><span class="sub actor">${esc(a.actor)}</span></td>
      <td data-label="Aktivitas" class="wrap">${a.ok ? '' : '<span class="pill pill--terlambat">Gagal</span> '}${esc(a.summary)}${a.target ? `<span class="sub">Kamar/objek: ${esc(a.target)}</span>` : ''}</td>
      <td data-label="Perangkat" class="wrap">${esc(a.userAgent || '-')}<span class="sub mono">${esc(a.ip || '')}</span></td></tr>`).join('');

  async function aktivitas() {
    const data = await get(activityPath());
    const c = data.counts;
    main.innerHTML = head('Log aktivitas', `Siapa melakukan apa di admin, dashboard penghuni, dan formulir website. Disimpan ${data.keepDays} hari.`) + `
      <div class="grid grid--stats">
        <div class="panel stat"><p class="stat__label">Aktivitas 30 hari</p><p class="stat__value">${c.semua}</p><p class="stat__sub">semua pengguna</p></div>
        <div class="panel stat"><p class="stat__label">Oleh admin</p><p class="stat__value">${c.admin}</p><p class="stat__sub">masuk, ubah data, unduh</p></div>
        <div class="panel stat"><p class="stat__label">Penghuni & publik</p><p class="stat__value">${c.penghuni + c.publik + (c.pemilik || 0) + (c.customer || 0)}</p><p class="stat__sub">${c.penghuni} penghuni, ${c.pemilik || 0} pemilik, ${c.customer || 0} penyewa Kos Sekitar, ${c.publik} website</p></div>
        <div class="panel stat ${c.gagal ? 'stat--alert' : ''}"><p class="stat__label">Percobaan gagal</p><p class="stat__value">${c.gagal}</p><p class="stat__sub">login salah, link tidak berlaku</p></div>
      </div>
      <div class="toolbar mt">
        <div class="seg" id="actSeg">${[['semua', 'Semua'], ['admin', 'Admin'], ['penghuni', 'Penghuni'], ['pemilik', 'Pemilik mitra'], ['customer', 'Penyewa Kos Sekitar'], ['publik', 'Publik'], ['gagal', 'Gagal']].map(([k, l]) => `<button aria-pressed="${actFilter === k}" data-k="${k}">${l}</button>`).join('')}</div>
        <input class="search" type="search" placeholder="Cari nama, aktivitas, kamar, atau IP" value="${esc(actQuery)}" id="actSearch" aria-label="Cari aktivitas">
      </div>
      <div class="table-wrap">${data.items.length ? `<table class="table--log"><thead><tr><th>Waktu (WIB)</th><th>Pengguna</th><th>Aktivitas</th><th>Perangkat & IP</th></tr></thead><tbody id="actBody">${actRows(data.items)}</tbody></table>`
        : `<div class="empty">${actQuery || actFilter !== 'semua' ? 'Tidak ada aktivitas yang cocok.' : 'Belum ada aktivitas tercatat. Aktivitas baru akan muncul di sini.'}</div>`}</div>
      ${data.hasMore ? '<div class="more"><button class="btn btn--ghost" id="actMore">Muat lebih banyak</button></div>' : ''}
      <p class="small muted mt">Kunjungan halaman website oleh calon penyewa dicatat di Google Analytics, bukan di sini. IP dan perangkat dicatat untuk keamanan akun.</p>`;
    $('#actSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; actFilter = b.dataset.k; route(); };
    let t; $('#actSearch').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { actQuery = e.target.value.trim(); route().then(() => { const i = $('#actSearch'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 400); };
    let last = data.items[data.items.length - 1]?.id;
    $('#actMore')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      // Filter/pencarian bisa berganti selama data dimuat; hasil yang telat tidak boleh masuk ke tabel baru.
      const asked = activityPath(last);
      try {
        const more = await api('GET', asked);
        const body = $('#actBody');
        if (!body || activityPath(last) !== asked) return;
        body.insertAdjacentHTML('beforeend', actRows(more.items));
        last = more.items[more.items.length - 1]?.id;
        if (!more.hasMore) btn.parentElement.remove();
      } catch (ex) { toast(ex.message, true); }
      finally { btn.disabled = false; }
    });
  }

  // ========== ALAT BERSAMA (fitur penghuni) ==========
  const SITE = location.origin;
  const BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const tglPanjang = (s) => { if (!s) return '-'; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return `${d} ${BULAN_PANJANG[m - 1]} ${y}`; };
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const addMonthsC = (s, n) => {
    const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1));
    t.setUTCDate(Math.min(d, new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate())); return t.toISOString().slice(0, 10);
  };
  const waMe = (phone, text) => `https://wa.me/${normPhone(phone)}?text=${encodeURIComponent(text)}`;
  const waShare = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
  const genPassword = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; const s = [...crypto.getRandomValues(new Uint8Array(10))].map((x) => a[x % a.length]).join(''); return `${s.slice(0, 5)}-${s.slice(5)}`; };
  const suggestUsername = (name, room) => {
    const first = String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/)[0].replace(/[^a-z0-9]/g, '') || 'penghuni';
    const r = String(room || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return r ? `${first}.${r}` : first;
  };
  const fmtCode = (c) => (c ? `${c.slice(0, 4)}-${c.slice(4, 8)}`.toUpperCase() : '-');
  const PHASE = { menunggu: 'Menunggu persetujuan', aktif: 'Aktif', akan_mulai: 'Akan mulai', akan_habis: 'Akan berakhir', berakhir: 'Berakhir', dibatalkan: 'Dibatalkan' };
  const DECISION = { perpanjang: 'Ingin perpanjang', berhenti: 'Ingin berhenti' };
  const CONDITION = { baik: 'Baik', kurang: 'Kurang baik', rusak: 'Rusak', tidak_ada: 'Tidak ada' };
  const cycleWord = (c) => ({ harian: 'malam', semesteran: '6 bulan', tahunan: 'tahun' }[c] || 'bulan');
  // Isi kontrak: baris "## Judul" tampil sebagai judul pasal (sama seperti di PDF).
  const docHtml = (body) => esc(body).replace(/^## (.*)$/gm, '<strong class="doc-h">$1</strong>');
  async function download(path, name, label = 'Menyiapkan PDF…') {
    try { await BonaLoader.during(label, async () => saveBlob(await api('GET', path), name)); }
    catch (ex) { toast(ex.message, true); }
  }
  const safeName = (s) => String(s || 'dokumen').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  function idCardHtml(c) {
    return `<div class="idcard ${c.active ? '' : 'is-off'}" role="img" aria-label="Kartu penghuni ${esc(c.name)}">
      <div class="idcard__top"><img src="/assets/img/mark.webp" alt=""><div><strong>BONAASINA</strong><small>KARTU PENGHUNI</small></div><em>${esc(c.propertyName)}</em></div>
      <div class="idcard__body">
        <div class="idcard__photo">${c.photoUrl ? `<img src="${esc(c.photoUrl)}" alt="">` : 'FOTO'}</div>
        <div><div class="idcard__name">${esc(c.name)}</div>
          <div class="idcard__f">Kamar</div><div class="idcard__v">${esc(c.roomCode)}</div>
          <div class="idcard__f">Penghuni sejak</div><div class="idcard__v">${tglPanjang(c.since)}</div>
          ${c.until ? `<div class="idcard__f">Kontrak s.d.</div><div class="idcard__v">${tglPanjang(c.until)}</div>` : ''}</div>
        <div class="idcard__qr">${c.qrSvg || ''}<span>No. ${fmtCode(c.code)}</span></div>
      </div></div>`;
  }

  // ---------- akun login penghuni ----------
  function showCredentials(t, username, password) {
    const link = `${SITE}/penghuni/`;
    const msg = `Horas ${t.name}, akun dashboard penghuni Bonaasina Anda sudah siap.\n\nAlamat: ${link}\nUsername: ${username}\nKata sandi: ${password}\n\nDi dashboard Anda bisa melihat tagihan dan kuitansi, menyetujui kontrak sewa, membaca pengumuman, melihat jadwal piket, dan menyimpan kartu penghuni. Kata sandi bisa diganti di menu Profil. Jangan bagikan ke orang lain ya.`;
    openDialog({
      title: 'Akun penghuni siap',
      body: `<p class="muted">Kata sandi hanya ditampilkan sekarang. Kirim ke ${esc(t.name)} lewat WhatsApp atau salin pesannya.</p>
        <dl class="kv mt"><dt>Alamat</dt><dd>${esc(link)}</dd><dt>Username</dt><dd>${esc(username)}</dd><dt>Kata sandi</dt><dd class="mono" style="font-size:15px !important">${esc(password)}</dd></dl>
        <div class="preview" id="credMsg">${esc(msg)}</div>
        <div class="btn-row mt">${t.phone ? `<a class="btn btn--green" href="${esc(waMe(t.phone, msg))}" target="_blank" rel="noopener">Kirim lewat WhatsApp</a>` : '<span class="hint">Nomor WA penghuni belum diisi, salin pesannya.</span>'}
          <button type="button" class="btn btn--ghost" id="credCopy">Salin pesan</button></div>`,
      onOpen: (b) => { $('#credCopy', b).onclick = () => copyText($('#credMsg', b)); },
    });
  }
  function accountDialog(t) {
    const has = !!t.username;
    openDialog({
      title: has ? `Akun login ${t.name}` : `Buat akun login ${t.name}`, ok: has ? 'Simpan' : 'Buat akun',
      body: `<p class="muted">Penghuni masuk di <strong>${esc(SITE.replace(/^https?:\/\//, ''))}/penghuni</strong> dengan username dan kata sandi ini.</p>
        <div class="fields fields--2 mt">
          <label>Username<input name="username" value="${esc(t.username || suggestUsername(t.name, t.room?.code))}" autocapitalize="none" spellcheck="false" autocomplete="off" required><span class="hint">Huruf kecil, angka, titik, minus, atau garis bawah.</span></label>
          <label>${has ? 'Kata sandi baru <span class="hint">kosongkan bila tidak diganti</span>' : 'Kata sandi'}<span class="pw-row"><input name="password" id="pwIn" value="${has ? '' : genPassword()}" autocomplete="off"><button type="button" class="btn btn--ghost btn--sm" id="pwGen">Buat acak</button></span><span class="hint">Minimal 8 karakter.</span></label>
          ${has ? `<label class="span-all"><input type="checkbox" name="enabled" ${t.loginEnabled ? 'checked' : ''}>Akun aktif (penghuni bisa masuk)</label>` : ''}
        </div>`,
      onOpen: (b) => { $('#pwGen', b).onclick = () => { $('#pwIn', b).value = genPassword(); }; },
      onOk: async (d) => {
        const body = { username: d.username.trim().toLowerCase(), password: d.password || undefined, enabled: has ? d.enabled === 'on' : true };
        await api('POST', `/tenants/${t.id}/account`, body);
        toast(has ? 'Akun login diperbarui.' : 'Akun login dibuat.');
        if (d.password) setTimeout(() => showCredentials(t, body.username, d.password), 80);
        route();
      },
    });
  }

  // ---------- kontrak ----------
  function contractDialog(tenant, existing, renewFrom) {
    const start0 = existing?.startDate || (renewFrom ? addDays(renewFrom.endDate, 1) : (tenant.startDate > today() ? tenant.startDate : today()));
    const end0 = existing?.endDate || addDays(addMonthsC(start0, 12), -1);
    const cyc = existing?.rentCycle || tenant.rentCycle || 'bulanan';
    openDialog({
      wide: true, title: existing ? `Ubah kontrak ${existing.number}` : renewFrom ? `Kontrak lanjutan ${tenant.name}` : `Kontrak baru ${tenant.name}`, ok: existing ? 'Simpan perubahan' : 'Buat & kirim ke penghuni',
      body: `<div class="fields fields--3">
          <label>Mulai<input type="date" name="startDate" value="${start0}" required></label>
          <label>Selesai<input type="date" name="endDate" value="${end0}" required></label>
          <label>Jenis sewa<select name="rentCycle">${Object.entries(CYCLE_NAME).map(([k, v]) => `<option value="${k}" ${cyc === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Harga sewa<input type="number" name="rentAmount" value="${existing?.rentAmount ?? tenant.rentAmount ?? ''}" min="0" step="1000"></label>
          <label>Deposit<input type="number" name="deposit" value="${existing?.deposit ?? tenant.deposit ?? 0}" min="0" step="1000"></label>
          <div class="btn-row" style="align-self:end"><button type="button" class="btn btn--ghost" id="ctrFill">Isi ulang dari templat</button></div>
          <label class="span-all">Isi kontrak <span class="hint">Baris yang diawali "## " menjadi judul pasal. Templat diubah di menu Pengaturan.</span><textarea class="doc-edit" name="body" id="ctrBody" rows="16">${esc(existing?.body || '')}</textarea></label>
          <p class="hint span-all">Setelah dibuat, kontrak muncul di dashboard penghuni untuk dibaca dan disetujui. PDF tersimpan otomatis setelah disetujui.</p>
        </div>`,
      onOpen: (b) => {
        const fill = async () => {
          const f = Object.fromEntries(new FormData($('#dlgForm')));
          try { const out = await api('POST', '/contracts/preview-body', { tenantId: tenant.id, ...f }); $('#ctrBody', b).value = out.body; delete $('#ctrBody', b).dataset.touched; }
          catch (ex) { toast(ex.message, true); }
        };
        $('#ctrFill', b).onclick = fill;
        $('#ctrBody', b).addEventListener('input', (e) => { e.target.dataset.touched = 1; });
        $$('input, select', b).forEach((el) => el.addEventListener('change', () => { if (!$('#ctrBody', b).dataset.touched) fill(); }));
        if (!existing) fill();
      },
      onOk: async (d) => {
        if (existing) { await api('PUT', `/contracts/${existing.id}`, d); toast('Kontrak diperbarui.'); route(); return; }
        const c = await api('POST', '/contracts', { tenantId: tenant.id, renewedFrom: renewFrom?.id, ...d });
        toast(`Kontrak ${c.number} dibuat.`); route();
        setTimeout(() => shareContract(tenant, c), 80);
      },
    });
  }
  function shareContract(tenant, c) {
    const msg = `Horas ${tenant.name}, kontrak sewa kamar Anda (${c.number}, ${tglPanjang(c.startDate)} s.d. ${tglPanjang(c.endDate)}) sudah tersedia di dashboard penghuni Bonaasina. Mohon dibaca lalu disetujui di menu Kontrak:\n${SITE}/penghuni/#kontrak\n\nTerima kasih.`;
    openDialog({
      title: 'Kabari penghuni',
      body: `<p class="muted">Kontrak sudah muncul di dashboard ${esc(tenant.name)}. Kirim pemberitahuan supaya segera dibaca dan disetujui.</p><div class="preview" id="ctrMsg">${esc(msg)}</div>
        <div class="btn-row mt">${tenant.phone ? `<a class="btn btn--green" href="${esc(waMe(tenant.phone, msg))}" target="_blank" rel="noopener">Kirim lewat WhatsApp</a>` : ''}<button type="button" class="btn btn--ghost" id="ctrCopy">Salin pesan</button></div>`,
      onOpen: (b) => { $('#ctrCopy', b).onclick = () => copyText($('#ctrMsg', b)); },
    });
  }
  async function viewContract(c) {
    try {
      const full = await BonaLoader.during('Membuka kontrak…', () => api('GET', `/contracts/${c.id}`));
      openDialog({
        wide: true, title: `Kontrak ${full.number}`,
        body: `<p class="muted"><span class="pill pill--${full.phase}">${PHASE[full.phase]}</span> ${tglPanjang(full.startDate)} s.d. ${tglPanjang(full.endDate)}, ${rp(full.rentAmount)} per ${cycleWord(full.rentCycle)}${full.acceptedAt ? `. Disetujui ${esc(full.acceptedName || '')} pada ${WAKTU.format(new Date(full.acceptedAt))} WIB` : ''}.</p>
          <div class="doc-text mt">${docHtml(full.body)}</div>
          <div class="btn-row mt"><button type="button" class="btn btn--ghost" id="ctrPdf">Unduh PDF${full.hasPdf ? '' : ' (draf)'}</button></div>`,
        onOpen: (b) => { $('#ctrPdf', b).onclick = () => download(`/contracts/${full.id}/pdf`, `kontrak-${safeName(full.number)}.pdf`); },
      });
    } catch (ex) { toast(ex.message, true); }
  }
  // Tombol aksi kontrak, dipakai di menu Kontrak dan halaman detail penghuni.
  function contractButtons(c, t) {
    const b = [`<button class="btn btn--ghost btn--sm" data-ctr-view="${c.id}">Lihat</button>`];
    if (c.phase === 'menunggu') {
      b.push(`<button class="btn btn--ghost btn--sm" data-ctr-edit="${c.id}">Ubah</button>`, `<button class="btn btn--ghost btn--sm" data-ctr-cancel="${c.id}">Batalkan</button>`);
      if (t?.phone) b.push(`<button class="btn btn--green btn--sm" data-ctr-share="${c.id}">Ingatkan via WA</button>`);
    } else b.push(`<button class="btn btn--ghost btn--sm" data-ctr-pdf="${c.id}">PDF</button>`);
    if (c.decision && !c.decisionHandledAt) {
      if (c.decision === 'perpanjang') b.push(`<button class="btn btn--red btn--sm" data-ctr-renew="${c.id}">Buat kontrak lanjutan</button>`);
      b.push(`<button class="btn btn--ghost btn--sm" data-ctr-handled="${c.id}">Tandai selesai</button>`);
    } else if (c.phase === 'akan_habis' && !c.decision && t?.phone) b.push(`<button class="btn btn--green btn--sm" data-ctr-ask="${c.id}">Tanyakan via WA</button>`);
    return b.join('');
  }
  async function contractClick(e, contracts, tenantOf) {
    const el = e.target.closest('[data-ctr-view],[data-ctr-pdf],[data-ctr-edit],[data-ctr-cancel],[data-ctr-share],[data-ctr-renew],[data-ctr-handled],[data-ctr-ask]');
    if (!el) return false;
    const id = Object.entries(el.dataset).find(([k]) => k.startsWith('ctr'))[1];
    const c = contracts.find((x) => x.id === id); const t = tenantOf(c);
    if (el.dataset.ctrView) viewContract(c);
    if (el.dataset.ctrPdf) download(`/contracts/${c.id}/pdf`, `kontrak-${safeName(c.number)}.pdf`);
    if (el.dataset.ctrEdit) { try { contractDialog(t, await BonaLoader.during('Membuka kontrak…', () => api('GET', `/contracts/${c.id}`))); } catch (ex) { toast(ex.message, true); } }
    if (el.dataset.ctrCancel) { if (await askConfirm('Batalkan kontrak', `Kontrak ${c.number} akan dibatalkan dan hilang dari dashboard penghuni.`, 'Batalkan kontrak')) { await api('POST', `/contracts/${c.id}/cancel`); toast('Kontrak dibatalkan.'); route(); } }
    if (el.dataset.ctrShare) shareContract(t, c);
    if (el.dataset.ctrRenew) contractDialog(t, null, c);
    if (el.dataset.ctrHandled) { await api('POST', `/contracts/${c.id}/handled`); toast('Ditandai sudah ditindaklanjuti.'); route(); }
    if (el.dataset.ctrAsk) {
      const msg = `Horas ${t.name}, kontrak sewa kamar Anda berakhir ${tglPanjang(c.endDate)}. Mohon pilih perpanjang atau berhenti di menu Kontrak pada dashboard penghuni:\n${SITE}/penghuni/#kontrak\n\nTerima kasih.`;
      window.open(waMe(t.phone, msg), '_blank', 'noopener');
    }
    return true;
  }

  // ========== KONTRAK ==========
  let ctrFilter = 'tindakan';
  const needsAction = (c) => c.phase === 'menunggu' || (c.phase === 'akan_habis' && !c.decision) || (c.decision && !c.decisionHandledAt);
  async function kontrak() {
    const [list, s, tenants] = await Promise.all([get('/contracts'), get('/summary'), get('/tenants')]);
    const tm = new Map(tenants.map((t) => [t.id, t]));
    const counts = { tindakan: list.filter(needsAction).length, aktif: list.filter((c) => ['aktif', 'akan_habis', 'akan_mulai'].includes(c.phase)).length, semua: list.length };
    if (ctrFilter === 'tindakan' && !counts.tindakan && !kontrak.visited) ctrFilter = 'aktif';
    kontrak.visited = true;
    const rows = list.filter((c) => ctrFilter === 'semua' || (ctrFilter === 'tindakan' ? needsAction(c) : ['aktif', 'akan_habis', 'akan_mulai'].includes(c.phase)));
    main.innerHTML = head('Kontrak', 'Kontrak sewa digital. Penghuni membaca dan menyetujui di dashboard mereka; PDF tersimpan otomatis.') +
      (s.tenantsWithoutContract ? `<div class="notice"><p><strong>${s.tenantsWithoutContract} penghuni aktif belum punya kontrak berjalan.</strong> Buat kontrak dari halaman detail penghuni.</p><a class="btn btn--sm" href="#penghuni">Lihat penghuni</a></div>` : '') + `
      <div class="toolbar"><div class="seg" id="ctrSeg">${[['tindakan', 'Perlu tindakan'], ['aktif', 'Berjalan'], ['semua', 'Semua']].map(([k, l]) => `<button aria-pressed="${ctrFilter === k}" data-k="${k}">${l} (${counts[k]})</button>`).join('')}</div></div>
      <div class="table-wrap">${rows.length ? `<table><thead><tr><th>Penghuni</th><th>Nomor</th><th>Masa sewa</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((c) => `<tr>
        <td data-label="Penghuni"><a href="#penghuni?id=${c.tenantId}"><strong>${esc(c.tenantName)}</strong></a><span class="sub">Kamar ${esc(c.roomCode)}, ${esc(c.propertyName)}</span></td>
        <td data-label="Nomor">${esc(c.number)}<span class="sub">${rp(c.rentAmount)} / ${cycleWord(c.rentCycle)}</span></td>
        <td data-label="Masa sewa">${tgl(c.startDate)} – ${tgl(c.endDate)}${c.daysLeft !== null && c.daysLeft >= 0 && c.phase !== 'menunggu' ? `<span class="sub">${c.daysLeft} hari lagi</span>` : ''}</td>
        <td data-label="Status"><span class="pill pill--${c.phase}">${PHASE[c.phase]}</span>${c.decision ? ` <span class="pill pill--${c.decision}">${DECISION[c.decision]}</span>` : ''}${c.decisionNote ? `<span class="sub">"${esc(c.decisionNote)}"</span>` : ''}</td>
        <td class="actions act-wrap">${contractButtons(c, tm.get(c.tenantId))}</td></tr>`).join('')}</tbody></table>`
        : `<div class="empty ${ctrFilter === 'tindakan' ? 'empty--ok' : ''}">${ctrFilter === 'tindakan' ? 'Tidak ada kontrak yang perlu ditindaklanjuti.' : 'Belum ada kontrak. Buat dari halaman detail penghuni.'}</div>`}</div>`;
    $('#ctrSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; ctrFilter = b.dataset.k; route(); };
    main.onclick = (e) => contractClick(e, list, (c) => tm.get(c.tenantId) || { id: c.tenantId, name: c.tenantName, phone: c.tenantPhone });
  }

  // ========== DETAIL PENGHUNI ==========
  async function penghuniDetail(id) {
    const [d, s] = await Promise.all([get(`/tenants/${id}/detail`), get('/settings')]);
    cache.settings = s;
    const t = d.tenant; const active = t.status === 'aktif';
    const tLite = { ...t, room: d.room };
    const masuk = d.inspections.find((x) => x.kind === 'masuk'); const keluar = d.inspections.find((x) => x.kind === 'keluar');
    const running = d.contracts.find((c) => ['aktif', 'akan_habis'].includes(c.phase));
    const inspCard = (kind, x) => {
      const bad = x ? x.items.filter((i) => i.condition !== 'baik').length : 0;
      return `<div class="list__item"><div><strong>Saat ${kind}</strong>${x ? ` <span class="pill pill--${x.tenantAckAt ? 'disetujui' : 'menunggu'}">${x.tenantAckAt ? 'Disetujui penghuni' : 'Menunggu persetujuan'}</span>` : ''}
          <span class="sub">${x ? `${tgl(x.date)}, ${x.items.length} bagian diperiksa, ${bad ? `${bad} bermasalah` : 'semua baik'}${x.depositDeduction ? `, potongan deposit ${rp(x.depositDeduction)}` : ''}` : kind === 'masuk' ? 'Belum dicatat. Sebaiknya diisi saat penghuni baru masuk.' : 'Diisi saat penghuni keluar, sebagai dasar pengembalian deposit.'}</span>
          ${x?.tenantNote ? `<span class="sub">Catatan penghuni: "${esc(x.tenantNote)}"</span>` : ''}</div>
        <div class="btn-row">${x ? `<button class="btn btn--ghost btn--sm" data-insp-view="${kind}">Lihat</button>` : ''}<button class="btn btn--${x ? 'ghost' : 'red'} btn--sm" data-insp-edit="${kind}">${x ? 'Ubah' : 'Isi sekarang'}</button></div></div>`;
    };
    main.innerHTML = `<a class="back" href="#penghuni">← Semua penghuni</a>` + head(esc(t.name), `${d.room ? `Kamar ${esc(d.room.code)}, ${esc(d.property?.name || '')}` : 'Belum ada kamar'}, ${active ? `penghuni sejak ${tglPanjang(t.startDate)}` : `keluar ${tglPanjang(t.endDate)}`}`,
      `${active ? '' : '<span class="pill pill--keluar">Sudah keluar</span>'}<button class="btn btn--ghost" data-edit-t>Ubah data</button>${active ? '<button class="btn btn--ghost" data-out-t>Catat keluar</button>' : ''}`) + `
      <div class="detail-grid">
        <section class="panel"><h2>Akun login dashboard</h2>
          ${t.username ? `<dl class="kv"><dt>Username</dt><dd>${esc(t.username)}</dd><dt>Status</dt><dd>${t.loginEnabled && active ? '<span class="pill pill--aktif">Aktif</span>' : '<span class="pill pill--nonaktif">Tidak aktif</span>'}</dd><dt>Terakhir masuk</dt><dd>${t.lastLoginAt ? `${WAKTU.format(new Date(t.lastLoginAt))} WIB` : 'Belum pernah'}</dd></dl>`
            : '<p class="muted">Belum ada akun. Buat akun supaya penghuni bisa melihat tagihan, kuitansi, kontrak, pengumuman, dan piket.</p>'}
          ${active ? `<div class="panel-actions"><button class="btn btn--${t.username ? 'ghost' : 'red'} btn--sm" data-account>${t.username ? 'Ubah akun / reset kata sandi' : 'Buat akun login'}</button></div>` : ''}
        </section>
        <section class="panel"><h2>Kartu penghuni</h2>
          ${idCardHtml({ name: t.name, propertyName: d.property?.name || 'Bonaasina', roomCode: d.room?.code || '-', since: t.startDate, until: running?.endDate, photoUrl: d.photoUrl, qrSvg: d.card?.qrSvg, code: d.card?.code, active })}
          <div class="panel-actions"><button class="btn btn--ghost btn--sm" data-card-pdf>Unduh PDF</button><label class="btn btn--ghost btn--sm">${d.photoUrl ? 'Ganti foto' : 'Unggah foto'}<input type="file" accept="image/jpeg,image/png" id="photoIn" hidden></label></div>
          <p class="hint mt">Foto biasanya diunggah sendiri oleh penghuni dari menu Profil. QR di kartu membuka halaman cek keaslian.</p>
        </section>
      </div>
      <section class="panel mt"><h2>Kontrak sewa ${active ? `<span class="actions"><button class="btn btn--red btn--sm" data-ctr-new>Buat kontrak</button></span>` : ''}</h2>
        ${d.contracts.length ? `<div class="list">${d.contracts.map((c) => `<div class="list__item"><div><strong>${esc(c.number)}</strong> <span class="pill pill--${c.phase}">${PHASE[c.phase]}</span>${c.decision ? ` <span class="pill pill--${c.decision}">${DECISION[c.decision]}</span>` : ''}
            <span class="sub">${tgl(c.startDate)} – ${tgl(c.endDate)}, ${rp(c.rentAmount)}/${cycleWord(c.rentCycle)}${c.acceptedAt ? `, disetujui ${tgl(c.acceptedAt)}` : ''}${c.phase === 'akan_habis' ? `, ${c.daysLeft} hari lagi` : ''}</span>${c.decisionNote ? `<span class="sub">Catatan penghuni: "${esc(c.decisionNote)}"</span>` : ''}</div>
            <div class="btn-row">${contractButtons(c, t)}</div></div>`).join('')}</div>` : `<p class="muted">Belum ada kontrak.${active ? ' Tekan Buat kontrak; isinya diambil dari templat di Pengaturan dan bisa diubah sebelum dikirim.' : ''}</p>`}
      </section>
      <section class="panel mt"><h2>Kondisi kamar</h2><div class="split2">${inspCard('masuk', masuk)}${inspCard('keluar', keluar)}</div>
        <p class="hint mt">Catatan kondisi dengan foto per bagian kamar. Penghuni ikut memeriksa dan menyetujuinya di dashboard, sehingga potongan deposit punya dasar yang jelas.</p></section>
      <section class="panel mt"><h2>Tagihan <a class="small" href="#tagihan">Semua tagihan</a></h2>
        ${d.invoices.length ? `<table><tbody>${d.invoices.slice(0, 12).map((i) => `<tr>
          <td data-label="Periode"><strong>${esc(i.periodLabel)}</strong><span class="sub">Jatuh tempo ${tgl(i.dueDate)}</span></td>
          <td class="num" data-label="Jumlah">${rp(i.amount)}</td>
          <td data-label="Status">${i.status === 'lunas' ? `<span class="pill pill--lunas">Lunas ${tgl(i.paidAt)}</span>` : i.overdue ? '<span class="pill pill--terlambat">Terlambat</span>' : '<span class="pill pill--belum">Belum bayar</span>'}${i.receiptNo ? `<span class="sub">${esc(i.receiptNo)}</span>` : ''}</td>
          <td class="actions">${i.status === 'lunas' ? `<button class="btn btn--ghost btn--sm" data-receipt="${i.id}">Kuitansi</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Belum ada tagihan.</p>'}
      </section>`;
    $('#topTitle').textContent = t.name;
    document.title = `${t.name} — Admin Bonaasina`;
    $('#photoIn')?.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { await BonaLoader.during('Mengunggah foto…', async () => api('POST', `/tenants/${t.id}/photo`, undefined, await shrink(f, 900))); toast('Foto kartu diperbarui.'); route(); }
      catch (ex) { toast(ex.message, true); }
    });
    main.onclick = async (e) => {
      if (await contractClick(e, d.contracts, () => t)) return;
      if (e.target.closest('[data-account]')) accountDialog(tLite);
      if (e.target.closest('[data-card-pdf]')) download(`/tenants/${t.id}/card.pdf`, `kartu-penghuni-${safeName(t.name)}.pdf`);
      if (e.target.closest('[data-ctr-new]')) {
        const pend = d.contracts.find((c) => c.phase === 'menunggu');
        if (pend) return toast(`Kontrak ${pend.number} masih menunggu persetujuan. Ubah atau batalkan dulu.`, true);
        contractDialog(t, null, running && running.daysLeft <= 60 ? running : null);
      }
      if (e.target.closest('[data-edit-t]')) tenantDialog(t, await get('/rooms'));
      if (e.target.closest('[data-out-t]')) checkoutDialog(tLite, !!keluar);
      const r = e.target.closest('[data-receipt]'); if (r) { const i = d.invoices.find((x) => x.id === r.dataset.receipt); download(`/invoices/${i.id}/receipt.pdf`, `kuitansi-${safeName(t.name)}-${safeName(i.periodLabel)}.pdf`); }
      const iv = e.target.closest('[data-insp-view]'); if (iv) inspectionView(iv.dataset.inspView === 'masuk' ? masuk : keluar, masuk);
      const ie = e.target.closest('[data-insp-edit]'); if (ie) inspectionDialog(tLite, ie.dataset.inspEdit, ie.dataset.inspEdit === 'masuk' ? masuk : keluar, masuk, s);
    };
  }
  function checkoutDialog(t, hasKeluar) {
    openDialog({
      title: `${t.name} keluar`, ok: 'Simpan', body: `<p class="muted">Kamar ${esc(t.room?.code || '')} akan menjadi kosong dan akun login penghuni ditutup. Tagihan yang belum dibayar untuk periode setelah tanggal keluar dihapus; tunggakan sebelumnya tetap tercatat.</p>
        <label class="mt">Tanggal keluar<input type="date" name="endDate" value="${today()}"></label>
        ${t.deposit ? `<p class="hint">Deposit ${rp(t.deposit)} perlu dikembalikan atau diperhitungkan${hasKeluar ? ' sesuai catatan kondisi keluar' : ''}.</p>` : ''}
        ${hasKeluar ? '' : '<p class="info-box info-box--warn mt">Kondisi kamar saat keluar belum dicatat. Sebaiknya isi dulu dari halaman detail penghuni sebelum mencatat keluar.</p>'}`,
      onOk: async (d) => {
        const out = await api('POST', `/tenants/${t.id}/checkout`, d);
        toast(`${t.name} tercatat keluar.${out.waitlistMatched ? ` ${out.waitlistMatched} orang di daftar tunggu perlu dikabari.` : ''}`);
        route();
      },
    });
  }

  // ---------- kondisi kamar ----------
  function inspectionView(x, masuk) {
    if (!x) return;
    const was = (name) => masuk && x.kind === 'keluar' ? masuk.items.find((m) => m.name === name) : null;
    openDialog({
      wide: true, title: `Kondisi kamar saat ${x.kind}`,
      body: `<p class="muted">Diperiksa ${tglPanjang(x.date)}. ${x.tenantAckAt ? `Disetujui penghuni ${WAKTU.format(new Date(x.tenantAckAt))} WIB.` : 'Belum disetujui penghuni.'}</p>
        <div class="insp-view mt">${x.items.map((i) => { const w = was(i.name); return `<div class="insp-view__row"><strong>${esc(i.name)}</strong><span class="pill pill--${i.condition}">${CONDITION[i.condition]}</span>
          ${i.note ? `<span class="sub">${esc(i.note)}</span>` : ''}${w ? `<span class="sub">Saat masuk: ${CONDITION[w.condition]}${w.note ? `, ${esc(w.note)}` : ''}</span>` : ''}
          ${(i.photoUrls || []).length ? `<div class="thumbs">${i.photoUrls.filter(Boolean).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Foto ${esc(i.name)}"></a>`).join('')}</div>` : ''}</div>`; }).join('')}</div>
        ${x.note ? `<p class="mt"><strong>Catatan:</strong> ${esc(x.note)}</p>` : ''}
        ${x.kind === 'keluar' ? `<p class="mt"><strong>Potongan deposit:</strong> ${rp(x.depositDeduction)}${x.deductionNote ? ` (${esc(x.deductionNote)})` : ''}</p>` : ''}
        ${x.tenantNote ? `<p class="mt"><strong>Catatan penghuni:</strong> ${esc(x.tenantNote)}</p>` : ''}`,
    });
  }
  function inspectionDialog(t, kind, existing, masuk, s) {
    const base = (s.inspectionItems?.length ? s.inspectionItems : s.defaultInspectionItems) || [];
    const rows = existing ? existing.items.map((i) => ({ name: i.name, condition: i.condition, note: i.note || '', photos: (i.photos || []).map((p, k) => ({ path: p, url: i.photoUrls?.[k] || '' })) }))
      : kind === 'keluar' && masuk ? masuk.items.map((i) => ({ name: i.name, condition: 'baik', note: '', photos: [] }))
        : base.map((n) => ({ name: n, condition: 'baik', note: '', photos: [] }));
    const was = (name) => (kind === 'keluar' && masuk ? masuk.items.find((m) => m.name === name) : null);
    const rowHtml = (r, i) => { const w = was(r.name); return `<div class="insp-row" data-i="${i}">
        <input data-f="name" value="${esc(r.name)}" placeholder="Bagian kamar" aria-label="Bagian kamar">
        <select data-f="condition" aria-label="Kondisi">${Object.entries(CONDITION).map(([k, l]) => `<option value="${k}" ${r.condition === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input class="insp-note" data-f="note" value="${esc(r.note)}" placeholder="Catatan (mis. retak kecil di sudut)" aria-label="Catatan">
        <button type="button" class="icon-btn" data-rm-row aria-label="Hapus baris">✕</button>
        ${w ? `<span class="was">Saat masuk: ${CONDITION[w.condition]}${w.note ? `, ${esc(w.note)}` : ''}</span>` : ''}
        <div class="photos">${r.photos.map((p, k) => `<figure><img src="${esc(p.url)}" alt=""><button type="button" data-rm-photo="${k}" aria-label="Hapus foto">✕</button></figure>`).join('')}
          <label class="upload">+ Foto<input type="file" accept="image/jpeg,image/png,image/webp" multiple></label></div></div>`; };
    openDialog({
      wide: true, title: `${existing ? 'Ubah' : 'Catat'} kondisi kamar saat ${kind}`, ok: 'Simpan & minta persetujuan penghuni',
      body: `<div class="fields fields--3"><label>Tanggal pemeriksaan<input type="date" name="date" value="${existing?.date || today()}"></label></div>
        <p class="fieldset-title mt">Bagian kamar</p><div class="list mt" id="inspRows">${rows.map(rowHtml).join('')}</div>
        <div class="btn-row mt"><button type="button" class="btn btn--ghost btn--sm" id="inspAdd">Tambah bagian</button></div>
        <div class="fields fields--2 mt"><label class="span-all">Catatan umum<textarea name="note" rows="2">${esc(existing?.note || '')}</textarea></label>
        ${kind === 'keluar' ? `<label>Potongan deposit<input type="number" name="depositDeduction" value="${existing?.depositDeduction || 0}" min="0" step="1000"><span class="hint">Deposit penghuni: ${rp(t.deposit)}</span></label>
          <label>Alasan potongan<input name="deductionNote" value="${esc(existing?.deductionNote || '')}" placeholder="Mis. ganti kunci hilang"></label>` : ''}</div>
        <p class="hint mt">${existing?.tenantAckAt ? 'Menyimpan perubahan membuat penghuni perlu menyetujui ulang.' : 'Setelah disimpan, penghuni melihat catatan ini di dashboard dan diminta menyetujuinya.'}</p>`,
      onOpen: (b) => {
        const wrap = $('#inspRows', b);
        const redraw = () => { wrap.innerHTML = rows.map(rowHtml).join(''); };
        wrap.addEventListener('input', (e) => { const row = e.target.closest('[data-i]'); const f = e.target.dataset.f; if (row && f) rows[row.dataset.i][f] = e.target.value; });
        wrap.addEventListener('change', async (e) => {
          const row = e.target.closest('[data-i]'); if (!row) return;
          if (e.target.dataset.f) { rows[row.dataset.i][e.target.dataset.f] = e.target.value; return; }
          if (e.target.type !== 'file') return;
          const r = rows[row.dataset.i];
          for (const f of e.target.files) {
            try {
              const out = await BonaLoader.during('Mengunggah foto…', async () => api('POST', `/upload-private?kind=kondisi&tenant=${encodeURIComponent(t.id)}`, undefined, await shrink(f, 1400)));
              r.photos.push(out);
            } catch (ex) { toast(ex.message, true); }
          }
          redraw();
        });
        wrap.addEventListener('click', (e) => {
          const row = e.target.closest('[data-i]'); if (!row) return;
          if (e.target.closest('[data-rm-row]')) { rows.splice(Number(row.dataset.i), 1); redraw(); }
          const rp_ = e.target.closest('[data-rm-photo]'); if (rp_) { rows[row.dataset.i].photos.splice(Number(rp_.dataset.rmPhoto), 1); redraw(); }
        });
        $('#inspAdd', b).onclick = () => { rows.push({ name: '', condition: 'baik', note: '', photos: [] }); redraw(); $$('[data-f="name"]', wrap).pop()?.focus(); };
      },
      onOk: async (d) => {
        const items = rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), condition: r.condition, note: r.note.trim(), photos: r.photos.map((p) => p.path) }));
        if (!items.length) throw new Error('Isi minimal satu bagian kamar.');
        await api('POST', '/inspections', { tenantId: t.id, kind, date: d.date, items, note: d.note, depositDeduction: d.depositDeduction, deductionNote: d.deductionNote });
        toast('Catatan kondisi kamar disimpan.'); route();
      },
    });
  }

  // ========== PENGUMUMAN ==========
  async function pengumuman() {
    const list = await get('/announcements');
    main.innerHTML = head('Pengumuman', 'Tampil di dashboard penghuni. Terlihat siapa yang sudah membaca.', '<button class="btn btn--red" data-ann-new>Buat pengumuman</button>') +
      (list.length ? list.map((a) => {
        const pct = a.audienceCount ? Math.round((a.read.length / a.audienceCount) * 100) : 0;
        const expired = a.expiresOn && a.expiresOn < today();
        return `<article class="ann ${a.priority === 'penting' ? 'ann--penting' : ''}">
          <div class="ann__head"><div><h3>${esc(a.title)}</h3><p class="ann__meta">${esc(a.propertyName)}, ${WAKTU.format(new Date(a.createdAt))} WIB${a.expiresOn ? `, ${expired ? 'berakhir' : 'tampil sampai'} ${tgl(a.expiresOn)}` : ''}</p></div>
            <div class="btn-row">${a.priority === 'penting' ? '<span class="pill pill--penting">Penting</span>' : ''}${a.pinned ? '<span class="pill pill--info">Disematkan</span>' : ''}${expired ? '<span class="pill pill--berakhir">Tidak tampil lagi</span>' : ''}</div></div>
          ${a.body ? `<p class="ann__body">${esc(a.body)}</p>` : ''}
          <div class="readbar" role="img" aria-label="${a.read.length} dari ${a.audienceCount} penghuni sudah membaca"><span style="width:${pct}%"></span></div>
          <p class="ann__meta">Sudah dibaca ${a.read.length} dari ${a.audienceCount} penghuni.</p>
          ${a.unread.length ? `<details><summary class="small" style="cursor:pointer;font-weight:600">Belum membaca (${a.unread.length})</summary><div class="who mt">${a.unread.map((u) => u.waUrl ? `<a href="${esc(u.waUrl)}" target="_blank" rel="noopener" title="Ingatkan lewat WhatsApp">${esc(u.name)}, WA</a>` : `<span>${esc(u.name)}</span>`).join('')}</div></details>` : ''}
          ${a.read.length ? `<details><summary class="small" style="cursor:pointer">Sudah membaca (${a.read.length})</summary><div class="who mt">${a.read.map((u) => `<span>${esc(u.name)}</span>`).join('')}</div></details>` : ''}
          <div class="btn-row"><a class="btn btn--green btn--sm" href="${esc(waShare(`PENGUMUMAN BONAASINA\n${a.title}\n\n${a.body}\n\nBaca juga di dashboard penghuni: ${SITE}/penghuni/#pengumuman`))}" target="_blank" rel="noopener">Bagikan ke grup WA</a>
            <button class="btn btn--ghost btn--sm" data-ann-edit="${a.id}">Ubah</button><button class="btn btn--ghost btn--sm" data-ann-del="${a.id}">Hapus</button></div>
        </article>`;
      }).join('') : '<div class="panel empty">Belum ada pengumuman. Contoh: jadwal air mati, kerja bakti, atau perubahan aturan kos.</div>');
    main.onclick = async (e) => {
      if (e.target.closest('[data-ann-new]')) annDialog(null);
      const ed = e.target.closest('[data-ann-edit]'); if (ed) annDialog(list.find((a) => a.id === ed.dataset.annEdit));
      const del = e.target.closest('[data-ann-del]');
      if (del && (await askConfirm('Hapus pengumuman', 'Pengumuman ini akan hilang dari dashboard penghuni.', 'Hapus'))) { await api('DELETE', `/announcements/${del.dataset.annDel}`); toast('Pengumuman dihapus.'); route(); }
    };
  }
  function annDialog(a) {
    openDialog({
      title: a ? 'Ubah pengumuman' : 'Buat pengumuman', ok: a ? 'Simpan' : 'Terbitkan',
      body: `<div class="fields fields--2">
        <label class="span-all">Judul<input name="title" value="${esc(a?.title || '')}" placeholder="Mis. Air mati Sabtu pagi" required></label>
        <label class="span-all">Isi<textarea name="body" rows="6" placeholder="Jelaskan apa, kapan, dan apa yang perlu dilakukan penghuni.">${esc(a?.body || '')}</textarea></label>
        <label>Untuk<select name="propertyId"><option value="">Semua kos</option>${cache.properties.map((p) => `<option value="${p.id}" ${a?.propertyId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <label>Tingkat<select name="priority"><option value="biasa">Biasa</option><option value="penting" ${a?.priority === 'penting' ? 'selected' : ''}>Penting</option></select></label>
        <label>Tampil sampai <span class="hint">opsional</span><input type="date" name="expiresOn" value="${a?.expiresOn || ''}"></label>
        <label style="align-self:end"><input type="checkbox" name="pinned" ${a?.pinned ? 'checked' : ''}>Sematkan di atas</label>
        ${a ? '<label class="span-all"><input type="checkbox" name="resetReads">Isinya berubah penting: minta semua penghuni membaca ulang</label>' : ''}
      </div>`,
      onOk: async (d) => {
        const body = { ...d, pinned: d.pinned === 'on', resetReads: d.resetReads === 'on' };
        if (a) await api('PUT', `/announcements/${a.id}`, body); else await api('POST', '/announcements', body);
        toast(a ? 'Pengumuman diperbarui.' : 'Pengumuman terbit di dashboard penghuni.'); route();
      },
    });
  }

  // ========== PIKET ==========
  const FREQ = { harian: 'Setiap hari', mingguan: 'Setiap minggu', dua_mingguan: 'Dua minggu sekali', bulanan: 'Setiap bulan' };
  const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const hariOf = (s) => { const [y, m, d] = s.split('-').map(Number); return HARI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; };
  const CHORE_STATUS = { selesai: 'Selesai', terlewat: 'Terlewat', hari_ini: 'Hari ini', akan_datang: 'Akan datang' };
  let choreTab = 'datang';
  async function piket() {
    const d = await get('/chores');
    const items = d.items.filter((i) => (choreTab === 'datang' ? i.date >= d.today && i.date <= addDays(d.today, 14) : i.date < d.today)).sort((a, b) => (choreTab === 'datang' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
    const byDate = items.reduce((m, i) => { (m[i.date] ||= []).push(i); return m; }, {});
    const missed = d.items.filter((i) => i.status === 'terlewat' && i.date >= addDays(d.today, -7)).length;
    main.innerHTML = head('Piket', 'Jadwal kebersihan bergilir otomatis di antara penghuni aktif. Penghuni yang bertugas mengirim foto bukti dari dashboard.', '<button class="btn btn--red" data-chore-new>Tambah jadwal piket</button>') + `
      <section class="panel"><h2>Tugas piket</h2>${d.tasks.length ? `<div class="list">${d.tasks.map((t) => `<div class="list__item"><div><strong>${esc(t.name)}</strong> ${t.active ? '' : '<span class="pill pill--nonaktif">Nonaktif</span>'}
          <span class="sub">${esc(t.propertyName)}, ${FREQ[t.frequency]}${t.frequency === 'harian' ? '' : `, mulai ${hariOf(t.startDate)} ${tgl(t.startDate)}`}, ${t.mode === 'bersama' ? 'semua penghuni bersama' : `${t.peoplePerTurn} orang per giliran`}</span>${t.description ? `<span class="sub">${esc(t.description)}</span>` : ''}</div>
          <div class="btn-row"><button class="btn btn--ghost btn--sm" data-chore-edit="${t.id}">Ubah</button><button class="btn btn--ghost btn--sm" data-chore-del="${t.id}">Hapus</button></div></div>`).join('')}</div>`
        : '<p class="muted">Belum ada jadwal. Contoh: "Sapu & pel lorong" setiap minggu 2 orang bergilir, atau "Kerja bakti" setiap bulan semua penghuni.</p>'}</section>
      <div class="toolbar mt"><div class="seg" id="chSeg">${[['datang', 'Jadwal 14 hari ke depan'], ['riwayat', `Riwayat${missed ? ` (${missed} terlewat)` : ''}`]].map(([k, l]) => `<button aria-pressed="${choreTab === k}" data-k="${k}">${l}</button>`).join('')}</div></div>
      <section class="panel">${Object.keys(byDate).length ? Object.entries(byDate).map(([date, list]) => `<div class="day"><p class="day__label ${date === d.today ? 'is-today' : ''}">${date === d.today ? 'Hari ini, ' : ''}${hariOf(date)} ${tglPanjang(date)}</p><div class="list">${list.map((i) => `<div class="list__item"><div><strong>${esc(i.name)}</strong> <span class="pill pill--${i.status}">${CHORE_STATUS[i.status]}</span>
          <span class="sub">${esc(i.propertyName)}, ${i.assigned.length ? esc(i.assigned.join(', ')) : 'Belum ada penghuni aktif'}</span>
          ${i.report ? `<span class="sub">Dilaporkan ${esc(i.report.by)}, ${WAKTU.format(new Date(i.report.at))} WIB${i.report.note ? `: "${esc(i.report.note)}"` : ''}</span><div class="thumbs">${i.report.photos.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Foto piket ${esc(i.name)}"></a>`).join('')}</div>` : ''}</div></div>`).join('')}</div></div>`).join('')
        : `<p class="muted">${choreTab === 'datang' ? 'Tidak ada jadwal piket dalam 14 hari ke depan.' : 'Belum ada riwayat piket.'}</p>`}</section>`;
    $('#chSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; choreTab = b.dataset.k; route(); };
    main.onclick = async (e) => {
      if (e.target.closest('[data-chore-new]')) choreDialog(null);
      const ed = e.target.closest('[data-chore-edit]'); if (ed) choreDialog(d.tasks.find((t) => t.id === ed.dataset.choreEdit));
      const del = e.target.closest('[data-chore-del]');
      if (del && (await askConfirm('Hapus jadwal piket', 'Jadwal dan riwayat laporannya akan dihapus.', 'Hapus'))) { await api('DELETE', `/chores/${del.dataset.choreDel}`); toast('Jadwal piket dihapus.'); route(); }
    };
  }
  function choreDialog(t) {
    openDialog({
      title: t ? `Ubah piket "${t.name}"` : 'Tambah jadwal piket', ok: t ? 'Simpan' : 'Tambah',
      body: `<div class="fields fields--2">
        <label>Kos<select name="propertyId" ${t ? 'disabled' : ''}>${cache.properties.map((p) => `<option value="${p.id}" ${t?.propertyId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <label>Nama tugas<input name="name" value="${esc(t?.name || '')}" placeholder="Mis. Sapu & pel lorong" required></label>
        <label class="span-all">Rincian <span class="hint">opsional</span><textarea name="description" rows="2" placeholder="Apa saja yang dibersihkan dan foto apa yang perlu dikirim">${esc(t?.description || '')}</textarea></label>
        <label>Seberapa sering<select name="frequency">${Object.entries(FREQ).map(([k, l]) => `<option value="${k}" ${(t?.frequency || 'mingguan') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Mulai tanggal<input type="date" name="startDate" id="chStart" value="${t?.startDate || today()}"><span class="hint" id="chDay"></span></label>
        <label>Cara piket<select name="mode" id="chMode"><option value="bergilir">Bergilir (beberapa orang per giliran)</option><option value="bersama" ${t?.mode === 'bersama' ? 'selected' : ''}>Bersama (semua penghuni)</option></select></label>
        <label id="chPplWrap">Orang per giliran<input type="number" name="peoplePerTurn" min="1" max="20" value="${t?.peoplePerTurn || 1}"></label>
        ${t ? `<label class="span-all"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}>Aktif</label>` : ''}
        <p class="hint span-all">Giliran diatur otomatis berdasarkan urutan kamar penghuni aktif. Bila ada penghuni masuk atau keluar, urutan giliran menyesuaikan.</p>
      </div>`,
      onOpen: (b) => {
        const sync = () => { $('#chPplWrap', b).hidden = $('#chMode', b).value === 'bersama'; const v = $('#chStart', b).value; $('#chDay', b).textContent = v ? `Hari piket: ${hariOf(v)}` : ''; };
        $('#chMode', b).onchange = sync; $('#chStart', b).oninput = sync; sync();
      },
      onOk: async (d) => {
        const body = { ...d, active: t ? d.active === 'on' : true };
        if (t) {
          try { await api('PUT', `/chores/${t.id}`, body); }
          catch (ex) {
            // Server menahan perubahan tanggal mulai/frekuensi yang membuat laporan piket yang sudah
            // dikirim kehilangan jadwal. Admin boleh melanjutkan setelah diberi tahu akibatnya.
            if (!/force: true/.test(ex.message || '') ||
              !(await askConfirm('Bukti piket bisa hilang', `${ex.message} Lanjutkan tetap mengubah tanggal mulai/frekuensi?`, 'Ya, ubah'))) throw ex;
            await api('PUT', `/chores/${t.id}`, { ...body, force: true });
          }
        } else await api('POST', '/chores', body);
        toast(t ? 'Jadwal piket diperbarui.' : 'Jadwal piket dibuat dan langsung tampil di dashboard penghuni.'); route();
      },
    });
  }

  // ========== DAFTAR TUNGGU ==========
  const WL = { perlu_dikabari: 'Perlu dikabari', menunggu: 'Menunggu kamar', dikabari: 'Sudah dikabari', selesai: 'Selesai', batal: 'Batal' };
  let wlFilter = 'perlu_dikabari';
  async function tunggu() {
    const list = await get('/waitlist');
    const counts = Object.fromEntries(['perlu_dikabari', 'menunggu', 'dikabari'].map((k) => [k, list.filter((w) => w.status === k).length]));
    counts.semua = list.length;
    if (wlFilter === 'perlu_dikabari' && !counts.perlu_dikabari && !tunggu.visited) wlFilter = counts.menunggu ? 'menunggu' : 'semua';
    tunggu.visited = true;
    const rows = list.filter((w) => wlFilter === 'semua' || w.status === wlFilter);
    main.innerHTML = head('Daftar tunggu', 'Calon penyewa yang mendaftar saat kos penuh. Begitu ada kamar kosong, mereka otomatis ditandai "Perlu dikabari".') + `
      <div class="toolbar"><div class="seg" id="wlSeg">${[['perlu_dikabari', 'Perlu dikabari'], ['menunggu', 'Menunggu kamar'], ['dikabari', 'Sudah dikabari'], ['semua', 'Semua']].map(([k, l]) => `<button aria-pressed="${wlFilter === k}" data-k="${k}">${l} (${counts[k]})</button>`).join('')}</div></div>
      <div class="table-wrap">${rows.length ? `<table><thead><tr><th>Calon penyewa</th><th>Minat</th><th>Didaftar</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((w) => `<tr>
        <td data-label="Calon penyewa"><div class="who-cell">${window.BonaDash.avatar(w.name)}<div><strong>${esc(w.name)}</strong><span class="sub">${esc(w.phone)}</span></div></div></td>
        <td data-label="Minat" class="wrap">${esc(w.propertyName)}${w.roomPref ? `<span class="sub">${esc(w.roomPref)}</span>` : ''}${w.budget ? `<span class="sub">Anggaran ${rp(w.budget)}/bulan</span>` : ''}${w.moveDate ? `<span class="sub">Rencana masuk ${tgl(w.moveDate)}</span>` : ''}${w.note ? `<span class="sub">"${esc(w.note)}"</span>` : ''}</td>
        <td data-label="Didaftar">${tgl(w.createdAt)}</td>
        <td data-label="Status"><select class="inline" data-wl-status="${w.id}" aria-label="Status ${esc(w.name)}">${Object.entries(WL).map(([k, l]) => `<option value="${k}" ${w.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>${w.matchedRoom ? `<span class="sub">Kamar ${esc(w.matchedRoom.code)} ${esc(w.matchedRoom.propertyName || '')} ${w.matchedRoom.status === 'kosong' ? 'kosong' : `(${STATUS_KAMAR[w.matchedRoom.status] || w.matchedRoom.status})`}</span>` : ''}${w.notifiedAt ? `<span class="sub">Dikabari ${tgl(w.notifiedAt)}</span>` : ''}</td>
        <td class="actions"><a class="btn btn--green btn--sm" href="${esc(w.waUrl)}" target="_blank" rel="noopener" data-wl-wa="${w.id}">${w.status === 'perlu_dikabari' ? 'Kabari via WA' : 'Hubungi'}</a>${w.status === 'perlu_dikabari' ? `<button class="btn btn--ghost btn--sm" data-wl-done="${w.id}">Tandai dikabari</button>` : ''}<button class="btn btn--ghost btn--sm" data-wl-del="${w.id}">Hapus</button></td></tr>`).join('')}</tbody></table>`
        : `<div class="empty">${wlFilter === 'perlu_dikabari' ? 'Tidak ada calon penyewa yang perlu dikabari sekarang.' : 'Belum ada yang mendaftar. Formulir daftar tunggu ada di website.'}</div>`}</div>`;
    $('#wlSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; wlFilter = b.dataset.k; route(); };
    main.onchange = async (e) => { const s = e.target.closest('[data-wl-status]'); if (!s) return; try { await api('PUT', `/waitlist/${s.dataset.wlStatus}`, { status: s.value }); toast('Status diperbarui.'); route(); } catch (ex) { toast(ex.message, true); } };
    main.onclick = async (e) => {
      const done = e.target.closest('[data-wl-done]'); if (done) { await api('PUT', `/waitlist/${done.dataset.wlDone}`, { status: 'dikabari' }); toast('Ditandai sudah dikabari.'); route(); }
      const del = e.target.closest('[data-wl-del]');
      if (del && (await askConfirm('Hapus dari daftar tunggu', 'Data calon penyewa ini akan dihapus.', 'Hapus'))) { await api('DELETE', `/waitlist/${del.dataset.wlDel}`); toast('Dihapus dari daftar tunggu.'); route(); }
    };
  }

  // ========== PENGATURAN ==========
  async function pengaturan() {
    const s = await get('/settings'); cache.settings = s;
    const faq = s.faq || [];
    main.innerHTML = head('Pengaturan', 'Informasi umum website, pesan pengingat, templat kontrak, dan daftar periksa kamar.') + `
      <form class="settings-grid" id="setForm">
        <div class="panel fields fields--2">
          <p class="fieldset-title span-all">Kontak & pembayaran</p>
          <label>Nama pemilik / pengelola<input name="ownerName" value="${esc(s.ownerName)}"></label>
          <label>Nomor WhatsApp untuk website<input name="whatsapp" inputmode="tel" value="${esc(s.whatsapp)}"><span class="hint">Calon penyewa akan menghubungi nomor ini.</span></label>
          <label class="span-all">Email notifikasi admin <span class="hint">kosong = email login admin; pisahkan dengan koma</span><input name="notifyEmail" inputmode="email" value="${esc(s.notifyEmail || '')}" placeholder="bonaasinaa@gmail.com"><span class="hint">Survei, reservasi, bukti bayar, laporan kerusakan, kontrak, dan pendaftaran mitra dikirim ke sini.</span></label>
          <label class="span-all">Info rekening / cara bayar <span class="hint">dimasukkan ke pesan pengingat</span><textarea name="paymentInfo" rows="2">${esc(s.paymentInfo)}</textarea></label>
          <label class="span-all">Metode pembayaran (tampil di website)<input name="paymentMethods" value="${esc(s.paymentMethods)}"></label>
          <label class="span-all">Aturan deposit (tampil di website)<input name="depositInfo" value="${esc(s.depositInfo)}"></label>
          <label>Jam survei<input name="surveyHours" value="${esc(s.surveyHours)}"></label>
          <label>Buat tagihan berapa hari sebelum jatuh tempo<input type="number" name="invoiceLeadDays" min="0" max="60" value="${esc(s.invoiceLeadDays ?? 7)}"></label>
        </div>
        <div class="panel fields">
          <p class="fieldset-title">Halaman depan</p>
          ${window.BonaDash.logoField('brandLogo', s.brandLogo || '/assets/img/logo-bonaasina.webp', 'Logo Bonaasina (header, footer & halaman masuk)', '/assets/img/logo-bonaasina.webp')}
          <label>Kalimat pembuka<input name="tagline" value="${esc(s.tagline)}"></label>
          <label>Kata yang berganti di judul <span class="hint">satu per baris: "Pulang ke kamar yang …"</span><textarea name="heroWords" rows="4">${lines(s.heroWords)}</textarea></label>
        </div>
        <div class="panel fields">
          <p class="fieldset-title">Pesan pengingat WhatsApp</p>
          <label>Isi pesan<textarea name="reminderTemplate" rows="8" id="tpl">${esc(s.reminderTemplate || s.defaultReminderTemplate)}</textarea>
            <span class="hint">Kata dalam kurung kurawal diganti otomatis: {nama} {kos} {kamar} {periode} {jumlah} {jatuh_tempo} {keterlambatan} {rekening}</span></label>
          <div><button type="button" class="btn btn--ghost btn--sm" id="tplReset">Kembalikan pesan bawaan</button></div>
          <div class="preview" id="tplPreview" aria-live="polite"></div>
        </div>
        <div class="panel fields span-all">
          <p class="fieldset-title">Templat kontrak sewa</p>
          <label>Isi templat<textarea class="doc-edit" name="contractTemplate" id="ctrTpl" rows="14">${esc(s.contractTemplate || s.defaultContractTemplate)}</textarea>
            <span class="hint">Baris berawalan "## " menjadi judul pasal. Diganti otomatis: {tanggal_kontrak} {pemilik} {kos} {alamat_kos} {nama_penghuni} {telepon_penghuni} {asal} {kamar} {tipe_kamar} {mulai} {selesai} {harga} {siklus} {deposit} {aturan} {cara_bayar}</span></label>
          <p class="hint">Draf ini disiapkan sebagai titik awal, bukan nasihat hukum. Baca ulang dan sesuaikan dengan kebiasaan dan aturan kos Anda. Kontrak yang sudah dibuat tidak ikut berubah bila templat diubah.</p>
          <div><button type="button" class="btn btn--ghost btn--sm" id="ctrTplReset">Kembalikan templat bawaan</button></div>
        </div>
        <div class="panel fields">
          <p class="fieldset-title">Daftar periksa kondisi kamar</p>
          <label>Bagian kamar yang diperiksa <span class="hint">satu per baris</span><textarea name="inspectionItems" rows="9">${lines(s.inspectionItems?.length ? s.inspectionItems : s.defaultInspectionItems)}</textarea></label>
          <p class="hint">Dipakai sebagai daftar awal saat mencatat kondisi kamar penghuni yang masuk.</p>
        </div>
        <div class="panel fields">
          <p class="fieldset-title">Tanya jawab di website</p>
          <div id="faqRows" class="fields">${faq.map(faqRow).join('')}</div>
          <div><button type="button" class="btn btn--ghost btn--sm" id="faqAdd">Tambah pertanyaan</button></div>
        </div>
        <div class="form-actions"><button class="btn btn--red" type="submit">Simpan pengaturan</button><button type="button" class="btn btn--ghost" id="expBtn">Unduh cadangan data</button></div>
      </form>`;
    const preview = () => {
      $('#tplPreview').textContent = $('#tpl').value
        .replaceAll('{nama}', 'Rina').replaceAll('{kos}', 'Kos Asina').replaceAll('{kamar}', 'A-01').replaceAll('{periode}', 'Oktober 2026')
        .replaceAll('{jumlah}', 'Rp550.000').replaceAll('{jatuh_tempo}', '18 Oktober 2026').replaceAll('{keterlambatan}', ' Saat ini sudah lewat 3 hari.')
        .replaceAll('{rekening}', $('[name=paymentInfo]').value || '-');
    };
    preview(); $('#tpl').oninput = preview; $('[name=paymentInfo]').addEventListener('input', preview);
    window.BonaDash.bindLogo(main, 'brandLogo', uploadBlob, (ex) => toast(ex.message, true));
    $('#tplReset').onclick = () => { $('#tpl').value = s.defaultReminderTemplate; preview(); };
    $('#ctrTplReset').onclick = () => { $('#ctrTpl').value = s.defaultContractTemplate; };
    $('#faqAdd').onclick = () => { $('#faqRows').insertAdjacentHTML('beforeend', faqRow({ q: '', a: '' })); $('#faqRows .faq-row:last-child input').focus(); };
    $('#faqRows').onclick = (e) => { const b = e.target.closest('[data-rm-faq]'); if (b) b.closest('.faq-row').remove(); };
    $('#expBtn').addEventListener('click', async () => {
      try { saveBlob(new Blob([JSON.stringify(await api('GET', '/export'), null, 2)], { type: 'application/json' }), `bonaasina-cadangan-${today()}.json`); }
      catch (ex) { toast(ex.message, true); }
    });
    $('#setForm').onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      d.faq = $$('.faq-row').map((r) => ({ q: $('input', r).value, a: $('textarea', r).value }));
      for (const k of Object.keys(d)) if (k.startsWith('faq_')) delete d[k];
      try { cache.settings = await api('PUT', '/settings', d); toast('Pengaturan disimpan. Website ikut berubah.'); }
      catch (ex) { toast(ex.message, true); }
    };
  }
  function faqRow(f) {
    return `<div class="faq-row"><label>Pertanyaan<input name="faq_q" value="${esc(f.q)}"></label><label>Jawaban<textarea name="faq_a" rows="2">${esc(f.a)}</textarea></label><div><button type="button" class="btn btn--ghost btn--sm" data-rm-faq>Hapus</button></div></div>`;
  }

  // ================================================================ KOS SEKITAR (kemitraan)
  const MK = window.BonaMarket;
  const PROP_STATUS = { draf: 'Masih dilengkapi pemilik', menunggu: 'Minta ditampilkan', aktif: 'Tampil di website', nonaktif: 'Disembunyikan' };
  let resFilter = 'tindakan', resKos = 'semua';
  const leadCtx = (l) => ({
    role: 'admin', api, base: `/leads/${l.id}`, openDialog, askConfirm, toast, saveBlob, shrink: (f) => shrink(f, 1600),
    rooms: store.get('/rooms')?.data || [], minBooking: (x) => cache.allProps.find((p) => p.id === x.propertyId)?.minBooking || 0,
    reload: () => route(),
    extraActions: (x) => (x.propertyKind !== 'mitra' && x.status === 'berhasil' && !x.tenantId ? '<button class="btn btn--red" data-make-tenant>Jadikan penghuni</button>' : ''),
  });
  const needsAdmin = (l) => l.needsApproval || l.feeToReturn || ['diminta', 'dilaporkan', 'ditolak'].includes(l.refundStatus) || l.noResponse || l.feeOverdue
    || (l.propertyKind !== 'mitra' && ['baru', 'dp_dikirim'].includes(l.status)) || (l.propertyKind !== 'mitra' && l.visitStatus === 'diminta' && ['baru', 'menunggu_dp'].includes(l.status));

  function leadRows(list, empty) {
    return list.length ? `<table><thead><tr><th>Calon penyewa</th><th>Kos & kamar</th><th>Sewa</th><th>Status</th><th class="num">DP / fee</th><th></th></tr></thead><tbody>${list.map((l) => `<tr>
      <td data-label="Calon penyewa"><div class="who-cell">${window.BonaDash.avatar(l.name)}<div><a href="#reservasi?id=${l.id}"><strong>${esc(l.name)}</strong></a>${l.unread && l.propertyKind !== 'mitra' ? `<span class="unread">${l.unread}</span>` : ''}<span class="sub">${esc(l.phone)}, ${MK.relTime(l.createdAt)}</span></div></div></td>
      <td data-label="Kos & kamar">${esc(l.propertyName)}<span class="sub">${esc(l.roomCode || 'kamar belum dipilih')}, ${l.propertyKind === 'mitra' ? `mitra: ${esc(l.ownerName)}` : 'kos Bonaasina'}</span></td>
      <td data-label="Sewa">${esc(l.periodLabel)}<span class="sub">mulai ${tgl(l.moveDate)}${l.people === 2 ? ', 2 orang' : ''}</span></td>
      <td data-label="Status">${MK.pill(l)}${MK.flags(l)}</td>
      <td class="num" data-label="DP / fee">${l.dpAmount ? rp(l.dpAmount) : '-'}${l.feeAmount ? `<span class="sub">fee ${rp(l.feeAmount)}</span>` : ''}</td>
      <td class="actions"><a class="btn btn--${l.needsApproval ? 'green' : 'ghost'} btn--sm" href="#reservasi?id=${l.id}">${l.needsApproval ? 'Periksa & setujui' : 'Buka'}</a></td></tr>`).join('')}</tbody></table>` : `<div class="empty">${empty}</div>`;
  }

  // ---------- reservasi ----------
  async function reservasi() {
    const id = hashParams().get('id');
    if (id) return reservasiDetail(id);
    const all = await get('/leads');
    const F = { tindakan: needsAdmin, berjalan: (l) => ['baru', 'menunggu_dp', 'dp_dikirim', 'dp_diterima'].includes(l.status), berhasil: (l) => l.status === 'berhasil', selesai: (l) => ['ditolak', 'batal', 'kedaluwarsa'].includes(l.status), semua: () => true };
    const draw = () => {
      let list = all.filter(F[resFilter]);
      if (resKos === 'mitra') list = list.filter((l) => l.propertyKind === 'mitra'); else if (resKos === 'sendiri') list = list.filter((l) => l.propertyKind !== 'mitra');
      $('#resTable').innerHTML = leadRows(list, resFilter === 'tindakan' ? 'Tidak ada reservasi yang perlu tindakan admin.' : 'Tidak ada data.');
    };
    const n = all.filter(needsAdmin).length;
    main.innerHTML = head('Reservasi', 'Semua pesanan dari website. Kos Asina & Bona Anda kelola langsung, kos mitra cukup dipantau dan disetujui.') + `
      <div class="grid grid--stats">
        <div class="panel stat ${n ? 'stat--alert' : ''}"><p class="stat__label">Perlu tindakan admin</p><p class="stat__value">${n}</p><p class="stat__sub">persetujuan, refund, belum direspons</p></div>
        <div class="panel stat"><p class="stat__label">Berjalan</p><p class="stat__value">${all.filter(F.berjalan).length}</p><p class="stat__sub">${all.filter((l) => l.status === 'baru').length} menunggu konfirmasi</p></div>
        <div class="panel stat"><p class="stat__label">Booking berhasil</p><p class="stat__value">${all.filter(F.berhasil).length}</p><p class="stat__sub">${rp(all.filter(F.berhasil).reduce((a, l) => a + (l.dpAmount || 0), 0))} DP</p></div>
        <div class="panel stat"><p class="stat__label">Konversi</p><p class="stat__value">${all.length ? Math.round((all.filter(F.berhasil).length / all.length) * 100) : 0}%</p><p class="stat__sub">dari ${all.length} reservasi</p></div>
      </div>
      <div class="toolbar mt"><div class="seg" id="resSeg">${[['tindakan', 'Perlu tindakan'], ['berjalan', 'Berjalan'], ['berhasil', 'Berhasil'], ['selesai', 'Selesai/batal'], ['semua', 'Semua']].map(([k, t]) => `<button aria-pressed="${resFilter === k}" data-k="${k}">${t}</button>`).join('')}</div>
        <div class="seg" id="resKos">${[['semua', 'Semua kos'], ['sendiri', 'Asina & Bona'], ['mitra', 'Kos mitra']].map(([k, t]) => `<button aria-pressed="${resKos === k}" data-k="${k}">${t}</button>`).join('')}</div></div>
      <div class="table-wrap" id="resTable"></div>`;
    draw();
    $('#resSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; resFilter = b.dataset.k; $$('#resSeg button').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(); };
    $('#resKos').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; resKos = b.dataset.k; $$('#resKos button').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(); };
  }
  let adminChat = null;
  async function reservasiDetail(id) {
    adminChat?.stop();
    const l = await api('GET', `/leads/${id}`);
    const ctx = leadCtx(l);
    const own = l.propertyKind !== 'mitra';
    main.innerHTML = `<a class="back" href="#reservasi">← Semua reservasi</a>` + head(esc(l.name), `${esc(l.propertyName)}${own ? ' (kos Bonaasina — Anda pemiliknya)' : ` (mitra: ${esc(l.ownerName)})`}, ${esc(l.periodLabel)} mulai ${tgl(l.moveDate)}`,
      `<a class="btn btn--green" href="https://wa.me/${esc(l.waCustomer)}" target="_blank" rel="noopener">WhatsApp penyewa</a>${!own && l.ownerPhone ? `<a class="btn btn--ghost" href="${esc(waMe(l.ownerPhone, `Horas ${l.ownerName}, ini admin Bonaasina soal reservasi ${l.name} (#${l.code}) di ${l.propertyName}. `))}" target="_blank" rel="noopener">WhatsApp pemilik</a>` : ''}`) +
      `<div class="lead-grid"><div id="leadPanel">${MK.leadPanel(l, ctx)}</div><div><div id="chatBox"></div><p class="hint">${own ? 'Anda membalas sebagai pemilik kos.' : 'Pesan Anda tampil sebagai “Admin Bonaasina” bagi penyewa dan pemilik.'}</p></div></div>`;
    MK.bindLead($('#leadPanel'), l, ctx);
    $('[data-make-tenant]')?.addEventListener('click', async () => {
      const rooms = await get('/rooms');
      tenantDialog(null, rooms, { leadId: l.id, name: l.name, phone: l.phone, email: l.email || '', occupation: l.occupation, roomId: l.roomId, rentCycle: l.period, startDate: l.moveDate, endDate: l.period === 'harian' ? l.endDate : '' });
      setTimeout(() => { const sel = $('#tRoom'); if (sel && l.roomId) { sel.value = l.roomId; sel.dispatchEvent(new Event('change')); } }, 50);
    });
    adminChat = MK.chat($('#chatBox'), {
      title: own ? `Chat dengan ${l.name}` : `Percakapan ${l.name} & pemilik`, me: 'admin', enabled: true,
      who: { customer: l.name, pemilik: `Pemilik (${l.ownerName})`, admin: own ? 'Pengelola' : 'Admin Bonaasina' },
      load: (after) => api('GET', `/leads/${id}/messages?after=${after}`), send: (body) => api('POST', `/leads/${id}/messages`, { body }),
    });
  }

  // ---------- persetujuan & refund ----------
  async function persetujuan() {
    const all = await get('/leads');
    const groups = [
      ['Perlu disetujui', 'Pemilik sudah menerima DP dan mengirim bukti fee (atau tanpa fee). Periksa kedua bukti lalu setujui.', all.filter((l) => l.needsApproval)],
      ['Menunggu fee dari pemilik', 'DP sudah diterima pemilik, bukti fee belum ada.', all.filter((l) => l.status === 'dp_diterima' && ['belum', 'ditolak'].includes(l.feeStatus))],
      ['Refund berjalan', 'Pantau supaya uang penyewa kembali. Anda bisa meminta pemilik memproses atau menutup refund.', all.filter((l) => ['diminta', 'dilaporkan', 'ditolak', 'dikirim'].includes(l.refundStatus))],
      ['Fee perlu dikembalikan', 'Booking batal dan DP sudah dikembalikan; kembalikan fee ke pemilik lalu tandai.', all.filter((l) => l.feeToReturn)],
      ['Belum direspons pemilik', `Reservasi baru lebih dari ${cache.settings?.leadResponseHours || 24} jam tanpa jawaban. Hubungi pemilik atau bantu konfirmasi.`, all.filter((l) => l.noResponse)],
    ];
    main.innerHTML = head('Persetujuan & refund', 'Setiap transaksi Kos Sekitar dinyatakan berhasil setelah Anda memeriksa bukti DP penyewa dan bukti fee pemilik.') +
      groups.map(([t, sub, list]) => `<div class="panel mt"><h2>${t} <span class="pill pill--${list.length ? 'baru' : 'aktif'}">${list.length}</span></h2><p class="muted small" style="margin:-6px 0 10px">${sub}</p><div class="table-wrap">${leadRows(list, 'Tidak ada.')}</div></div>`).join('');
  }

  // ---------- mitra kos ----------
  async function mitra() {
    const [parts, owners, rooms] = await Promise.all([get('/partners'), get('/owners'), get('/rooms')]);
    const s = cache.settings || {};
    main.innerHTML = head('Mitra kos', `Kos milik mitra yang tampil di <a href="/kos-sekitar/" target="_blank" rel="noopener">Kos Sekitar</a>. Isi kos & kamar dikelola pemiliknya; Anda mengatur status tampil dan fee. Fee bawaan: ${s.feeDefaultType === 'nominal' ? rp(s.feeDefaultValue) : `${s.feeDefaultValue ?? 10}% dari DP`} (ubah di Fee & aturan).`,
      '<button class="btn btn--red" id="addKos">Tambah kos mitra</button>') +
      (parts.length ? parts.map((p) => {
        const rs = rooms.filter((r) => r.propertyId === p.id);
        return `<div class="panel mt"><div class="row-between"><div><h2 style="margin:0">${esc(p.name)} <span class="pill pill--${p.status === 'aktif' ? 'aktif' : p.status === 'menunggu' ? 'baru' : 'draf'}">${PROP_STATUS[p.status]}</span></h2>
            <p class="muted small">${esc(p.owner ? `${p.owner.name} (${p.owner.username})` : 'Belum ada pemilik')}, ${esc(p.city || 'kota belum diisi')}, periode ${(p.periods || []).map((k) => CYCLE_NAME[k]).join(', ')}, fee ${esc(p.feeRule)}, DP min. ${rp(p.minBooking)}</p></div>
            <div class="btn-row">${p.status === 'menunggu' ? `<button class="btn btn--green btn--sm" data-pub="${p.id}">Tampilkan di website</button>` : ''}${p.status === 'aktif' ? `<a class="btn btn--ghost btn--sm" href="/kos/?k=${esc(p.slug)}" target="_blank" rel="noopener">Lihat halaman</a>` : ''}<button class="btn btn--ghost btn--sm" data-edit-kos="${p.id}">Atur status & fee</button></div></div>
          <div class="grid grid--stats mt" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
            <div><p class="stat__label">Kamar kosong</p><p class="stat__value">${p.freeRooms}/${p.totalRooms}</p></div><div><p class="stat__label">Reservasi aktif</p><p class="stat__value">${p.leadsActive}</p></div>
            <div><p class="stat__label">Booking berhasil</p><p class="stat__value">${p.bookings}</p></div><div><p class="stat__label">Fee diterima</p><p class="stat__value">${rp(p.feeReceived)}</p></div><div><p class="stat__label">Fee belum masuk</p><p class="stat__value">${rp(p.feeOpen)}</p></div></div>
          ${rs.length ? `<details class="mt"><summary class="small"><strong>${rs.length} kamar</strong> — lihat & ubah</summary><div class="table-wrap mt"><table><tbody>${rs.map((r) => `<tr><td data-label="Kamar"><strong>${esc(r.code)}</strong><span class="sub">${esc(r.type || '')}${Number(r.capacity) === 2 ? ', 2 orang' : ''}</span></td><td data-label="Harga">${(p.periods || []).map((k) => `${CYCLE_NAME[k]} ${rp(r[CYCLE_PRICE[k]])}`).join(', ')}</td><td data-label="Status"><span class="pill pill--${r.effectiveStatus}">${STATUS_KAMAR[r.effectiveStatus]}</span></td></tr>`).join('')}</tbody></table></div></details>` : '<p class="hint mt">Belum ada kamar. Kamar, harga, dan foto diisi pemilik dari dashboard-nya.</p>'}
          ${p.reviewNote ? `<p class="hint">Catatan untuk pemilik: ${esc(p.reviewNote)}</p>` : ''}</div>`;
      }).join('') : '<div class="panel empty mt">Belum ada kos mitra. Buat akun pemilik dulu di menu Pemilik kos, lalu tambahkan kosnya di sini.</div>');
    main.onclick = async (e) => {
      if (e.target.closest('#addKos')) {
        if (!owners.length) { toast('Buat akun pemilik dulu di menu Pemilik kos.', true); location.hash = '#pemilik'; return; }
        openDialog({
          title: 'Tambah kos mitra', ok: 'Buat kos',
          body: `<div class="fields fields--2"><label class="span-all">Nama kos<input name="name" required placeholder="Kos Melati"></label>
            <label>Pemilik<select name="ownerId" required>${owners.map((o) => `<option value="${o.id}">${esc(o.name)} (${esc(o.username)})</option>`).join('')}</select></label>
            <label>Khusus<select name="gender"><option>Putri</option><option>Putra</option><option selected>Campur</option><option>Pasutri</option></select></label>
            <label>Kota / daerah<input name="city" placeholder="Balige"></label>
            <label>Jenis fee<select name="feeType"><option value="">Ikut fee bawaan</option><option value="persen">Persen dari DP</option><option value="nominal">Nominal tetap</option></select></label>
            <label>Nilai fee <span class="hint">% atau Rp</span><input type="number" name="feeValue" min="0" step="0.5"></label>
            <p class="hint span-all">Kos dibuat sebagai draf. Foto, kamar, harga, rekening, dan aturan diisi pemilik sendiri dari dashboard-nya, lalu ia meminta kosnya ditampilkan.</p></div>`,
          onOk: async (d) => {
            d.kind = 'mitra';
            await api('POST', '/properties', d); setProps(await api('GET', '/properties')); toast('Kos mitra dibuat (draf). Kabari pemilik untuk melengkapi.'); route();
          },
        });
      }
      const pub = e.target.closest('[data-pub]');
      if (pub) { if (await askConfirm('Tampilkan kos ini?', 'Kos akan tampil di halaman Kos Sekitar dan bisa menerima pesanan.', 'Tampilkan')) { await api('PUT', `/properties/${pub.dataset.pub}`, { status: 'aktif', reviewNote: '' }); setProps(await api('GET', '/properties')); toast('Kos tampil di website. Pemilik mendapat notifikasi.'); route(); } }
      const ek = e.target.closest('[data-edit-kos]'); if (ek) mitraDialog(parts.find((p) => p.id === ek.dataset.editKos), owners);
    };
  }


  // Admin hanya mengatur status tampil, pemilik, dan fee; isi kos & kamar diisi pemiliknya.
  function mitraDialog(p, owners) {
    openDialog({
      title: `Atur ${p.name}`, ok: 'Simpan',
      body: `<div class="fields fields--2">
        <label class="span-all">Nama kos<input name="name" value="${esc(p.name)}" required></label>
        <label>Status di website<select name="status">${Object.entries(PROP_STATUS).map(([k, v]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Pemilik<select name="ownerId">${owners.map((o) => `<option value="${o.id}" ${p.ownerId === o.id ? 'selected' : ''}>${esc(o.name)} (${esc(o.username)})</option>`).join('')}</select></label>
        <label>Fee<select name="feeType"><option value="">Ikut fee bawaan</option><option value="persen" ${p.feeType === 'persen' ? 'selected' : ''}>Persen dari DP</option><option value="nominal" ${p.feeType === 'nominal' ? 'selected' : ''}>Nominal tetap per booking</option></select></label>
        <label>Nilai fee <span class="hint">% atau Rp</span><input type="number" name="feeValue" min="0" step="0.5" value="${p.feeValue ?? ''}"></label>
        <label class="span-all">Pesan untuk pemilik <span class="hint">opsional, tampil di dashboard pemilik</span><input name="reviewNote" value="${esc(p.reviewNote || '')}" placeholder="Mis. tambahkan foto kamar mandi sebelum ditampilkan"></label>
        ${window.BonaDash.logoField('logo', p.logo, 'Logo kos')}
        <p class="hint span-all">Foto, kamar, harga, rekening, dan aturan kos diisi oleh pemilik dari dashboard-nya. Logo juga bisa diganti pemilik.</p></div>`,
      onOpen: (b) => window.BonaDash.bindLogo(b, 'logo', uploadBlob, (ex) => toast(ex.message, true)),
      onOk: async (d) => { await api('PUT', `/properties/${p.id}`, d); setProps(await api('GET', '/properties')); toast('Tersimpan.'); route(); },
    });
  }

  // ========== TITIP JUALAN & JASA ==========
  let titipFilter = 'baru';
  async function titip() {
    const D = window.BonaDash;
    const { listings: all, categories } = await get('/listings');
    const today = new Date().toISOString().slice(0, 10);
    const isExp = (l) => l.status === 'aktif' && l.expiresOn && l.expiresOn < today;
    const list = all.filter((l) => titipFilter === 'semua' || (titipFilter === 'kedaluwarsa' ? isExp(l) : l.status === titipFilter && !(titipFilter === 'aktif' && isExp(l))));
    const n = (st) => all.filter((l) => l.status === st && !(st === 'aktif' && isExp(l))).length;
    const ST = { baru: ['Menunggu dicek', 'baru'], aktif: ['Tampil', 'aktif'], ditolak: ['Ditolak', 'batal'], selesai: ['Selesai/laku', 'keluar'] };
    main.innerHTML = head('Titip jualan & jasa', 'Iklan barang dan jasa mahasiswa dari halaman <a href="/titip/" target="_blank" rel="noopener">Titip jualan</a>. Cek isinya, lalu tampilkan. Pembeli menghubungi penjual langsung lewat WhatsApp.',
      '<a class="btn btn--ghost" href="/titip/" target="_blank" rel="noopener">Lihat halaman</a><button class="btn btn--red" id="addTitip">Tambah iklan</button>') + `
      <div class="toolbar"><div class="seg" id="tjSeg">${[['baru', `Menunggu (${n('baru')})`], ['aktif', `Tampil (${n('aktif')})`], ['kedaluwarsa', 'Lewat masa tayang'], ['selesai', 'Selesai'], ['ditolak', 'Ditolak'], ['semua', 'Semua']].map(([k, t]) => `<button aria-pressed="${titipFilter === k}" data-k="${k}">${t}</button>`).join('')}</div></div>
      ${list.length ? `<div class="apps">${list.map((l) => `<article class="panel listing-card">
        <div class="listing-card__top">${l.photos?.[0] ? `<a class="listing-card__img" href="${esc(l.photos[0])}" target="_blank" rel="noopener"><img src="${esc(l.photos[0])}" alt="" loading="lazy"></a>` : `<div class="listing-card__img is-empty">${D.ico(l.kind === 'jasa' ? 'tool' : 'bag')}</div>`}
          <div style="min-width:0;flex:1"><div class="row-between"><span class="pill pill--${isExp(l) ? 'berakhir' : ST[l.status][1]}">${isExp(l) ? 'Lewat masa tayang' : ST[l.status][0]}</span>${l.featured ? '<span class="pill pill--info">Disorot</span>' : ''}</div>
          <h2 style="margin:8px 0 2px">${esc(l.title)}</h2><p class="small muted">${l.kind === 'jasa' ? 'Jasa' : 'Jualan'}, ${esc(l.category)}</p>
          <p class="listing-card__price">${l.price != null ? rp(l.price) : 'Harga nego'}${l.priceNote ? ` <span>${esc(l.priceNote)}</span>` : ''}</p></div></div>
        <p class="small" style="white-space:pre-wrap">${esc(l.description)}</p>
        <dl class="kv"><dt>Penjual</dt><dd>${esc(l.sellerName)}${l.sellerInfo ? `, ${esc(l.sellerInfo)}` : ''}</dd><dt>WhatsApp</dt><dd><a href="https://wa.me/${esc(l.waSeller)}" target="_blank" rel="noopener">${esc(l.sellerPhone)}</a></dd>
          ${l.area ? `<dt>Lokasi</dt><dd>${esc(l.area)}</dd>` : ''}<dt>Masuk</dt><dd>${MK.relTime(l.createdAt)}</dd>${l.expiresOn ? `<dt>Tayang sampai</dt><dd>${tgl(l.expiresOn)}</dd>` : ''}${l.adminNote ? `<dt>Catatan admin</dt><dd>${esc(l.adminNote)}</dd>` : ''}</dl>
        <div class="btn-row">${l.status === 'baru' ? `<button class="btn btn--green btn--sm" data-tj-ok="${l.id}">Tampilkan</button><button class="btn btn--ghost btn--sm" data-tj-no="${l.id}">Tolak</button>` : ''}
          ${l.status === 'aktif' && !isExp(l) ? `<button class="btn btn--ghost btn--sm" data-tj-done="${l.id}">Tandai laku/selesai</button>` : ''}${isExp(l) || l.status === 'selesai' ? `<button class="btn btn--ghost btn--sm" data-tj-ok="${l.id}">Tayangkan lagi</button>` : ''}
          <button class="btn btn--ghost btn--sm" data-tj-edit="${l.id}">Ubah</button><button class="btn btn--ghost btn--sm" data-tj-del="${l.id}" aria-label="Hapus iklan">Hapus</button></div></article>`).join('')}</div>`
        : `<div class="panel empty">${titipFilter === 'baru' ? 'Belum ada iklan baru. Bagikan tautan <strong>' + esc(location.host) + '/titip</strong> ke grup mahasiswa.' : 'Tidak ada data.'}</div>`}`;
    $('#tjSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; titipFilter = b.dataset.k; route(); };
    const form = (l = {}) => `<div class="fields fields--2">
        <label>Jenis<select name="kind" id="tjKind">${[['jual', 'Jualan barang'], ['jasa', 'Jasa']].map(([k, v]) => `<option value="${k}" ${l.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Kategori<select name="category" id="tjCat"></select></label>
        <label class="span-all">Nama barang/jasa<input name="title" value="${esc(l.title || '')}" required></label>
        <label class="span-all">Keterangan<textarea name="description" rows="3">${esc(l.description || '')}</textarea></label>
        <label>Harga <span class="hint">kosong = nego</span><input type="number" name="price" min="0" step="500" value="${l.price ?? ''}"></label>
        <label>Keterangan harga<input name="priceNote" value="${esc(l.priceNote || '')}" placeholder="per jam, mulai dari, dll."></label>
        <label>Nama penjual<input name="sellerName" value="${esc(l.sellerName || '')}" required></label>
        <label>WhatsApp penjual<input name="sellerPhone" inputmode="tel" value="${esc(l.sellerPhone || '')}" required></label>
        <label>Kampus/jurusan atau kos<input name="sellerInfo" value="${esc(l.sellerInfo || '')}"></label>
        <label>Lokasi ambil/antar<input name="area" value="${esc(l.area || '')}"></label>
        <label>Tayang sampai<input type="date" name="expiresOn" value="${esc(l.expiresOn || '')}"></label>
        <label><input type="checkbox" name="featured" ${l.featured ? 'checked' : ''}> Sorot di urutan atas</label>
        ${photoField('photos', l.photos || [])}</div>`;
    const bindForm = (b, l = {}) => {
      const fill = () => { const k = $('#tjKind', b).value; $('#tjCat', b).innerHTML = categories[k].map((c) => `<option ${l.category === c ? 'selected' : ''}>${esc(c)}</option>`).join(''); };
      fill(); $('#tjKind', b).onchange = fill; bindPhotos(b, 'photos');
    };
    const prep = (d) => { d.photos = JSON.parse(d.photos || '[]'); d.featured = d.featured === 'on'; return d; };
    $('#addTitip').onclick = () => openDialog({ title: 'Tambah iklan', ok: 'Simpan & tampilkan', wide: true, body: form(), onOpen: (b) => bindForm(b),
      onOk: async (d) => { d = prep(d); const r = await api('POST', '/listings', d); toast('Iklan ditambahkan.'); titipFilter = 'aktif'; route(); return r; } });
    main.onclick = async (e) => {
      const t = (k) => e.target.closest(`[data-tj-${k}]`)?.getAttribute(`data-tj-${k}`);
      const id = t('ok') || t('no') || t('done') || t('edit') || t('del'); if (!id) return;
      const l = all.find((x) => x.id === id);
      const setStatus = async (status, extra = {}) => {
        const out = await api('PUT', `/listings/${id}`, { status, ...extra });
        toast(status === 'aktif' ? 'Iklan tampil di website.' : status === 'ditolak' ? 'Iklan ditolak.' : 'Iklan ditandai selesai.'); route();
        if (out.wa) setTimeout(() => waDialog('Kabari penjual', 'Kirim kabar supaya penjual tahu status iklannya.', { url: out.wa, text: decodeURIComponent(out.wa.split('text=')[1] || '') }), 80);
      };
      try {
        if (t('ok')) await setStatus('aktif', l.status !== 'baru' ? { expiresOn: '' } : {});
        if (t('done')) await setStatus('selesai');
        if (t('no')) openDialog({ title: `Tolak "${l.title}"`, ok: 'Tolak', body: '<label>Alasan <span class="hint">opsional, ikut dalam pesan WhatsApp</span><input name="adminNote" placeholder="Mis. foto kurang jelas atau barang tidak boleh dijual"></label>', onOk: async (d) => setStatus('ditolak', d) });
        if (t('edit')) openDialog({ title: 'Ubah iklan', ok: 'Simpan', wide: true, body: form(l), onOpen: (b) => bindForm(b, l), onOk: async (d) => { await api('PUT', `/listings/${id}`, prep(d)); toast('Perubahan disimpan.'); route(); } });
        if (t('del')) { if (!(await askConfirm('Hapus iklan?', `"${l.title}" dan fotonya akan dihapus permanen.`, 'Hapus'))) return; await api('DELETE', `/listings/${id}`); toast('Iklan dihapus.'); route(); }
      } catch (ex) { toast(ex.message, true); }
    };
  }

  // ========== TEMPAT SEKITAR ==========
  let tempatFilter = 'aktif';
  async function tempat() {
    const D = window.BonaDash;
    const { places: all, categories } = await get('/places');
    const list = all.filter((p) => tempatFilter === 'semua' || p.status === tempatFilter);
    const n = (st) => all.filter((p) => p.status === st).length;
    const ST = { usulan: ['Usulan baru', 'baru'], aktif: ['Tampil', 'aktif'], ditolak: ['Ditolak', 'batal'], tutup: ['Tutup', 'keluar'] };
    main.innerHTML = head('Tempat sekitar', 'Warung, toko, laundry, dan tempat penting lain di sekitar kos. Tampil di halaman <a href="/sekitar/" target="_blank" rel="noopener">Info sekitar</a>; pengunjung juga bisa mengusulkan tempat baru.',
      '<a class="btn btn--ghost" href="/sekitar/" target="_blank" rel="noopener">Lihat halaman</a><button class="btn btn--red" id="addPlace">Tambah tempat</button>') + `
      <div class="toolbar"><div class="seg" id="tpSeg">${[['aktif', `Tampil (${n('aktif')})`], ['usulan', `Usulan (${n('usulan')})`], ['tutup', 'Tutup'], ['ditolak', 'Ditolak'], ['semua', 'Semua']].map(([k, t]) => `<button aria-pressed="${tempatFilter === k}" data-k="${k}">${t}</button>`).join('')}</div></div>
      <div class="table-wrap">${list.length ? `<table><thead><tr><th>Tempat</th><th>Kategori</th><th>Jarak & jam buka</th><th>Status</th><th></th></tr></thead><tbody>${list.map((p) => `<tr>
        <td data-label="Tempat"><div class="who-cell">${p.photo ? `<img class="av" src="${esc(p.photo)}" alt="" style="object-fit:cover">` : D.avatar(p.name)}<div><strong>${esc(p.name)}</strong><span class="sub">${esc(p.address || p.description || '-')}</span>${p.status === 'usulan' && p.suggestedBy ? `<span class="sub">Diusulkan: ${esc(p.suggestedBy)}</span>` : ''}</div></div></td>
        <td data-label="Kategori">${esc(categories[p.category] || p.category)}</td>
        <td data-label="Jarak & jam">${esc(p.distanceNote || '-')}<span class="sub">${esc(p.openHours || '')}</span></td>
        <td data-label="Status"><span class="pill pill--${ST[p.status][1]}">${ST[p.status][0]}</span></td>
        <td class="actions">${p.status === 'usulan' ? `<button class="btn btn--green btn--sm" data-tp-ok="${p.id}">Tampilkan</button><button class="btn btn--ghost btn--sm" data-tp-no="${p.id}">Tolak</button>` : ''}<button class="btn btn--ghost btn--sm" data-tp-edit="${p.id}">Ubah</button><button class="btn btn--ghost btn--sm" data-tp-del="${p.id}">Hapus</button></td></tr>`).join('')}</tbody></table>`
        : `<div class="empty">${tempatFilter === 'aktif' ? 'Belum ada tempat. Tambahkan warung, laundry, atau toko terdekat supaya calon penyewa tahu suasana sekitar kos.' : 'Tidak ada data.'}</div>`}</div>`;
    $('#tpSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; tempatFilter = b.dataset.k; route(); };
    const form = (p = {}) => `<div class="fields fields--2">
        <label>Nama tempat<input name="name" value="${esc(p.name || '')}" required></label>
        <label>Kategori<select name="category">${Object.entries(categories).map(([k, v]) => `<option value="${k}" ${p.category === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label class="span-all">Keterangan singkat<textarea name="description" rows="2" placeholder="Mis. Nasi campur dan mie gomak, porsi besar">${esc(p.description || '')}</textarea></label>
        <label>Jarak dari kos<input name="distanceNote" value="${esc(p.distanceNote || '')}" placeholder="3 menit jalan kaki dari Kos Asina"></label>
        <label>Jam buka<input name="openHours" value="${esc(p.openHours || '')}" placeholder="07.00–21.00"></label>
        <label>Kisaran harga<input name="priceNote" value="${esc(p.priceNote || '')}" placeholder="Mulai Rp12.000"></label>
        <label>WhatsApp <span class="hint">opsional</span><input name="whatsapp" inputmode="tel" value="${esc(p.whatsapp || '')}"></label>
        <label class="span-all">Alamat<input name="address" value="${esc(p.address || '')}"></label>
        <label class="span-all">Titik peta <span class="hint">nama di Google Maps atau koordinat</span><input name="mapsQuery" value="${esc(p.mapsQuery || '')}"></label>
        <label>Urutan <span class="hint">angka kecil tampil lebih dulu</span><input type="number" name="sort" min="0" max="999" value="${p.sort ?? 50}"></label>
        <label>Status<select name="status">${Object.entries(ST).map(([k, [v]]) => `<option value="${k}" ${(p.status || 'aktif') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        ${photoField('photoList', p.photo ? [p.photo] : [])}</div>`;
    const prep = (d) => { d.photo = JSON.parse(d.photoList || '[]')[0] || ''; delete d.photoList; return d; };
    $('#addPlace').onclick = () => openDialog({ title: 'Tambah tempat', ok: 'Simpan', wide: true, body: form(), onOpen: (b) => bindPhotos(b, 'photoList'),
      onOk: async (d) => { await api('POST', '/places', prep(d)); toast('Tempat ditambahkan.'); route(); } });
    main.onclick = async (e) => {
      const t = (k) => e.target.closest(`[data-tp-${k}]`)?.getAttribute(`data-tp-${k}`);
      const id = t('ok') || t('no') || t('edit') || t('del'); if (!id) return;
      const p = all.find((x) => x.id === id);
      try {
        if (t('ok') || t('no')) { await api('PUT', `/places/${id}`, { status: t('ok') ? 'aktif' : 'ditolak' }); toast(t('ok') ? 'Tempat tampil di website.' : 'Usulan ditolak.'); route(); }
        if (t('edit')) openDialog({ title: `Ubah ${p.name}`, ok: 'Simpan', wide: true, body: form(p), onOpen: (b) => bindPhotos(b, 'photoList'), onOk: async (d) => { await api('PUT', `/places/${id}`, prep(d)); toast('Perubahan disimpan.'); route(); } });
        if (t('del')) { if (!(await askConfirm('Hapus tempat?', `${p.name} akan dihapus dari daftar.`, 'Hapus'))) return; await api('DELETE', `/places/${id}`); toast('Tempat dihapus.'); route(); }
      } catch (ex) { toast(ex.message, true); }
    };
  }

  // ---------- pendaftaran mitra ----------
  let daftarFilter = 'baru';
  function waDialog(title, note, out) {
    openDialog({
      title, body: `<p class="muted">${note}</p><div class="preview" id="waTxt">${esc(out.text)}</div>
        <div class="btn-row mt"><a class="btn btn--green" href="${esc(out.url)}" target="_blank" rel="noopener">Kirim lewat WhatsApp</a><button type="button" class="btn btn--ghost" id="waCp">Salin pesan</button></div>`,
      onOpen: (b) => { $('#waCp', b).onclick = () => copyText($('#waTxt', b)); },
    });
  }
  async function daftar() {
    const all = await get('/applications');
    const list = all.filter((a) => daftarFilter === 'semua' || a.status === daftarFilter);
    const ST = { baru: 'Menunggu ditinjau', disetujui: 'Disetujui', ditolak: 'Ditolak' };
    const PER = { harian: 'harian', bulanan: 'bulanan', semesteran: '6 bulanan', tahunan: 'tahunan' };
    main.innerHTML = head('Pendaftaran mitra', 'Pemilik kos yang mendaftar dari halaman <a href="/mitra/" target="_blank" rel="noopener">Jadi mitra</a>. Setujui untuk membuat akun pemilik dan kosnya, lalu kirim info masuknya lewat WhatsApp.') + `
      <div class="toolbar"><div class="seg" id="dfSeg">${[['baru', `Menunggu (${all.filter((a) => a.status === 'baru').length})`], ['disetujui', 'Disetujui'], ['ditolak', 'Ditolak'], ['semua', 'Semua']].map(([k, t]) => `<button aria-pressed="${daftarFilter === k}" data-k="${k}">${t}</button>`).join('')}</div></div>
      ${list.length ? `<div class="apps">${list.map((a) => `<article class="panel app-card">
        <div class="row-between"><div><h2 style="margin:0">${esc(a.kosName)}</h2><p class="muted small">${esc(a.city)}${a.address ? `, ${esc(a.address)}` : ''}</p></div><span class="pill pill--${a.status === 'baru' ? 'baru' : a.status === 'disetujui' ? 'aktif' : 'batal'}">${ST[a.status]}</span></div>
        <dl class="kv mt"><dt>Pemilik</dt><dd>${esc(a.name)}</dd><dt>WhatsApp</dt><dd><a href="${esc(waMe(a.phone, `Horas ${a.name}, ini admin Bonaasina soal pendaftaran ${a.kosName}. `))}" target="_blank" rel="noopener">${esc(a.phone)}</a></dd>
          <dt>Kos untuk</dt><dd>${esc(a.gender)}</dd><dt>Jumlah kamar</dt><dd>${a.roomCount || '-'}</dd><dt>Harga mulai</dt><dd>${a.priceFrom ? `${rp(a.priceFrom)}/bulan` : '-'}</dd>
          <dt>Bisa disewa</dt><dd>${(a.periods || []).map((k) => PER[k]).join(', ')}</dd>${a.note ? `<dt>Catatan</dt><dd>${esc(a.note)}</dd>` : ''}<dt>Masuk</dt><dd>${MK.relTime(a.createdAt)}</dd>
          ${a.adminNote ? `<dt>Catatan admin</dt><dd>${esc(a.adminNote)}</dd>` : ''}</dl>
        <div class="btn-row mt">${a.status === 'baru' ? `<button class="btn btn--green btn--sm" data-ok="${a.id}">Setujui & buat akun</button><button class="btn btn--ghost btn--sm" data-no="${a.id}">Tolak</button>` : ''}
          ${a.status === 'disetujui' ? `<a class="btn btn--ghost btn--sm" href="#mitra">Lihat di Mitra kos</a><button class="btn btn--ghost btn--sm" data-resend="${a.id}">Kirim ulang akun</button>` : ''}</div></article>`).join('')}</div>`
        : `<div class="panel empty">${daftarFilter === 'baru' ? 'Belum ada pendaftaran baru. Bagikan tautan <strong>' + esc(location.host) + '/mitra</strong> ke pemilik kos di sekitar.' : 'Tidak ada data.'}</div>`}`;
    $('#dfSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; daftarFilter = b.dataset.k; route(); };
    main.onclick = async (e) => {
      const ok = e.target.closest('[data-ok]'), no = e.target.closest('[data-no]'), rs = e.target.closest('[data-resend]');
      const a = all.find((x) => x.id === (ok || no || rs)?.dataset[ok ? 'ok' : no ? 'no' : 'resend']);
      if (ok) {
        const base = a.kosName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^kos\s+/, '').replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'mitra';
        openDialog({
          title: `Setujui ${a.kosName}`, ok: 'Setujui & buat akun', okClass: 'btn--green',
          body: `<p class="muted">Akun pemilik dan kos (masih draf) dibuat otomatis. Setelah itu Anda tinggal mengirim info masuk lewat WhatsApp.</p>
            <div class="fields fields--2 mt"><label>Username pemilik<input name="username" value="${esc(base)}" autocapitalize="none" spellcheck="false"><span class="hint">Huruf kecil dan angka.</span></label>
            <label>Fee<select name="feeType"><option value="">Ikut fee bawaan</option><option value="persen">Persen dari DP</option><option value="nominal">Nominal tetap</option></select></label>
            <label>Nilai fee <span class="hint">% atau Rp</span><input type="number" name="feeValue" min="0" step="0.5"></label>
            <label class="span-all">Catatan <span class="hint">opsional</span><input name="note"></label></div>`,
          onOk: async (d) => {
            const out = await api('POST', `/applications/${a.id}/approve`, d);
            setProps(await api('GET', '/properties'));
            toast('Disetujui. Akun pemilik dan kos sudah dibuat.'); route();
            setTimeout(() => waDialog('Kirim akun ke pemilik', `Kata sandi sementara hanya ditampilkan sekarang. Pemilik wajib menggantinya saat pertama masuk. Username: <strong>${esc(out.owner.username)}</strong>`, out), 80);
          },
        });
      }
      if (no) openDialog({
        title: `Tolak ${a.kosName}`, ok: 'Tolak',
        body: `<label>Alasan <span class="hint">opsional, ikut dalam pesan WhatsApp</span><input name="note" placeholder="Mis. lokasi di luar area layanan kami"></label>`,
        onOk: async (d) => { const out = await api('POST', `/applications/${a.id}/reject`, d); route(); setTimeout(() => waDialog('Kabari pendaftar', 'Kirim kabar ini supaya pendaftar tidak menunggu.', out), 80); },
      });
      if (rs) {
        if (!(await askConfirm('Kirim ulang akun?', `Kata sandi sementara baru akan dibuat untuk ${a.name}. Kata sandi lama tidak berlaku lagi.`, 'Buat & kirim'))) return;
        const out = await api('POST', `/applications/${a.id}/resend`); route();
        setTimeout(() => waDialog('Kirim ulang akun', 'Kata sandi sementara baru hanya ditampilkan sekarang.', out), 80);
      }
    };
  }

  // ---------- pemilik kos ----------
  function ownerCredentials(o, password) {
    const link = `${SITE}/pemilik/`;
    const msg = `Horas ${o.name}, akun pemilik kos mitra Bonaasina Anda sudah siap.\n\nAlamat: ${link}\nUsername: ${o.username}\nKata sandi sementara: ${password}\n\nSaat pertama masuk, Anda diminta membuat kata sandi sendiri. Lalu lengkapi info kos, kamar & harga, foto, rekening untuk DP, dan nomor WhatsApp, kemudian tekan "Minta ditampilkan di website".\n\nAlur singkat: reservasi masuk → Anda konfirmasi kamar tersedia → penyewa transfer DP ke rekening Anda → Anda bayar biaya layanan ke Bonaasina → admin menyetujui dan bukti booking terbit.`;
    openDialog({
      title: 'Akun pemilik siap',
      body: `<p class="muted">Kata sandi sementara hanya ditampilkan sekarang.</p><dl class="kv mt"><dt>Alamat</dt><dd>${esc(link)}</dd><dt>Username</dt><dd>${esc(o.username)}</dd><dt>Kata sandi</dt><dd class="mono" style="font-size:15px !important">${esc(password)}</dd></dl>
        <div class="preview" id="ownMsg">${esc(msg)}</div>
        <div class="btn-row mt">${o.phone ? `<a class="btn btn--green" href="${esc(waMe(o.phone, msg))}" target="_blank" rel="noopener">Kirim lewat WhatsApp</a>` : ''}<button type="button" class="btn btn--ghost" id="ownCopy">Salin pesan</button></div>`,
      onOpen: (b) => { $('#ownCopy', b).onclick = () => copyText($('#ownMsg', b)); },
    });
  }
  async function pemilik() {
    const owners = await get('/owners');
    main.innerHTML = head('Pemilik kos', 'Akun untuk pemilik kos mitra. Mereka masuk di /pemilik dengan username & kata sandi dari Anda, lalu wajib mengganti kata sandi.', '<button class="btn btn--red" id="addOwner">Tambah pemilik</button>') +
      `<div class="table-wrap">${owners.length ? `<table><thead><tr><th>Pemilik</th><th>Username</th><th>Kos</th><th>Login</th><th></th></tr></thead><tbody>${owners.map((o) => `<tr>
        <td data-label="Pemilik"><strong>${esc(o.name)}</strong><span class="sub">${esc(o.phone || '-')}${o.email ? `, ${esc(o.email)}` : ''}</span></td>
        <td data-label="Username"><span class="pill pill--${o.status === 'aktif' ? 'aktif' : 'nonaktif'}">${esc(o.username)}</span></td>
        <td data-label="Kos">${o.properties.length ? o.properties.map((p) => `${esc(p.name)} <span class="sub">${PROP_STATUS[p.status]}</span>`).join('') : '<span class="muted">Belum ada</span>'}</td>
        <td data-label="Login">${o.lastLoginAt ? MK.relTime(o.lastLoginAt) : 'Belum pernah'}<span class="sub">${o.mustChange ? 'Masih kata sandi sementara' : 'Sudah ganti kata sandi'}</span></td>
        <td class="actions"><button class="btn btn--ghost btn--sm" data-edit-own="${o.id}">Ubah</button><button class="btn btn--ghost btn--sm" data-reset-own="${o.id}">Atur ulang sandi</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Belum ada pemilik kos mitra. Tambahkan pemilik, lalu buat kosnya di menu Mitra kos.</div>'}</div>`;
    const ownerDialog = (o) => openDialog({
      title: o ? `Ubah ${o.name}` : 'Tambah pemilik kos', ok: o ? 'Simpan' : 'Buat akun',
      body: `<div class="fields fields--2"><label>Nama<input name="name" value="${esc(o?.name || '')}" required id="oName"></label>
        <label>Nomor WhatsApp<input name="phone" inputmode="tel" value="${esc(o?.phone || '')}"></label>
        <label>Username<input name="username" value="${esc(o?.username || '')}" id="oUser" autocapitalize="none" spellcheck="false" required><span class="hint">Huruf kecil, angka, titik, minus.</span></label>
        <label>Email <span class="hint">opsional</span><input name="email" type="email" value="${esc(o?.email || '')}"></label>
        ${o ? `<label>Status<select name="status"><option value="aktif">Aktif</option><option value="nonaktif" ${o.status === 'nonaktif' ? 'selected' : ''}>Nonaktif (tidak bisa masuk)</option></select></label>` : ''}
        <label class="span-all">Catatan<input name="note" value="${esc(o?.note || '')}"></label>
        ${o ? '' : '<p class="hint span-all">Kata sandi sementara dibuat otomatis dan ditampilkan sekali untuk dikirim lewat WhatsApp.</p>'}</div>`,
      onOpen: (b) => { if (!o) { const u = $('#oUser', b); u.oninput = () => { u.dataset.touched = 1; }; $('#oName', b).oninput = (e) => { if (!u.dataset.touched) u.value = suggestUsername(e.target.value, 'kos'); }; } },
      onOk: async (d) => {
        d.username = d.username.trim().toLowerCase();
        if (o) { await api('PUT', `/owners/${o.id}`, d); toast('Data pemilik disimpan.'); route(); }
        else { const rec = await api('POST', '/owners', d); route(); setTimeout(() => ownerCredentials(rec, rec.password), 80); }
      },
    });
    main.onclick = async (e) => {
      if (e.target.closest('#addOwner')) ownerDialog(null);
      const ed = e.target.closest('[data-edit-own]'); if (ed) ownerDialog(owners.find((o) => o.id === ed.dataset.editOwn));
      const rs = e.target.closest('[data-reset-own]');
      if (rs) {
        const o = owners.find((x) => x.id === rs.dataset.resetOwn);
        if (!(await askConfirm('Atur ulang kata sandi?', `${o.name} akan keluar dari semua perangkat dan harus masuk dengan kata sandi sementara yang baru.`, 'Atur ulang'))) return;
        const out = await api('POST', `/owners/${o.id}/reset`); route(); setTimeout(() => ownerCredentials(out, out.password), 80);
      }
    };
  }

  // ---------- fee & aturan ----------
  async function fee() {
    const [s, leads, parts] = await Promise.all([get('/settings'), get('/leads'), get('/partners')]);
    cache.settings = s;
    const mit = leads.filter((l) => l.propertyKind === 'mitra' && l.feeAmount > 0);
    const sum = (f) => mit.filter(f).reduce((a, l) => a + l.feeAmount, 0);
    const byMonth = {};
    for (const l of mit.filter((x) => x.feeStatus === 'diterima')) { const k = (l.approvedAt || l.updatedAt || '').slice(0, 7); byMonth[k] = (byMonth[k] || 0) + l.feeAmount; }
    main.innerHTML = head('Fee & aturan', 'Fee kemitraan dihitung dari uang booking/DP yang ditransfer penyewa ke pemilik. Fee per kos bisa diatur di Mitra kos → Atur status & fee.') + `
      <div class="grid grid--stats">
        <div class="panel stat"><p class="stat__label">Fee diterima</p><p class="stat__value">${rp(sum((l) => l.feeStatus === 'diterima'))}</p><p class="stat__sub">${mit.filter((l) => l.feeStatus === 'diterima').length} booking</p></div>
        <div class="panel stat"><p class="stat__label">Menunggu dicek</p><p class="stat__value">${rp(sum((l) => l.feeStatus === 'dikirim'))}</p><p class="stat__sub"><a href="#persetujuan">Buka persetujuan</a></p></div>
        <div class="panel stat ${mit.some((l) => l.feeOverdue) ? 'stat--alert' : ''}"><p class="stat__label">Belum dibayar pemilik</p><p class="stat__value">${rp(sum((l) => ['belum', 'ditolak'].includes(l.feeStatus)))}</p><p class="stat__sub">${mit.filter((l) => l.feeOverdue).length} lewat batas</p></div>
        <div class="panel stat"><p class="stat__label">Dikembalikan (refund)</p><p class="stat__value">${rp(sum((l) => l.feeStatus === 'dikembalikan'))}</p></div>
      </div>
      ${Object.keys(byMonth).length ? `<div class="panel mt"><h2>Fee diterima per bulan</h2><table><tbody>${Object.entries(byMonth).sort().reverse().map(([k, v]) => `<tr><td>${k ? `${BULAN[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}` : '-'}</td><td class="num">${rp(v)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="panel mt"><h2>Fee per kos</h2><table><tbody>${parts.map((p) => `<tr><td><strong>${esc(p.name)}</strong><span class="sub">${esc(p.owner?.name || '-')}</span></td><td>${esc(p.feeRule)}</td><td class="num">${rp(p.feeReceived)}<span class="sub">belum: ${rp(p.feeOpen)}</span></td></tr>`).join('') || '<tr><td class="muted">Belum ada kos mitra.</td></tr>'}</tbody></table></div>
      <form class="settings-grid mt" id="feeForm">
        <div class="panel fields fields--2">
          <p class="fieldset-title span-all">Fee bawaan untuk kos mitra</p>
          <label>Jenis<select name="feeDefaultType"><option value="persen" ${s.feeDefaultType !== 'nominal' ? 'selected' : ''}>Persen dari DP</option><option value="nominal" ${s.feeDefaultType === 'nominal' ? 'selected' : ''}>Nominal tetap per booking</option></select></label>
          <label>Nilai <span class="hint">% atau Rp</span><input type="number" name="feeDefaultValue" min="0" step="0.5" value="${esc(s.feeDefaultValue ?? 10)}"></label>
          <label class="span-all">Rekening Bonaasina untuk menerima fee<textarea name="bonaBankInfo" rows="2" placeholder="BCA 1234567890 a.n. Bonaasina">${esc(s.bonaBankInfo || '')}</textarea></label>
          <label>Batas bayar fee <span class="hint">hari setelah DP diterima</span><input type="number" name="feeDueDays" min="1" max="30" value="${esc(s.feeDueDays ?? 3)}"></label>
          <label>Batas bayar DP bawaan <span class="hint">jam</span><input type="number" name="dpHours" min="1" max="168" value="${esc(s.dpHours ?? 24)}"></label>
          <label>Tandai “belum direspons” setelah <span class="hint">jam</span><input type="number" name="leadResponseHours" min="1" max="168" value="${esc(s.leadResponseHours ?? 24)}"></label>
          <label class="span-all">Rekening DP untuk Kos Asina & Bona <span class="hint">kosong = info rekening di Pengaturan</span><textarea name="ownBankInfo" rows="2">${esc(s.ownBankInfo || '')}</textarea></label>
        </div>
        <div class="panel fields">
          <p class="fieldset-title">Pesan WhatsApp: kamar tersedia</p>
          <label>Isi pesan<textarea name="waTemplateConfirm" rows="10" id="tplC">${esc(s.waTemplateConfirm || s.defaultWaTemplateConfirm)}</textarea>
            <span class="hint">{nama} {kos} {kamar} {periode} {mulai} {harga} {dp} {batas} {pesan} {link} {username} {password} {rekening}</span></label>
          <div><button type="button" class="btn btn--ghost btn--sm" data-reset-tpl="C">Kembalikan bawaan</button></div>
        </div>
        <div class="panel fields">
          <p class="fieldset-title">Pesan WhatsApp: tidak tersedia</p>
          <label>Isi pesan<textarea name="waTemplateReject" rows="7" id="tplR">${esc(s.waTemplateReject || s.defaultWaTemplateReject)}</textarea><span class="hint">{nama} {kos} {alasan} {link_kos} {link} {username}</span></label>
          <div><button type="button" class="btn btn--ghost btn--sm" data-reset-tpl="R">Kembalikan bawaan</button></div>
          <p class="fieldset-title">Teks pembuka halaman Kos Sekitar</p>
          <label><textarea name="marketIntro" rows="3" placeholder="Kos pilihan di sekitar Kos Asina & Kos Bona…">${esc(s.marketIntro || '')}</textarea></label>
        </div>
        <div class="form-actions"><button class="btn btn--red" type="submit">Simpan aturan</button></div>
      </form>`;
    main.onclick = (e) => { const r = e.target.closest('[data-reset-tpl]'); if (!r) return; if (r.dataset.resetTpl === 'C') $('#tplC').value = s.defaultWaTemplateConfirm; else $('#tplR').value = s.defaultWaTemplateReject; };
    $('#feeForm').onsubmit = async (e) => {
      e.preventDefault();
      try { cache.settings = await api('PUT', '/settings', Object.fromEntries(new FormData(e.target))); toast('Aturan Kos Sekitar disimpan.'); }
      catch (ex) { toast(ex.message, true); }
    };
  }

  // ---------- notifikasi ----------
  async function notifikasi() {
    const n = await get('/notifications');
    main.innerHTML = head('Notifikasi', 'Kabar terbaru dari reservasi, pemilik kos, dan penyewa.', n.unread ? '<button class="btn btn--ghost" id="readAll">Tandai semua dibaca</button>' : '') + `<div class="panel">${MK.notifs(n.items)}</div>`;
    $('#readAll')?.addEventListener('click', async () => { await api('POST', '/notifications/read', {}); route(); });
    main.onclick = async (e) => {
      const b = e.target.closest('[data-notif]'); if (!b) return;
      try { await api('POST', '/notifications/read', { ids: [Number(b.dataset.notif)] }); } catch { /* abaikan */ }
      if (b.dataset.lead) location.hash = `#reservasi?id=${b.dataset.lead}`; else route();
    };
  }

  // ---------- mulai ----------
  // Ada sesi tersimpan → langsung masuk (api() akan memperpanjang atau mengarahkan ke login bila sesi sudah mati).
  if (getSession()?.refreshToken) start().catch(() => {}); else showLogin();
})();
