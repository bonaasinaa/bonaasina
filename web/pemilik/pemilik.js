/* Dashboard pemilik kos mitra Bonaasina — reservasi masuk, konfirmasi & DP, chat, kamar & harga, info kos, fee. */
(() => {
  const M = window.BonaMarket;
  const { esc, rp, tgl, waktu, relTime } = M;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const main = $('#main');
  const API = (window.BONA_CONFIG?.apiBase || '/api').replace(/\/$/, '');
  const KEY = M.KEYS.pemilik;
  const getSession = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
  const setSession = (s) => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* abaikan */ } };
  const PERIODS = [['harian', 'Harian', 'priceDaily', 'per malam'], ['bulanan', 'Bulanan', 'priceMonthly', 'per bulan'], ['semesteran', '6 bulanan', 'priceSemester', 'per 6 bulan'], ['tahunan', 'Tahunan', 'priceYearly', 'per tahun']];
  const STATUS_KAMAR = { kosong: 'Kosong', dipesan: 'Dipesan', terisi: 'Terisi', perbaikan: 'Perbaikan' };
  const PROP_STATUS = { draf: 'Belum tampil, masih dilengkapi', menunggu: 'Sedang dicek admin', aktif: 'Tampil di website', nonaktif: 'Disembunyikan' };
  let data = null; let chatBox = null; let leadFilter = 'aktif'; let propSel = null;

  // ---------- API ----------
  async function api(method, path, body, raw) {
    const opt = { method, headers: {} };
    const s = getSession(); if (s?.token) opt.headers['X-Owner-Session'] = s.token;
    if (raw) { opt.body = raw; opt.headers['Content-Type'] = raw.type; }
    else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
    let res;
    try { res = await fetch(API + '/pemilik' + path, opt); }
    catch { throw new Error('Tidak bisa terhubung. Periksa koneksi internet lalu coba lagi.'); }
    const ct = res.headers.get('content-type') || '';
    const out = ct.includes('json') ? await res.json().catch(() => ({})) : ct.includes('pdf') ? await res.blob() : await res.text();
    if (res.status === 401) { setSession(null); showLogin('Sesi berakhir. Silakan masuk lagi.'); throw new Error('Silakan masuk dulu.'); }
    if (res.status === 403 && /kata sandi bawaan/.test(out.error || '')) { showChange(); throw new Error(out.error); }
    if (!res.ok) throw new Error(out.error || 'Terjadi kesalahan.');
    return out;
  }
  let toastTimer;
  function toast(msg, isError) {
    const t = $('#toast'); t.textContent = msg; t.classList.toggle('is-error', !!isError); t.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('is-on'), 3800);
  }
  M.onError = (ex) => toast(ex.message, true);
  function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  function shrink(file, max = 1800) {
    return new Promise((resolve) => {
      if (!/^image\//.test(file.type)) return resolve(file);
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob((b) => resolve(b || file), 'image/jpeg', 0.84);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }
  const dlg = $('#dlg'); let dlgHandler = null;
  function openDialog({ title, body, ok = 'Simpan', okClass = 'btn--red', onOk, onOpen, wide = false }) {
    dlg.classList.toggle('dlg--wide', wide);
    $('#dlgTitle').textContent = title; $('#dlgBody').innerHTML = body;
    $('#dlgOk').textContent = ok; $('#dlgOk').className = `btn ${okClass}`; $('#dlgOk').hidden = !onOk;
    $('.dlg__foot .btn--ghost').textContent = onOk ? 'Batal' : 'Tutup';
    $('#dlgErr').hidden = true; dlgHandler = onOk; dlg.showModal(); onOpen?.($('#dlgBody'));
  }
  $('#dlgForm').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'ok' || !dlgHandler) return;
    e.preventDefault(); const btn = $('#dlgOk'); btn.disabled = true;
    try { await dlgHandler(Object.fromEntries(new FormData($('#dlgForm'))), $('#dlgBody')); if (dlg.open) dlg.close(); }
    catch (ex) { $('#dlgErr').textContent = ex.message; $('#dlgErr').hidden = false; }
    finally { btn.disabled = false; }
  });
  function askConfirm(title, text, ok = 'Ya, lanjutkan') {
    return new Promise((resolve) => {
      let done = false;
      openDialog({ title, ok, body: `<p>${esc(text)}</p>`, onOk: async () => { done = true; resolve(true); } });
      dlg.addEventListener('close', () => { if (!done) resolve(false); }, { once: true });
    });
  }

  // ---------- masuk ----------
  function showLogin(msg) {
    BonaLoader.reset(); chatBox?.stop();
    $('#app').hidden = true; $('#changePw').hidden = true; $('#login').hidden = false; if (dlg.open) dlg.close();
    if (msg) { $('#loginErr').textContent = msg; $('#loginErr').hidden = false; }
    $('#loginUser').focus();
  }
  function showChange() { BonaLoader.reset(); $('#app').hidden = true; $('#login').hidden = true; $('#changePw').hidden = false; $('#pwUser').value = getSession()?.username || ''; $('#pwNew').focus(); }
  $$('[data-show]').forEach((b) => b.addEventListener('click', () => { const i = $('#' + b.dataset.show); const on = i.type === 'password'; i.type = on ? 'text' : 'password'; b.textContent = on ? 'Sembunyikan' : 'Lihat'; }));
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = $('button[type=submit]', e.target); btn.disabled = true;
    try {
      const out = await M.login(e.target.username.value, e.target.password.value);
      if (out.kind !== 'pemilik') { location.href = out.home; return; }
      e.target.password.value = ''; $('#loginErr').hidden = true;
      if (out.mustChange) showChange(); else start();
    } catch (ex) { $('#loginErr').textContent = ex.message; $('#loginErr').hidden = false; }
    finally { btn.disabled = false; }
  });
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    if (f.newPassword.value !== f.newPassword2.value) { $('#pwErr').textContent = 'Kedua kata sandi belum sama.'; $('#pwErr').hidden = false; return; }
    try { await api('POST', '/password', { newPassword: f.newPassword.value }); const s = getSession(); if (s) { s.mustChange = false; setSession(s); } f.reset(); toast('Kata sandi baru tersimpan.'); start(); }
    catch (ex) { $('#pwErr').textContent = ex.message; $('#pwErr').hidden = false; }
  });
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-logout]')) return;
    try { await api('POST', '/logout'); } catch { /* tetap keluar */ }
    setSession(null); data = null; chatBox?.stop(); main.innerHTML = ''; showLogin();
  });

  // ---------- data & router ----------
  async function load() { data = await api('GET', '/me'); propSel ||= data.properties[0]?.id || null; return data; }
  async function start() {
    $('#login').hidden = true; $('#changePw').hidden = true; $('#app').hidden = false;
    BonaLoader.show('Membuka dashboard…', 0);
    try { await load(); $('#sideWho').textContent = data.owner.name; route(); }
    catch (ex) { if (!/masuk dulu|bawaan/.test(ex.message)) main.innerHTML = `<div class="empty">${esc(ex.message)}</div>`; }
    finally { BonaLoader.hide(); }
  }
  async function reload() { await BonaLoader.during('Memperbarui…', load); route(true); }
  const views = { beranda, reservasi, kamar, kos, fee, notifikasi, akun };
  const TITLES = { beranda: 'Beranda', reservasi: 'Reservasi', kamar: 'Kamar & harga', kos: 'Kos saya', fee: 'Fee Bonaasina', notifikasi: 'Notifikasi', akun: 'Akun & panduan' };
  const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');
  const current = () => { const n = (location.hash.slice(1) || 'beranda').split('?')[0]; return views[n] ? n : 'beranda'; };
  let shown = '';
  async function route(keep) {
    if (!data) return;
    const name = current(); const key = location.hash;
    $$('#sideNav a').forEach((a) => (a.dataset.view === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    $('#topTitle').textContent = TITLES[name]; document.title = `${TITLES[name]} — Pemilik Kos Bonaasina`;
    closeNav(); chatBox?.stop(); chatBox = null;
    const y = keep && shown === key ? scrollY : 0;
    if (shown !== key) window.bonaTrack?.(`/pemilik/${name}`, `Pemilik: ${TITLES[name]}`);
    main.onclick = null; main.onchange = null;
    try { await views[name](); } catch (ex) { if (!/masuk dulu|bawaan/.test(ex.message)) main.innerHTML = `<div class="empty">${esc(ex.message)}</div>`; }
    shown = key; scrollTo(0, y); badges();
  }
  addEventListener('hashchange', () => route());
  const nav = $('#side');
  function closeNav() { nav.classList.remove('is-open'); $('#navScrim').hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); document.body.classList.remove('nav-open'); }
  $('#menuBtn').addEventListener('click', () => { const open = !nav.classList.contains('is-open'); nav.classList.toggle('is-open', open); $('#navScrim').hidden = !open; $('#menuBtn').setAttribute('aria-expanded', open); document.body.classList.toggle('nav-open', open); });
  $('#navScrim').addEventListener('click', closeNav);
  const head = (title, sub, actions = '') => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="actions">${actions}</div></div>`;

  const needs = () => {
    const L = data.leads;
    return {
      baru: L.filter((l) => l.status === 'baru').length, dp: L.filter((l) => l.status === 'dp_dikirim').length,
      visit: L.filter((l) => l.visitStatus === 'diminta' && !['batal', 'ditolak', 'kedaluwarsa'].includes(l.status)).length,
      fee: L.filter((l) => ['belum', 'ditolak'].includes(l.feeStatus) && ['dp_diterima', 'berhasil'].includes(l.status)).length,
      refund: L.filter((l) => ['diminta', 'dilaporkan'].includes(l.refundStatus)).length, unread: L.reduce((a, l) => a + (l.unread || 0), 0),
    };
  };
  function badges() {
    const n = needs(); const set = (id, v) => { const b = $(id); b.textContent = v; b.hidden = !v; };
    set('#bRes', n.baru + n.dp + n.refund + n.visit + n.unread); set('#bFee', n.fee); set('#bNotif', data.notifications.unread);
    set('#bKos', data.properties.filter((p) => p.status === 'draf' || p.status === 'nonaktif').length);
    $('#navDot').hidden = !(n.baru + n.dp + n.refund + n.fee + n.unread + data.notifications.unread);
  }
  // Periksa reservasi & pesan baru tiap 30 detik.
  setInterval(async () => {
    if (!data || document.hidden || dlg.open || $('#app').hidden) return;
    const before = JSON.stringify([data.leads.map((l) => [l.id, l.status, l.unread, l.refundStatus, l.feeStatus, l.visitStatus]), data.notifications.unread]);
    try {
      await load();
      const after = JSON.stringify([data.leads.map((l) => [l.id, l.status, l.unread, l.refundStatus, l.feeStatus, l.visitStatus]), data.notifications.unread]);
      if (before !== after) {
        badges();
        const busy = main.contains(document.activeElement) && document.activeElement.matches('input, textarea, select');
        if (!busy) route(true);
        toast('Ada pembaruan reservasi.');
      }
    } catch { /* coba lagi nanti */ }
  }, 30000);

  // Daftar periksa kos baru: apa saja yang perlu dilengkapi sebelum kos tampil di website.
  function setupItems(p) {
    const rooms = data.rooms.filter((r) => r.propertyId === p.id && !r.hidden);
    const priced = rooms.some((r) => PERIODS.some(([k, , key]) => p.periods.includes(k) && r[key] > 0));
    return [
      [!!p.address, 'Alamat kos', '#kos', true], [(p.photos || []).length > 0, 'Minimal 1 foto kos', '#kos', true],
      [priced, 'Minimal 1 kamar dengan harga', '#kamar', true], [!!p.bankInfo, 'Rekening untuk menerima DP', '#kos', true],
      [!!p.whatsapp || p.waEnabled === false, 'Nomor WhatsApp', '#kos', true], [!!p.bookingPolicy, 'Aturan booking & pembatalan (disarankan)', '#kos', false],
    ];
  }
  function setupCard(p) {
    const items = setupItems(p); const need = items.filter((i) => i[3]); const done = need.filter((i) => i[0]).length;
    const ready = done === need.length;
    if (p.status === 'menunggu') return `<div class="next next--wait"><h3>${esc(p.name)} sedang dicek admin</h3><p>Biasanya selesai dalam 1×24 jam. Anda akan mendapat notifikasi saat kos sudah tampil di website.</p></div>`;
    return `<div class="next ${ready ? 'next--ok' : 'next--act'} setup"><div class="row-between"><h3>${ready ? `${esc(p.name)} siap ditampilkan` : `Lengkapi ${esc(p.name)} supaya bisa tampil`}</h3><strong>${done}/${need.length}</strong></div>
      <div class="setup__bar" role="progressbar" aria-valuemin="0" aria-valuemax="${need.length}" aria-valuenow="${done}"><span style="width:${(done / need.length) * 100}%"></span></div>
      ${p.reviewNote ? `<p class="info-box">Pesan admin: ${esc(p.reviewNote)}</p>` : ''}
      <ul class="setup__list">${items.map(([ok, t, h]) => `<li class="${ok ? 'is-done' : ''}"><a href="${h}">${esc(t)}</a></li>`).join('')}</ul>
      <div class="btn-row">${ready ? `<button class="btn btn--green" data-submit="${p.id}">Minta ditampilkan di website</button>` : `<a class="btn btn--red" href="${items.find((i) => i[3] && !i[0])[2]}">Lengkapi sekarang</a>`}</div></div>`;
  }
  // ========== BERANDA ==========
  async function beranda() {
    const n = needs(); const props = data.properties;
    const todo = [
      [n.baru, '#reservasi', 'pesanan baru: pastikan kamarnya tersedia', true], [n.dp, '#reservasi', 'bukti DP perlu dicek di rekening Anda', true],
      [n.refund, '#reservasi', 'permintaan refund', true], [n.fee, '#fee', 'biaya layanan perlu ditransfer', true],
      [n.visit, '#reservasi', 'permintaan jadwal kunjungan', false], [n.unread, '#reservasi', 'pesan chat belum dibaca', false],
    ].filter(([v]) => v);
    const stale = props.filter((p) => p.status === 'aktif' && (!p.checkedAt || Date.now() - Date.parse(p.checkedAt) > 14 * 864e5));
    const free = data.rooms.filter((r) => r.effectiveStatus === 'kosong' && !r.hidden).length;
    main.innerHTML = head(`Horas, ${esc(data.owner.name.split(' ')[0])}`, `${props.length ? props.map((p) => esc(p.name)).join(', ') : 'Belum ada kos'} di Kos Sekitar Bonaasina.`) + `
      ${props.filter((p) => p.status !== 'aktif').map(setupCard).join('')}
      ${stale.map((p) => `<div class="notice"><p><strong>Status kamar ${esc(p.name)} terakhir dicek ${p.checkedAt ? relTime(p.checkedAt) : 'belum pernah'}.</strong> Pastikan kamar kosong/terisi sudah benar supaya calon penyewa tidak kecewa.</p><button class="btn btn--sm" data-checked="${p.id}">Status kamar sudah benar</button></div>`).join('')}
      <div class="grid grid--stats">
        <div class="panel stat ${n.baru ? 'stat--alert' : ''}"><p class="stat__label">Reservasi baru</p><p class="stat__value">${n.baru}</p><p class="stat__sub">Belum dikonfirmasi</p></div>
        <div class="panel stat"><p class="stat__label">Reservasi berjalan</p><p class="stat__value">${data.leads.filter((l) => ['menunggu_dp', 'dp_dikirim', 'dp_diterima'].includes(l.status)).length}</p><p class="stat__sub">Menunggu DP / persetujuan</p></div>
        <div class="panel stat"><p class="stat__label">Booking berhasil</p><p class="stat__value">${data.leads.filter((l) => l.status === 'berhasil').length}</p><p class="stat__sub">Lewat Bonaasina</p></div>
        <div class="panel stat"><p class="stat__label">Kamar kosong</p><p class="stat__value">${free}</p><p class="stat__sub">dari ${data.rooms.length} kamar</p></div>
      </div>
      <div class="panel mt"><h2>Perlu tindakan</h2>${todo.length ? `<div class="todo">${todo.map(([v, h, t, u]) => `<a href="${h}" class="${u ? 'is-urgent' : ''}"><span class="count">${v}</span><span>${t}</span></a>`).join('')}</div>` : '<p class="empty--ok">Semua beres. Reservasi baru akan muncul di sini dan di notifikasi.</p>'}</div>
      <div class="panel mt"><h2>Alur reservasi di Bonaasina</h2>${guide()}</div>`;
    main.onclick = async (e) => {
      const sb = e.target.closest('[data-submit]');
      if (sb) { try { await api('POST', `/properties/${sb.dataset.submit}/submit`, {}); toast('Terkirim. Admin akan mengecek lalu menampilkan kos Anda.'); reload(); } catch (ex) { toast(ex.message, true); } return; }
      const c = e.target.closest('[data-checked]'); if (!c) return;
      try { await api('POST', `/properties/${c.dataset.checked}/checked`, {}); toast('Terima kasih. Website menampilkan status kamar terbaru.'); reload(); } catch (ex) { toast(ex.message, true); }
    };
  }
  const guide = () => `<ol class="guide">
    <li><div><strong>Pesanan masuk</strong><span>Calon penyewa memilih kamar & tanggal di website. Belum ada pembayaran. Anda mendapat notifikasi.</span></div></li>
    <li><div><strong>Pastikan kamar tersedia</strong><span>Tekan “Kamar tersedia, minta DP”, isi jumlah DP, lalu “Kirim ke WhatsApp”. Pesannya sudah lengkap dengan cara bayar untuk penyewa.</span></div></li>
    <li><div><strong>Penyewa transfer DP ke rekening Anda</strong><span>Penyewa mengunggah bukti transfer. Cek mutasi rekening lalu tekan “DP sudah masuk”.</span></div></li>
    <li><div><strong>Bayar biaya layanan</strong><span>Biaya layanan dihitung otomatis dari DP. Transfer ke rekening Bonaasina dan unggah buktinya.</span></div></li>
    <li><div><strong>Admin menyetujui</strong><span>Bukti booking terkirim ke penyewa, invoice ke Anda. Bila batal setelah DP, proses refund di halaman reservasi.</span></div></li></ol>`;

  // ========== RESERVASI ==========
  async function reservasi() {
    const id = hashParams().get('id');
    if (id) return reservasiDetail(id);
    const FILTERS = { aktif: ['baru', 'menunggu_dp', 'dp_dikirim', 'dp_diterima'], berhasil: ['berhasil'], selesai: ['ditolak', 'batal', 'kedaluwarsa'], semua: null };
    const draw = () => {
      const list = data.leads.filter((l) => !FILTERS[leadFilter] || FILTERS[leadFilter].includes(l.status) || (leadFilter === 'aktif' && ['diminta', 'dilaporkan'].includes(l.refundStatus)));
      $('#ldTable').innerHTML = list.length ? `<table><thead><tr><th>Calon penyewa</th><th>Kos & kamar</th><th>Sewa</th><th>Status</th><th></th></tr></thead><tbody>${list.map((l) => `<tr>
        <td data-label="Calon penyewa"><a href="#reservasi?id=${l.id}"><strong>${esc(l.name)}</strong></a>${l.unread ? `<span class="unread" title="Pesan belum dibaca">${l.unread}</span>` : ''}<span class="sub">${esc(l.phone)}, masuk ${relTime(l.createdAt)}</span></td>
        <td data-label="Kos & kamar">${esc(l.roomCode || 'Belum pilih kamar')}<span class="sub">${esc(l.propertyName)}</span></td>
        <td data-label="Sewa">${esc(l.periodLabel)}<span class="sub">mulai ${tgl(l.moveDate)}${l.people === 2 ? ', 2 orang' : ''}</span></td>
        <td data-label="Status">${M.pill(l)}${M.flags(l)}</td>
        <td class="actions"><a class="btn btn--${l.status === 'baru' || l.status === 'dp_dikirim' ? 'red' : 'ghost'} btn--sm" href="#reservasi?id=${l.id}">${l.status === 'baru' ? 'Konfirmasi' : l.status === 'dp_dikirim' ? 'Cek DP' : 'Buka'}</a></td></tr>`).join('')}</tbody></table>`
        : `<div class="empty">${leadFilter === 'aktif' ? 'Belum ada pesanan. Pesanan baru akan muncul di sini dan di notifikasi.' : 'Tidak ada data.'}</div>`;
    };
    main.innerHTML = head('Reservasi', 'Pastikan kamar tersedia dulu, baru penyewa membayar DP. Setiap langkah langsung terlihat oleh penyewa.') + `
      <div class="toolbar"><div class="seg" id="ldSeg">${[['aktif', 'Berjalan'], ['berhasil', 'Berhasil'], ['selesai', 'Selesai/batal'], ['semua', 'Semua']].map(([k, t]) => `<button aria-pressed="${leadFilter === k}" data-k="${k}">${t}</button>`).join('')}</div></div>
      <div class="table-wrap" id="ldTable"></div>`;
    draw();
    $('#ldSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; leadFilter = b.dataset.k; $$('#ldSeg button').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(); };
  }
  async function reservasiDetail(id) {
    const l = await BonaLoader.during('Membuka reservasi…', () => api('GET', `/leads/${id}`));
    const ctx = {
      role: 'pemilik', api, base: `/leads/${id}`, openDialog, askConfirm, toast, saveBlob, shrink, rooms: data.rooms,
      minBooking: (x) => data.properties.find((p) => p.id === x.propertyId)?.minBooking || 0,
      reload: async () => { await reload(); },
    };
    main.innerHTML = `<a class="back" href="#reservasi">← Semua reservasi</a>` + head(esc(l.name), `${esc(l.propertyName)} · ${esc(l.periodLabel)} mulai ${tgl(l.moveDate)}`, `<a class="btn btn--green" href="https://wa.me/${esc(l.waCustomer)}" target="_blank" rel="noopener">WhatsApp penyewa</a>`) +
      `<div class="lead-grid"><div id="leadPanel">${M.leadPanel(l, ctx)}</div><div><div id="chatBox"></div><p class="hint">Penyewa membaca pesan ini di halaman reservasinya. ${l.chatEnabled ? '' : 'Chat sedang dimatikan di Kos saya.'}</p></div></div>`;
    M.bindLead($('#leadPanel'), l, ctx);
    chatBox = M.chat($('#chatBox'), {
      title: `Chat dengan ${l.name}`, me: 'pemilik', enabled: l.chatEnabled, offText: 'Chat dimatikan. Nyalakan di menu Kos saya, atau gunakan WhatsApp.',
      who: { customer: l.name, pemilik: 'Anda' },
      load: (after) => api('GET', `/leads/${id}/messages?after=${after}`), send: (body) => api('POST', `/leads/${id}/messages`, { body }),
    });
    const cur = data.leads.find((x) => x.id === id); if (cur) cur.unread = 0; badges();
  }

  // ========== KAMAR ==========
  const propOf = (id) => data.properties.find((p) => p.id === id);
  function propPicker() {
    if (data.properties.length < 2) return '';
    return `<label class="search">Kos<select id="propSel">${data.properties.map((p) => `<option value="${p.id}" ${p.id === propSel ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`;
  }
  async function kamar() {
    if (!data.properties.length) { main.innerHTML = head('Kamar & harga', '') + '<div class="empty">Admin belum menghubungkan kos ke akun Anda.</div>'; return; }
    const p = propOf(propSel);
    const rooms = data.rooms.filter((r) => r.propertyId === p.id);
    const per = PERIODS.filter(([k]) => p.periods.includes(k));
    main.innerHTML = head('Kamar & harga', `Periode yang dibuka: ${per.map(([, t]) => t).join(', ')}. Ubah periode di menu Kos saya.`, `${propPicker()}<button class="btn btn--ghost" data-checked>Status kamar sudah benar</button><button class="btn btn--red" data-add>Tambah kamar</button>`) +
      `<p class="hint">Status yang tampil di website: Kosong (bisa dipesan), Dipesan (sudah ada DP), Terisi, Perbaikan. Terakhir dipastikan: ${p.checkedAt ? relTime(p.checkedAt) : 'belum pernah'}.</p>
      <div class="table-wrap mt">${rooms.length ? `<table><thead><tr><th>Kamar</th><th>Kapasitas</th>${per.map(([, t]) => `<th class="num">${t}</th>`).join('')}<th>Status</th><th></th></tr></thead><tbody>${rooms.map((r) => `<tr>
        <td data-label="Kamar"><strong>${esc(r.code)}</strong><span class="sub">${esc(r.type || '')}${r.hidden ? ' · disembunyikan' : ''}${(r.photos || []).length ? ` · ${r.photos.length} foto` : ' · belum ada foto'}</span></td>
        <td data-label="Kapasitas">${Number(r.capacity) === 2 ? `2 orang${r.extraPersonFee ? `<span class="sub">+${rp(r.extraPersonFee)}/bln bila berdua</span>` : ''}` : '1 orang'}</td>
        ${per.map(([, t, key]) => `<td class="num" data-label="${t}">${r[key] ? rp(r[key]) : '<span class="muted">-</span>'}</td>`).join('')}
        <td data-label="Status"><select class="inline" data-status="${r.id}" aria-label="Status ${esc(r.code)}">${Object.entries(STATUS_KAMAR).map(([k, t]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td class="actions"><button class="btn btn--ghost btn--sm" data-edit="${r.id}">Ubah</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Belum ada kamar. Tambahkan kamar beserta harga dan fotonya.</div>'}</div>`;
    $('#propSel')?.addEventListener('change', (e) => { propSel = e.target.value; route(); });
    main.onchange = async (e) => {
      const s = e.target.closest('[data-status]'); if (!s) return;
      try { await api('PUT', `/rooms/${s.dataset.status}`, { status: s.value }); toast('Status kamar diperbarui di website.'); const r = data.rooms.find((x) => x.id === s.dataset.status); if (r) r.status = s.value; } catch (ex) { toast(ex.message, true); }
    };
    main.onclick = async (e) => {
      if (e.target.closest('[data-add]')) roomDialog(null, p);
      const ed = e.target.closest('[data-edit]'); if (ed) roomDialog(rooms.find((r) => r.id === ed.dataset.edit), p);
      if (e.target.closest('[data-checked]')) { try { await api('POST', `/properties/${p.id}/checked`, {}); toast('Tercatat. Website menampilkan “dicek baru saja”.'); reload(); } catch (ex) { toast(ex.message, true); } }
    };
  }
  function photoField(name, photos) {
    return `<div class="span-all"><label>Foto <span class="hint">foto pertama tampil paling besar</span></label>
      <div class="photos" data-photos="${name}">${photos.map((u) => `<figure><img src="${esc(u)}" alt=""><button type="button" data-rm="${esc(u)}" aria-label="Hapus foto">✕</button></figure>`).join('')}
      <label class="upload">+ Tambah foto<input type="file" accept="image/*" multiple></label></div>
      <input type="hidden" name="${name}" value="${esc(JSON.stringify(photos))}"></div>`;
  }
  function bindPhotos(body, name) {
    const wrap = $(`[data-photos="${name}"]`, body), hidden = $(`input[name="${name}"]`, body);
    const get = () => JSON.parse(hidden.value || '[]'); const set = (a) => { hidden.value = JSON.stringify(a); };
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; set(get().filter((u) => u !== b.dataset.rm)); b.closest('figure').remove(); });
    $('input[type=file]', wrap).addEventListener('change', async (e) => {
      for (const f of e.target.files) {
        try {
          const out = await BonaLoader.during('Mengunggah foto…', async () => api('POST', '/upload', undefined, await shrink(f)));
          set([...get(), out.url]);
          const fig = document.createElement('figure'); fig.innerHTML = `<img src="${out.url}" alt=""><button type="button" data-rm="${out.url}" aria-label="Hapus foto">✕</button>`;
          wrap.insertBefore(fig, $('.upload', wrap));
        } catch (ex) { toast(ex.message, true); }
      }
      e.target.value = '';
    });
  }
  const lines = (a) => esc((a || []).join('\n'));
  function roomDialog(r, p) {
    const isNew = !r;
    openDialog({
      title: isNew ? `Tambah kamar di ${p.name}` : `Ubah kamar ${r.code}`, ok: isNew ? 'Tambah kamar' : 'Simpan',
      body: `<div class="fields fields--2">
        <label>Kode / nomor kamar<input name="code" value="${esc(r?.code || '')}" required placeholder="A-1"></label>
        <label>Tipe<input name="type" value="${esc(r?.type || '')}" placeholder="Kamar mandi dalam"></label>
        <label>Ukuran<input name="sizeM2" value="${esc(r?.sizeM2 || '')}" placeholder="3 × 4 m"></label>
        <label>Lantai<input name="floor" value="${esc(r?.floor || '')}"></label>
        <label>Kapasitas<select name="capacity" id="rCap"><option value="1">1 orang</option><option value="2" ${Number(r?.capacity) === 2 ? 'selected' : ''}>Bisa 2 orang</option></select></label>
        <label id="rExtra">Tambahan bila berdua <span class="hint">per bulan, opsional</span><input type="number" name="extraPersonFee" min="0" step="1000" value="${r?.extraPersonFee || ''}"></label>
        <p class="fieldset-title span-all">Harga per periode <span class="hint">isi yang dibuka (${p.periods.map((k) => PERIODS.find((x) => x[0] === k)[1]).join(', ')})</span></p>
        ${PERIODS.map(([k, t, key, unit]) => `<label ${p.periods.includes(k) ? '' : 'hidden'}>${t} <span class="hint">${unit}</span><input type="number" name="${key}" min="0" step="1000" value="${r?.[key] ?? ''}"></label>`).join('')}
        <label>Status<select name="status">${Object.entries(STATUS_KAMAR).map(([k, t]) => `<option value="${k}" ${(r?.status || 'kosong') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="span-all">Fasilitas kamar <span class="hint">satu per baris</span><textarea name="facilities" rows="3">${lines(r?.facilities)}</textarea></label>
        <label class="span-all">Keterangan singkat<input name="note" value="${esc(r?.note || '')}" placeholder="Listrik token sendiri"></label>
        ${photoField('photos', r?.photos || [])}
        <label class="span-all"><input type="checkbox" name="hidden" ${r?.hidden ? 'checked' : ''}> Sembunyikan kamar ini dari website</label>
        ${isNew ? '' : '<div class="span-all"><button type="button" class="btn btn--ghost btn--sm" id="rDel">Hapus kamar</button></div>'}
      </div>`,
      onOpen: (b) => {
        bindPhotos(b, 'photos');
        const sync = () => { $('#rExtra', b).hidden = $('#rCap', b).value !== '2'; }; $('#rCap', b).onchange = sync; sync();
        $('#rDel', b)?.addEventListener('click', async () => {
          dlg.close();
          if (!(await askConfirm('Hapus kamar', `Kamar ${r.code} akan dihapus dari website.`, 'Hapus'))) return;
          try { await api('DELETE', `/rooms/${r.id}`); toast('Kamar dihapus.'); reload(); } catch (ex) { toast(ex.message, true); }
        });
      },
      onOk: async (d) => {
        d.photos = JSON.parse(d.photos || '[]'); d.hidden = d.hidden === 'on'; d.propertyId = p.id;
        if (isNew) await api('POST', '/rooms', d); else await api('PUT', `/rooms/${r.id}`, d);
        toast(isNew ? 'Kamar ditambahkan.' : 'Kamar disimpan.'); reload();
      },
    });
  }

  // ========== KOS SAYA ==========
  async function kos() {
    if (!data.properties.length) { main.innerHTML = head('Kos saya', '') + '<div class="empty">Admin belum menghubungkan kos ke akun Anda.</div>'; return; }
    const p = propOf(propSel);
    const canSubmit = ['draf', 'nonaktif'].includes(p.status);
    main.innerHTML = head(esc(p.name), `<span class="pill pill--${p.status}">${esc(PROP_STATUS[p.status])}</span> ${p.status === 'aktif' ? `<a href="/kos/?k=${esc(p.slug)}" target="_blank" rel="noopener">Lihat halaman kos</a>` : ''}`, `${propPicker()}${canSubmit ? (setupItems(p).every((i) => !i[3] || i[0]) ? '<button class="btn btn--green" id="submitBtn">Minta ditampilkan di website</button>' : `<span class="hint">Lengkapi dulu: ${setupItems(p).filter((i) => i[3] && !i[0]).map((i) => i[1].toLowerCase()).join(', ')}</span>`) : ''}`) + `
      ${p.reviewNote ? `<p class="info-box">Catatan admin: ${esc(p.reviewNote)}</p>` : ''}
      <form class="settings-grid mt" id="kosForm">
        <div class="panel fields fields--2">
          <p class="fieldset-title span-all">Informasi kos</p>
          <label>Nama kos<input name="name" value="${esc(p.name)}" required></label>
          <label>Khusus<select name="gender">${['Putra', 'Putri', 'Campur', 'Pasutri'].map((g) => `<option ${p.gender === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
          <label>Kota / area<input name="city" value="${esc(p.city)}" placeholder="Balige"></label>
          <label>Titik peta <span class="hint">nama tempat atau koordinat</span><input name="mapsQuery" value="${esc(p.mapsQuery)}"></label>
          <label class="span-all">Alamat lengkap<input name="address" value="${esc(p.address)}"></label>
          <label class="span-all">Kalimat utama<input name="tagline" value="${esc(p.tagline)}" placeholder="Dekat kampus, tenang, aman."></label>
          <label class="span-all">Deskripsi<textarea name="description" rows="4">${esc(p.description)}</textarea></label>
          <label>Fasilitas bersama <span class="hint">satu per baris</span><textarea name="facilities" rows="5">${lines(p.facilities)}</textarea></label>
          <label>Aturan kos <span class="hint">satu per baris</span><textarea name="rules" rows="5">${lines(p.rules)}</textarea></label>
          <label class="span-all">Dekat dengan <span class="hint">satu per baris</span><textarea name="nearby" rows="3">${lines(p.nearby)}</textarea></label>
          ${photoField('photos', p.photos || [])}
        </div>
        <div class="panel fields">
          <p class="fieldset-title">Periode sewa yang dibuka</p>
          <div class="chips">${PERIODS.map(([k, t]) => `<label class="chip"><input type="checkbox" name="per_${k}" ${p.periods.includes(k) ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
          <p class="hint">Website hanya menampilkan harga dan pilihan untuk periode yang dicentang.</p>
          <p class="fieldset-title">Booking &amp; pembayaran</p>
          <label>Minimal booking / DP<input type="number" name="minBooking" min="0" step="1000" value="${p.minBooking || ''}"><span class="hint">Penyewa tidak bisa diminta DP di bawah angka ini.</span></label>
          <label>Rekening tujuan DP<textarea name="bankInfo" rows="2" placeholder="BRI 1234567890 a.n. Nama Pemilik">${esc(p.bankInfo)}</textarea><span class="hint">Rekening hanya terlihat oleh penyewa setelah Anda memastikan kamarnya tersedia.</span></label>
          <label>Aturan booking &amp; refund<textarea name="bookingPolicy" rows="3" placeholder="Mis. DP hangus bila batal kurang dari 7 hari sebelum masuk; refund 50% bila lebih dari 7 hari.">${esc(p.bookingPolicy)}</textarea></label>
          <label>Jam kunjungan<input name="visitHours" value="${esc(p.visitHours)}" placeholder="Setiap hari 09.00–18.00"></label>
        </div>
        <div class="panel fields">
          <p class="fieldset-title">Cara calon penyewa menghubungi Anda</p>
          <label><input type="checkbox" name="chatEnabled" ${p.chatEnabled !== false ? 'checked' : ''}> Chat dengan calon penyewa di Bonaasina (disarankan)</label>
          <label><input type="checkbox" name="waEnabled" ${p.waEnabled !== false ? 'checked' : ''}> Tampilkan tombol WhatsApp</label>
          <label>Nomor WhatsApp<input name="whatsapp" inputmode="tel" value="${esc(p.whatsapp)}" placeholder="0812…"></label>
          <p class="fieldset-title">Biaya layanan Bonaasina</p>
          <p class="muted">Biaya layanan: <strong>${esc(p.feeRule)}</strong>, dibayar hanya setelah DP penyewa masuk ke rekening Anda.</p>
        </div>
        <div class="form-actions"><button class="btn btn--red" type="submit">Simpan</button></div>
      </form>`;
    bindPhotos(main, 'photos');
    $('#propSel')?.addEventListener('change', (e) => { propSel = e.target.value; route(); });
    $('#kosForm').onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      d.periods = PERIODS.map(([k]) => k).filter((k) => d[`per_${k}`]); PERIODS.forEach(([k]) => delete d[`per_${k}`]);
      d.chatEnabled = d.chatEnabled === 'on'; d.waEnabled = d.waEnabled === 'on'; d.photos = JSON.parse(d.photos || '[]');
      try { await BonaLoader.during('Menyimpan…', () => api('PUT', `/properties/${p.id}`, d)); toast('Info kos disimpan.'); reload(); } catch (ex) { toast(ex.message, true); }
    };
    $('#submitBtn')?.addEventListener('click', async () => {
      try { await api('POST', `/properties/${p.id}/submit`, {}); toast('Terkirim. Admin akan mengecek lalu menampilkan kos Anda.'); reload(); } catch (ex) { toast(ex.message, true); }
    });
  }

  // ========== FEE ==========
  async function fee() {
    const list = data.leads.filter((l) => l.feeAmount > 0);
    const open = list.filter((l) => ['belum', 'ditolak'].includes(l.feeStatus) && ['dp_diterima', 'berhasil'].includes(l.status));
    main.innerHTML = head('Biaya layanan', `Dibayar hanya setelah DP penyewa masuk ke rekening Anda. Rekening Bonaasina: <strong>${esc(data.bonaBankInfo || 'tanyakan admin')}</strong>.`) + `
      <div class="grid grid--stats">
        <div class="panel stat ${open.length ? 'stat--alert' : ''}"><p class="stat__label">Perlu dibayar</p><p class="stat__value">${rp(open.reduce((a, l) => a + l.feeAmount, 0))}</p><p class="stat__sub">${open.length} booking</p></div>
        <div class="panel stat"><p class="stat__label">Menunggu dicek admin</p><p class="stat__value">${rp(list.filter((l) => l.feeStatus === 'dikirim').reduce((a, l) => a + l.feeAmount, 0))}</p></div>
        <div class="panel stat"><p class="stat__label">Sudah lunas</p><p class="stat__value">${rp(list.filter((l) => l.feeStatus === 'diterima').reduce((a, l) => a + l.feeAmount, 0))}</p></div>
        <div class="panel stat"><p class="stat__label">Dikembalikan</p><p class="stat__value">${rp(list.filter((l) => l.feeStatus === 'dikembalikan').reduce((a, l) => a + l.feeAmount, 0))}</p><p class="stat__sub">karena refund</p></div>
      </div>
      <div class="table-wrap mt">${list.length ? `<table><thead><tr><th>Booking</th><th class="num">DP</th><th class="num">Fee</th><th>Status</th><th></th></tr></thead><tbody>${list.map((l) => `<tr>
        <td data-label="Booking"><strong>${esc(l.name)}</strong><span class="sub">${esc(l.propertyName)} ${esc(l.roomCode || '')}, mulai ${tgl(l.moveDate)}</span></td>
        <td class="num" data-label="DP">${rp(l.dpAmount)}</td><td class="num" data-label="Fee">${rp(l.feeAmount)}${l.feeDue && ['belum', 'ditolak'].includes(l.feeStatus) ? `<span class="sub">batas ${tgl(l.feeDue)}</span>` : ''}</td>
        <td data-label="Status"><span class="pill pill--${esc(l.feeStatus === 'belum' ? 'baru' : l.feeStatus)}">${esc(M.FEE[l.feeStatus] || '-')}</span></td>
        <td class="actions"><a class="btn btn--${['belum', 'ditolak'].includes(l.feeStatus) ? 'red' : 'ghost'} btn--sm" href="#reservasi?id=${l.id}">${['belum', 'ditolak'].includes(l.feeStatus) ? 'Bayar & unggah bukti' : 'Buka'}</a></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Belum ada tagihan. Biaya layanan muncul setelah Anda menerima DP dari penyewa.</div>'}</div>`;
  }

  // ========== NOTIFIKASI ==========
  async function notifikasi() {
    const n = data.notifications;
    main.innerHTML = head('Notifikasi', '', n.unread ? '<button class="btn btn--ghost" id="readAll">Tandai semua dibaca</button>' : '') + `<div class="panel">${M.notifs(n.items)}</div>`;
    $('#readAll')?.addEventListener('click', async () => { await api('POST', '/notifications/read', {}); reload(); });
    main.onclick = async (e) => {
      const b = e.target.closest('[data-notif]'); if (!b) return;
      try { await api('POST', '/notifications/read', { ids: [Number(b.dataset.notif)] }); } catch { /* abaikan */ }
      if (b.dataset.lead) location.hash = `#reservasi?id=${b.dataset.lead}`; else reload();
    };
  }

  // ========== AKUN ==========
  async function akun() {
    const o = data.owner;
    main.innerHTML = head('Akun & panduan', '') + `<div class="grid grid--2">
      <div class="panel"><h2>Akun</h2><dl class="kv"><dt>Nama</dt><dd>${esc(o.name)}</dd><dt>Username</dt><dd>${esc(o.username)}</dd><dt>WhatsApp</dt><dd>${esc(o.phone || '-')}</dd></dl>
        <form class="fields mt" id="pwChange"><input type="text" name="username" value="${esc(o.username)}" autocomplete="username" hidden>
          <label>Kata sandi sekarang<input type="password" name="oldPassword" autocomplete="current-password" required></label>
          <label>Kata sandi baru<input type="password" name="newPassword" autocomplete="new-password" minlength="8" required></label>
          <div><button class="btn btn--ghost" type="submit">Ganti kata sandi</button></div></form></div>
      <div class="panel"><h2>Cara kerja</h2>${guide()}
        <p class="hint mt">Batas konfirmasi: usahakan menjawab reservasi baru dalam ${data.leadResponseHours} jam. Batas bayar DP bawaan ${data.dpHours} jam; fee dibayar paling lambat ${data.feeDueDays} hari setelah DP diterima.</p></div></div>`;
    $('#pwChange').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('POST', '/password', Object.fromEntries(new FormData(e.target))); e.target.reset(); toast('Kata sandi diganti.'); } catch (ex) { toast(ex.message, true); }
    };
  }

  if (getSession()?.token) { if (getSession().mustChange) showChange(); else start(); } else showLogin();
})();
