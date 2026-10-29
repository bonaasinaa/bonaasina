/* Dashboard penghuni Bonaasina — tagihan & kuitansi, kontrak, kondisi kamar, piket, pengumuman, kerusakan, profil & kartu. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const tgl = (s) => { if (!s) return '-'; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return `${d} ${BULAN[m - 1]} ${y}`; };
  const hari = (s) => { const [y, m, d] = s.split('-').map(Number); return HARI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; };
  const WAKTU = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const waktu = (iso) => (iso ? `${WAKTU.format(new Date(iso))} WIB` : '-');
  const main = $('#main');
  const CW = (c) => ({ harian: 'malam', semesteran: '6 bulan', tahunan: 'tahun' }[c] || 'bulan');
  const API = (window.BONA_CONFIG?.apiBase || '/api').replace(/\/$/, '');
  const KEY = 'bonaasina-penghuni-session';
  const getSession = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
  const setSession = (s) => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* abaikan */ } };
  let data = null;

  // ---------- API ----------
  // Kegagalan yang tidak ditangani tetap diberitahukan ke pengguna (dulu beberapa tombol gagal tanpa pesan).
  window.addEventListener('unhandledrejection', (e) => {
    e.preventDefault();
    console.error(e.reason);
    toast(e.reason?.message || 'Terjadi kesalahan. Coba lagi.', true);
  });
  async function api(method, path, body, raw) {
    const opt = { method, headers: {} };
    const s = getSession(); if (s?.token) opt.headers['X-Tenant-Session'] = s.token;
    if (raw) { opt.body = raw; opt.headers['Content-Type'] = raw.type; }
    else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
    let res;
    try { res = await fetch(API + '/penghuni' + path, opt); }
    catch { throw new Error('Tidak bisa terhubung. Periksa sinyal atau koneksi internet, lalu coba lagi.'); }
    const ct = res.headers.get('content-type') || '';
    const out = ct.includes('json') ? await res.json().catch(() => ({})) : ct.includes('pdf') ? await res.blob() : await res.text();
    if (res.status === 401 && path !== '/login') { setSession(null); showLogin('Sesi Anda berakhir. Silakan masuk lagi.'); throw new Error('Silakan masuk dulu.'); }
    if (!res.ok) throw new Error(out.error || 'Terjadi kesalahan. Coba lagi.');
    return out;
  }
  function saveBlob(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function download(path, name) {
    try { await BonaLoader.during('Menyiapkan PDF…', async () => saveBlob(await api('GET', path), name)); toast('PDF tersimpan di folder unduhan.'); }
    catch (ex) { if (ex.message !== 'Silakan masuk dulu.') toast(ex.message, true); }
  }
  const safeName = (s) => String(s || 'dokumen').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  // Perkecil foto dari HP sebelum diunggah. jpeg=true selalu hasilkan JPG (untuk kartu penghuni).
  function shrink(file, max = 1600, jpeg = false) {
    return new Promise((resolve) => {
      if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && !jpeg) return resolve(file);
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob((b) => resolve(b && (jpeg || b.size < file.size) ? b : file), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  let toastTimer;
  function toast(msg, isError) {
    const t = $('#toast'); t.textContent = msg; t.classList.toggle('is-error', !!isError); t.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('is-on'), 3600);
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
  }
  $('#dlgForm').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'ok' || !dlgHandler) return;
    e.preventDefault();
    const btn = $('#dlgOk'); btn.disabled = true;
    try { await dlgHandler(Object.fromEntries(new FormData($('#dlgForm'))), $('#dlgBody')); dlg.close(); }
    catch (ex) { $('#dlgErr').textContent = ex.message; $('#dlgErr').hidden = false; }
    finally { btn.disabled = false; }
  });

  // ---------- masuk & keluar ----------
  function showLogin(msg) {
    BonaLoader.reset();
    $('#app').hidden = true; $('#login').hidden = false; dlg.open && dlg.close();
    if (msg) { $('#loginErr').textContent = msg; $('#loginErr').hidden = false; }
    $('#loginUser').focus();
  }
  $('#showPass').addEventListener('click', (e) => {
    const on = $('#loginPass').type === 'password'; $('#loginPass').type = on ? 'text' : 'password';
    e.currentTarget.textContent = on ? 'Sembunyikan' : 'Lihat'; e.currentTarget.setAttribute('aria-pressed', on);
  });
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = $('button[type=submit]', e.target); btn.disabled = true;
    const id = e.target.username.value.trim(); const password = e.target.password.value;
    try {
      if (id.includes('@')) {
        // Email = pemilik; teruskan ke admin.
        const res = await fetch(API + '/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: id, password }) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || 'Email atau kata sandi salah.');
        try { localStorage.setItem('bonaasina-admin-session', JSON.stringify(out)); } catch { /* abaikan */ }
        location.href = '/admin/'; return;
      }
      // Satu pintu masuk: username pemilik kos mitra/customer diarahkan ke dashboard masing-masing.
      const out = await window.BonaMarket.login(id, password);
      if (out.kind !== 'penghuni') { location.href = out.home; return; }
      setSession(out);
      e.target.password.value = ''; $('#loginErr').hidden = true;
      start();
    } catch (ex) { $('#loginErr').textContent = ex.message; $('#loginErr').hidden = false; }
    finally { btn.disabled = false; }
  });
  $('#logout').addEventListener('click', async () => {
    try { await api('POST', '/logout'); } catch { /* tetap keluar */ }
    setSession(null); data = null; main.innerHTML = ''; showLogin();
  });

  async function load() { data = await api('GET', '/me'); return data; }
  async function start() {
    $('#login').hidden = true; $('#app').hidden = false;
    BonaLoader.show('Menyiapkan dashboard Anda…', 0);
    try { await load(); route(); }
    catch (ex) { if (ex.message !== 'Silakan masuk dulu.') main.innerHTML = `<div class="panel empty">${esc(ex.message)}<br><button class="btn btn--red" id="retry">Coba lagi</button></div>`; $('#retry')?.addEventListener('click', start); }
    finally { BonaLoader.hide(); }
  }
  // Muat ulang data setelah ada perubahan, lalu gambar ulang menu yang sedang dibuka.
  async function refresh(label = 'Memperbarui…') {
    await BonaLoader.during(label, load);
    route(true);
  }

  // ---------- router ----------
  const views = { beranda, tagihan, kontrak, kondisi, piket, pengumuman, kerusakan, profil };
  const TITLES = { beranda: 'Beranda', tagihan: 'Tagihan & kuitansi', kontrak: 'Kontrak', kondisi: 'Kondisi kamar', piket: 'Piket', pengumuman: 'Pengumuman', kerusakan: 'Lapor kerusakan', profil: 'Profil & kartu' };
  let shown = null;
  function route(keepScroll) {
    if (!data) return;
    const name = views[location.hash.slice(1)] ? location.hash.slice(1) : 'beranda';
    const isNew = shown !== name;
    $$('#sideNav a').forEach((a) => (a.dataset.view === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    $('#topTitle').textContent = TITLES[name]; document.title = `${TITLES[name]} — Dashboard Penghuni Bonaasina`;
    closeNav(); badges();
    const y = scrollY;
    main.onclick = null; main.onchange = null;
    views[name]();
    shown = name;
    if (isNew) { main.classList.remove('is-in'); void main.offsetWidth; main.classList.add('is-in'); scrollTo(0, 0); window.bonaTrack?.(`/penghuni/${name}`, `Penghuni: ${TITLES[name]}`); }
    else if (keepScroll) scrollTo(0, y);
  }
  addEventListener('hashchange', () => route());
  const nav = $('#side');
  function openNav() { nav.classList.add('is-open'); $('#navScrim').hidden = false; $('#menuBtn').setAttribute('aria-expanded', 'true'); document.body.classList.add('nav-open'); }
  function closeNav() { nav.classList.remove('is-open'); $('#navScrim').hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); document.body.classList.remove('nav-open'); }
  $('#menuBtn').addEventListener('click', () => (nav.classList.contains('is-open') ? closeNav() : openNav()));
  $('#navScrim').addEventListener('click', closeNav);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('is-open')) closeNav(); });

  const head = (title, sub, actions = '') => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="actions">${actions}</div></div>`;
  const counts = () => {
    const n = data.notifications;
    return {
      tagihan: data.invoices.filter((i) => i.status === 'belum' && (i.overdue || i.proofStatus === 'ditolak')).length,
      kontrak: n.filter((x) => x.kind === 'kontrak').length,
      kondisi: data.inspections.filter((x) => !x.tenantAckAt).length,
      piket: n.filter((x) => x.kind === 'piket').length,
      pengumuman: data.announcements.filter((a) => !a.read).length,
    };
  };
  function badges() {
    const c = counts(); const set = (id, v) => { const b = $(id); b.textContent = v; b.hidden = !v; };
    set('#bTagihan', c.tagihan); set('#bKontrak', c.kontrak); set('#bKondisi', c.kondisi); set('#bPiket', c.piket); set('#bPengumuman', c.pengumuman);
    $('#navDot').hidden = !Object.values(c).some(Boolean);
    $('#sideWho').innerHTML = `${esc(data.tenant.name)}<span>Kamar ${esc(data.room?.code || '-')}, ${esc(data.property?.name || '')}</span>`;
  }
  const waOwner = (text) => (data.owner.whatsapp ? `https://wa.me/${data.owner.whatsapp}?text=${encodeURIComponent(text)}` : null);
  const PHASE = { menunggu: 'Menunggu persetujuan Anda', aktif: 'Aktif', akan_mulai: 'Akan mulai', akan_habis: 'Akan berakhir', berakhir: 'Berakhir', dibatalkan: 'Dibatalkan' };
  const CONDITION = { baik: 'Baik', kurang: 'Kurang baik', rusak: 'Rusak', tidak_ada: 'Tidak ada' };
  function invoiceState(i) {
    if (i.status === 'lunas') return { cls: 'lunas', text: `Lunas ${tgl(i.paidAt)}` };
    if (i.proofStatus === 'menunggu') return { cls: 'dikonfirmasi', text: 'Bukti terkirim, sedang dicek' };
    if (i.proofStatus === 'ditolak') return { cls: 'terlambat', text: 'Bukti ditolak' };
    if (i.overdue) return { cls: 'terlambat', text: `Terlambat ${i.overdueDays} hari` };
    return { cls: 'belum', text: 'Belum dibayar' };
  }

  // ========== BERANDA ==========
  function beranda() {
    const { tenant, room, property, invoices, contracts, chores, announcements, notifications, today } = data;
    const first = (tenant.name || '').split(' ')[0];
    const unpaid = invoices.filter((i) => i.status === 'belum').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const current = contracts.find((c) => ['aktif', 'akan_habis', 'akan_mulai'].includes(c.phase)) || contracts.find((c) => c.phase === 'menunggu');
    const nextChore = chores.filter((c) => c.mine && !c.report && c.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    const latestAnn = announcements[0];
    const wa = waOwner(`Horas, saya ${tenant.name} dari kamar ${room?.code || ''}. `);
    const D = window.BonaDash;
    const unread = announcements.filter((x) => !x.read).length;
    const late = unpaid.some((i) => i.overdue);
    main.innerHTML = `
      <section class="hello">
        <div><p class="hello__kicker">${D.longDate(today)}</p>
          <h1>Horas, ${esc(first)}.</h1>
          <p>Kamar ${esc(room?.code || '-')}${room?.type ? `, ${esc(room.type)}` : ''} di ${esc(property?.name || 'Bonaasina')}. Sewa ${rp(tenant.rentAmount)} per ${CW(tenant.rentCycle)}.</p></div>
        <div class="hello__actions">${wa ? `<a class="btn btn--ghost btn--wa" href="${esc(wa)}" target="_blank" rel="noopener">${D.ico('wa')}Chat pengelola</a>` : ''}${unpaid[0] ? '<a class="btn btn--light" href="#tagihan">Bayar tagihan</a>' : ''}</div>
      </section>
      <div class="grid grid--stats grid--hero">
        <a class="panel stat ${late ? 'stat--red stat--alert' : unpaid[0] ? 'stat--amber' : 'stat--green'} stat--link" href="#tagihan"><p class="stat__label">Tagihan berikutnya</p><span class="stat__ico">${D.ico(unpaid[0] ? 'wallet' : 'check')}</span><p class="stat__value">${unpaid[0] ? rp(unpaid[0].amount) : 'Lunas'}</p><p class="stat__sub">${unpaid[0] ? `${esc(unpaid[0].periodLabel)}, jatuh tempo ${tgl(unpaid[0].dueDate)}` : 'Tidak ada yang perlu dibayar'}</p></a>
        <a class="panel stat stat--blue stat--link" href="#kontrak"><p class="stat__label">Kontrak</p><span class="stat__ico">${D.ico('calendar')}</span><p class="stat__value">${current ? (current.phase === 'menunggu' ? 'Perlu disetujui' : current.daysLeft !== null && current.daysLeft >= 0 ? `${current.daysLeft} hari` : PHASE[current.phase]) : '-'}</p><p class="stat__sub">${current ? (current.phase === 'menunggu' ? esc(current.number) : `Berakhir ${tgl(current.endDate)}`) : 'Belum ada kontrak'}</p></a>
        <a class="panel stat stat--green stat--link" href="#piket"><p class="stat__label">Piket Anda berikutnya</p><span class="stat__ico">${D.ico('tool')}</span><p class="stat__value">${nextChore ? (nextChore.date === today ? 'Hari ini' : hari(nextChore.date)) : '-'}</p><p class="stat__sub">${nextChore ? `${esc(nextChore.name)}, ${tgl(nextChore.date)}` : 'Belum ada jadwal'}</p></a>
        <a class="panel stat stat--amber stat--link" href="#pengumuman"><p class="stat__label">Pengumuman</p><span class="stat__ico">${D.ico('bell')}</span><p class="stat__value">${unread ? `${unread} baru` : 'Tidak ada'}</p><p class="stat__sub">${latestAnn ? esc(latestAnn.title) : 'Belum ada pengumuman'}</p></a>
      </div>
      <section class="panel mt"><h2>Yang perlu Anda lakukan</h2>${notifications.length ? `<div class="todo">${notifications.map((n) => `<a href="#${n.view}" class="${n.urgent ? 'is-urgent' : ''}"><span class="dot"></span><span>${esc(n.text)}</span></a>`).join('')}</div>` : '<p class="empty--ok">Semua beres. Tidak ada yang perlu Anda lakukan sekarang.</p>'}</section>
      ${(property?.rules || []).length ? `<section class="panel mt"><h2>Aturan ${esc(property.name)}</h2><ul class="rules">${property.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></section>` : ''}`;
    D.sideWidget(unpaid[0] ? `<small>Tagihan berikutnya</small><strong style="font-size:1.4rem">${rp(unpaid[0].amount)}</strong><small>${late ? 'Sudah lewat jatuh tempo' : `Jatuh tempo ${tgl(unpaid[0].dueDate)}`}</small>` : '<small>Status bayar</small><strong style="font-size:1.4rem">Lunas</strong><small>Terima kasih sudah tepat waktu</small>');
  }

  // ========== TAGIHAN ==========
  let uploadFor = null;
  function tagihan() {
    const unpaid = data.invoices.filter((i) => i.status === 'belum').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const paid = data.invoices.filter((i) => i.status === 'lunas');
    main.innerHTML = head('Tagihan & kuitansi', 'Bayar lewat transfer, unggah bukti, lalu kuitansi terbit setelah pengelola memeriksa pembayaran Anda.') + `
      <div class="detail-grid">
        <section class="panel"><h2>Belum dibayar</h2>${unpaid.length ? `<div class="list">${unpaid.map((i) => { const st = invoiceState(i); return `<div class="list__item"><div><strong>${esc(i.periodLabel)}</strong> <span class="pill pill--${st.cls}">${st.text}</span>
            <span class="sub">${rp(i.amount)}, jatuh tempo ${tgl(i.dueDate)}</span>${i.proofStatus === 'ditolak' ? `<span class="sub" style="color:var(--red)">Alasan: ${esc(i.proofNote || 'hubungi pengelola')}</span>` : ''}${i.proofStatus === 'menunggu' ? `<span class="sub">Dikirim ${waktu(i.proofUploadedAt)}</span>` : ''}</div>
            <div class="btn-row"><button class="btn btn--${i.proofStatus === 'menunggu' ? 'ghost' : 'red'} btn--sm" data-upload="${i.id}">${i.proofStatus === 'menunggu' ? 'Ganti bukti' : i.proofStatus === 'ditolak' ? 'Unggah ulang bukti' : 'Unggah bukti bayar'}</button></div></div>`; }).join('')}</div>`
          : '<p class="empty--ok">Semua lunas. Tagihan berikutnya muncul di sini sekitar seminggu sebelum jatuh tempo.</p>'}</section>
        <section class="panel"><h2>Cara bayar</h2>${data.paymentInfo ? `<p class="pay-info" id="payInfo">${esc(data.paymentInfo)}</p>${data.paymentMethods ? `<p class="hint">${esc(data.paymentMethods)}</p>` : ''}<div class="panel-actions"><button class="btn btn--ghost btn--sm" id="copyPay">Salin info rekening</button></div>` : '<p class="muted">Tanyakan cara bayar ke pengelola.</p>'}
          <ol class="steps"><li>Transfer sesuai jumlah tagihan.</li><li>Tekan <strong>Unggah bukti bayar</strong> dan pilih foto atau tangkapan layar bukti transfer.</li><li>Pengelola memeriksa, lalu kuitansi PDF bisa Anda unduh di bawah.</li></ol></section>
      </div>
      <section class="panel mt"><h2>Riwayat & kuitansi</h2>${paid.length ? `<table><tbody>${paid.map((i) => `<tr>
          <td data-label="Periode"><strong>${esc(i.periodLabel)}</strong><span class="sub">${i.receiptNo ? esc(i.receiptNo) : 'Kuitansi dibuat saat diunduh'}</span></td>
          <td data-label="Dibayar">${tgl(i.paidAt)}</td><td class="num" data-label="Jumlah">${rp(i.paidAmount ?? i.amount)}</td>
          <td class="actions"><button class="btn btn--ghost btn--sm" data-receipt="${i.id}">Unduh kuitansi</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Belum ada pembayaran tercatat.</p>'}</section>
      <input type="file" id="fileIn" accept="image/*" hidden>`;
    $('#copyPay')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('#payInfo').textContent); toast('Info rekening disalin.'); }
      catch { getSelection().selectAllChildren($('#payInfo')); toast('Teks sudah dipilih, salin secara manual.'); }
    });
    main.onclick = (e) => {
      const u = e.target.closest('[data-upload]'); if (u) { uploadFor = u.dataset.upload; $('#fileIn').click(); }
      const r = e.target.closest('[data-receipt]'); if (r) { const i = paid.find((x) => x.id === r.dataset.receipt); download(`/invoices/${i.id}/receipt.pdf`, `kuitansi-${safeName(i.periodLabel)}.pdf`); }
    };
    $('#fileIn').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f || !uploadFor) return;
      try {
        await BonaLoader.during('Mengirim bukti bayar…', async () => api('POST', `/invoices/${uploadFor}/proof`, undefined, await shrink(f)));
        toast('Bukti terkirim. Pengelola akan memeriksa dan menandai lunas.'); await refresh();
      } catch (ex) { toast(ex.message, true); }
    });
  }

  // ========== KONTRAK ==========
  function kontrak() {
    const list = data.contracts;
    const pending = list.find((c) => c.phase === 'menunggu');
    // Kontrak yang sedang berjalan didahulukan; kontrak perpanjangan yang belum mulai tidak menutupinya.
    const current = list.find((c) => ['aktif', 'akan_habis'].includes(c.phase)) || list.find((c) => c.phase === 'akan_mulai');
    const canDecide = current && current.phase !== 'akan_mulai' && current.daysLeft !== null && current.daysLeft <= 60;
    main.innerHTML = head('Kontrak sewa', 'Baca dan setujui kontrak secara elektronik. Salinan PDF tersimpan dan bisa diunduh kapan saja.') + `
      ${pending ? `<section class="panel panel--focus"><h2>Kontrak baru menunggu persetujuan Anda</h2>
        <dl class="kv"><dt>Nomor</dt><dd>${esc(pending.number)}</dd><dt>Masa sewa</dt><dd>${tgl(pending.startDate)} s.d. ${tgl(pending.endDate)}</dd><dt>Harga</dt><dd>${rp(pending.rentAmount)} per ${CW(pending.rentCycle)}</dd><dt>Deposit</dt><dd>${rp(pending.deposit)}</dd></dl>
        <div class="panel-actions"><button class="btn btn--red" data-read="${pending.id}">Baca & setujui</button><button class="btn btn--ghost" data-pdf="${pending.id}">Unduh draf PDF</button></div></section>` : ''}
      ${current ? `<section class="panel ${pending ? 'mt' : ''}"><h2>Kontrak berjalan <span class="pill pill--${current.phase}">${PHASE[current.phase]}</span></h2>
        <dl class="kv"><dt>Nomor</dt><dd>${esc(current.number)}</dd><dt>Masa sewa</dt><dd>${tgl(current.startDate)} s.d. ${tgl(current.endDate)}${current.daysLeft >= 0 ? ` (${current.daysLeft} hari lagi)` : ''}</dd><dt>Disetujui</dt><dd>${waktu(current.acceptedAt)}</dd></dl>
        ${current.decision ? `<p class="info-box mt">Pilihan Anda: <strong>${current.decision === 'perpanjang' ? 'perpanjang sewa' : 'berhenti di akhir kontrak'}</strong> (${waktu(current.decisionAt)}). ${current.decisionHandledAt ? 'Sudah ditindaklanjuti pengelola.' : 'Pengelola akan menghubungi Anda.'}</p>` : ''}
        ${canDecide ? `<div class="decide mt"><p><strong>Kontrak Anda ${current.daysLeft >= 0 ? `berakhir dalam ${current.daysLeft} hari` : 'sudah berakhir'}.</strong> ${current.decision ? 'Anda masih bisa mengubah pilihan.' : 'Beri tahu pengelola apakah Anda akan memperpanjang.'}</p>
          <div class="btn-row mt"><button class="btn btn--red" data-decide="perpanjang">Saya perpanjang</button><button class="btn btn--ghost" data-decide="berhenti">Saya berhenti</button></div></div>` : ''}
        <div class="panel-actions"><button class="btn btn--ghost" data-view-c="${current.id}">Baca isi kontrak</button><button class="btn btn--ghost" data-pdf="${current.id}">Unduh PDF</button></div></section>` : ''}
      ${!pending && !current ? '<section class="panel empty">Belum ada kontrak. Pengelola akan mengirim kontrak ke dashboard ini.</section>' : ''}
      ${list.filter((c) => c !== pending && c !== current).length ? `<section class="panel mt"><h2>Kontrak sebelumnya</h2><div class="list">${list.filter((c) => c !== pending && c !== current).map((c) => `<div class="list__item"><div><strong>${esc(c.number)}</strong> <span class="pill pill--${c.phase}">${PHASE[c.phase]}</span><span class="sub">${tgl(c.startDate)} s.d. ${tgl(c.endDate)}</span></div><div class="btn-row"><button class="btn btn--ghost btn--sm" data-pdf="${c.id}">PDF</button></div></div>`).join('')}</div></section>` : ''}`;
    main.onclick = async (e) => {
      const pdf = e.target.closest('[data-pdf]'); if (pdf) { const c = list.find((x) => x.id === pdf.dataset.pdf); download(`/contracts/${c.id}/pdf`, `kontrak-${safeName(c.number)}.pdf`); }
      const rd = e.target.closest('[data-read]'); if (rd) readContract(list.find((x) => x.id === rd.dataset.read), true);
      const vc = e.target.closest('[data-view-c]'); if (vc) readContract(list.find((x) => x.id === vc.dataset.viewC), false);
      const dc = e.target.closest('[data-decide]'); if (dc) decide(current, dc.dataset.decide);
    };
  }
  async function readContract(c, toSign) {
    let full;
    try { full = await BonaLoader.during('Membuka kontrak…', () => api('GET', `/contracts/${c.id}`)); } catch (ex) { return toast(ex.message, true); }
    openDialog({
      wide: true, title: toSign ? 'Baca & setujui kontrak' : `Kontrak ${full.number}`, ok: 'Setujui kontrak', okClass: 'btn--red',
      body: `<p class="muted">${esc(full.number)}, ${tgl(full.startDate)} s.d. ${tgl(full.endDate)}</p>
        <div class="doc-text mt" tabindex="0">${esc(full.body).replace(/^## (.*)$/gm, '<strong class="doc-h">$1</strong>')}</div>
        ${toSign ? `<div class="fields mt">
          <label><input type="checkbox" name="agree" id="agree">Saya sudah membaca seluruh isi kontrak dan menyetujuinya.</label>
          <label>Ketik nama lengkap Anda sebagai tanda persetujuan<input name="name" autocomplete="name" placeholder="${esc(data.tenant.name)}"></label>
          <p class="hint">Waktu persetujuan dan perangkat yang Anda pakai dicatat. Setelah disetujui, PDF kontrak tersimpan dan bisa diunduh.</p></div>` : ''}`,
      onOk: toSign ? async (d) => {
        if (d.agree !== 'on') throw new Error('Centang pernyataan setuju terlebih dahulu.');
        await api('POST', `/contracts/${c.id}/accept`, { agree: true, name: d.name });
        toast('Kontrak disetujui. PDF tersimpan di menu Kontrak.');
        setTimeout(() => refresh(), 50);
      } : undefined,
    });
  }
  function decide(c, decision) {
    openDialog({
      title: decision === 'perpanjang' ? 'Perpanjang sewa' : 'Berhenti di akhir kontrak', ok: 'Kirim pilihan',
      body: `<p>${decision === 'perpanjang' ? `Anda akan memberi tahu pengelola bahwa Anda ingin melanjutkan sewa setelah ${tgl(c.endDate)}. Pengelola akan menyiapkan kontrak lanjutan.` : `Anda akan memberi tahu pengelola bahwa Anda keluar pada akhir kontrak, ${tgl(c.endDate)}. Pengelola akan mengatur pemeriksaan kamar dan pengembalian deposit.`}</p>
        <label class="mt">Catatan untuk pengelola <span class="hint">opsional</span><textarea name="note" rows="3" placeholder="${decision === 'perpanjang' ? 'Mis. ingin sewa tahunan berikutnya' : 'Mis. rencana keluar tanggal berapa'}"></textarea></label>`,
      onOk: async (d) => { await api('POST', `/contracts/${c.id}/decision`, { decision, note: d.note }); toast('Pilihan Anda terkirim ke pengelola.'); setTimeout(() => refresh(), 50); },
    });
  }

  // ========== KONDISI KAMAR ==========
  function kondisi() {
    const list = data.inspections;
    const masuk = list.find((x) => x.kind === 'masuk');
    main.innerHTML = head('Kondisi kamar', 'Catatan kondisi kamar saat Anda masuk dan keluar, lengkap dengan foto. Periksa dan setujui supaya penghitungan deposit jelas bagi kedua pihak.') +
      (list.length ? list.map((x) => `<section class="panel ${x === list[0] ? '' : 'mt'}"><h2>Saat ${x.kind} <span class="pill pill--${x.tenantAckAt ? 'disetujui' : 'menunggu'}">${x.tenantAckAt ? 'Sudah Anda setujui' : 'Perlu Anda periksa'}</span></h2>
        <p class="muted">Diperiksa ${tgl(x.date)}.${x.tenantAckAt ? ` Anda menyetujui ${waktu(x.tenantAckAt)}.` : ''}</p>
        <div class="insp-view mt">${x.items.map((i) => { const w = x.kind === 'keluar' && masuk ? masuk.items.find((m) => m.name === i.name) : null; return `<div class="insp-view__row"><strong>${esc(i.name)}</strong><span class="pill pill--${i.condition}">${CONDITION[i.condition]}</span>
          ${i.note ? `<span class="sub">${esc(i.note)}</span>` : ''}${w ? `<span class="sub">Saat masuk: ${CONDITION[w.condition]}${w.note ? `, ${esc(w.note)}` : ''}</span>` : ''}
          ${i.photos.length ? `<div class="thumbs">${i.photos.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Foto ${esc(i.name)}" loading="lazy"></a>`).join('')}</div>` : ''}</div>`; }).join('')}</div>
        ${x.note ? `<p class="mt"><strong>Catatan pengelola:</strong> ${esc(x.note)}</p>` : ''}
        ${x.kind === 'keluar' ? `<p class="mt"><strong>Potongan deposit:</strong> ${rp(x.depositDeduction)}${x.deductionNote ? ` (${esc(x.deductionNote)})` : ''}. Deposit Anda ${rp(data.tenant.deposit)}.</p>` : ''}
        ${x.tenantNote ? `<p class="mt"><strong>Catatan Anda:</strong> ${esc(x.tenantNote)}</p>` : ''}
        ${x.tenantAckAt ? '' : `<div class="panel-actions"><button class="btn btn--red" data-ack="${x.id}">Saya sudah periksa & setuju</button>${waOwner('') ? `<a class="btn btn--ghost" href="${esc(waOwner(`Horas, saya ${data.tenant.name} kamar ${data.room?.code || ''}. Soal catatan kondisi kamar saat ${x.kind}: `))}" target="_blank" rel="noopener">Ada yang tidak sesuai</a>` : ''}</div>`}
      </section>`).join('') : '<section class="panel empty">Belum ada catatan kondisi kamar. Pengelola mengisinya saat Anda masuk dan saat keluar.</section>');
    main.onclick = (e) => {
      const a = e.target.closest('[data-ack]'); if (!a) return;
      openDialog({
        title: 'Setujui catatan kondisi', ok: 'Setujui',
        body: '<p>Dengan menyetujui, Anda menyatakan catatan dan foto kondisi kamar ini sesuai dengan keadaan sebenarnya.</p><label class="mt">Catatan tambahan <span class="hint">opsional</span><textarea name="note" rows="3" placeholder="Mis. ada goresan kecil di pintu yang belum tercatat"></textarea></label>',
        onOk: async (d) => { await api('POST', `/inspections/${a.dataset.ack}/ack`, { note: d.note }); toast('Terima kasih, catatan kondisi sudah Anda setujui.'); setTimeout(() => refresh(), 50); },
      });
    };
  }

  // ========== PIKET ==========
  function piket() {
    const { chores, today } = data;
    const mine = chores.filter((c) => c.mine);
    const byDate = chores.reduce((m, c) => { (m[c.date] ||= []).push(c); return m; }, {});
    const dates = Object.keys(byDate).sort();
    const upcoming = dates.filter((d) => d >= today); const past = dates.filter((d) => d < today).reverse();
    const item = (c) => {
      const canReport = c.mine && !c.report && c.date <= today && c.date >= addDays(today, -14);
      const state = c.report ? ['selesai', 'Selesai'] : c.date < today ? ['terlewat', c.mine ? 'Belum ada bukti' : 'Belum dilaporkan'] : c.date === today ? ['hari_ini', 'Hari ini'] : ['akan_datang', 'Akan datang'];
      return `<div class="list__item ${c.mine ? 'is-mine' : ''}"><div><strong>${esc(c.name)}</strong> <span class="pill pill--${state[0]}">${state[1]}</span>${c.mine ? ' <span class="pill pill--info">Giliran Anda</span>' : ''}
        <span class="sub">${c.mode === 'bersama' ? 'Semua penghuni bersama' : `Bertugas: ${esc(c.assigned.join(', '))}`}</span>${c.description ? `<span class="sub">${esc(c.description)}</span>` : ''}
        ${c.report ? `<span class="sub">Dilaporkan ${esc(c.report.by)}, ${waktu(c.report.at)}${c.report.note ? `: "${esc(c.report.note)}"` : ''}</span><div class="thumbs">${c.report.photos.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Foto piket" loading="lazy"></a>`).join('')}</div>` : ''}</div>
        ${canReport ? `<div class="btn-row"><button class="btn btn--red btn--sm" data-report="${c.taskId}|${c.date}">Kirim foto bukti</button></div>` : c.report && c.mine && c.date >= addDays(today, -14) ? `<div class="btn-row"><button class="btn btn--ghost btn--sm" data-report="${c.taskId}|${c.date}">Tambah foto</button></div>` : ''}</div>`;
    };
    const group = (ds) => ds.map((d) => `<div class="day"><p class="day__label ${d === today ? 'is-today' : ''}">${d === today ? 'Hari ini, ' : ''}${hari(d)} ${tgl(d)}</p><div class="list">${byDate[d].map(item).join('')}</div></div>`).join('');
    main.innerHTML = head('Piket', 'Jadwal kebersihan bergilir. Setelah piket, kirim foto keadaan lingkungan kos sebagai bukti.') + `
      ${mine.length ? '' : '<p class="info-box" style="margin-bottom:14px">Belum ada giliran piket untuk Anda dalam tiga minggu ke depan.</p>'}
      <section class="panel"><h2>Jadwal mendatang</h2>${upcoming.length ? group(upcoming) : '<p class="muted">Belum ada jadwal piket.</p>'}</section>
      ${past.length ? `<section class="panel mt"><h2>Dua minggu terakhir</h2>${group(past)}</section>` : ''}`;
    main.onclick = (e) => { const r = e.target.closest('[data-report]'); if (!r) return; const [taskId, date] = r.dataset.report.split('|'); reportChore(chores.find((c) => c.taskId === taskId && c.date === date)); };
  }
  function reportChore(c) {
    const files = [];
    openDialog({
      title: `Bukti piket: ${c.name}`, ok: 'Kirim bukti',
      body: `<p class="muted">${hari(c.date)}, ${tgl(c.date)}. Lampirkan 1–4 foto keadaan setelah dibersihkan.</p>
        <div class="photos mt" id="chPhotos"><label class="upload">+ Foto<input type="file" accept="image/*" multiple id="chFiles"></label></div>
        <label class="mt">Catatan <span class="hint">opsional</span><textarea name="note" rows="2" placeholder="Mis. lorong dan tangga sudah disapu dan dipel"></textarea></label>`,
      onOpen: (b) => {
        const draw = () => { $$('figure', b).forEach((f) => f.remove()); files.forEach((f, i) => { const fig = document.createElement('figure'); fig.innerHTML = `<img src="${URL.createObjectURL(f)}" alt=""><button type="button" data-rm="${i}" aria-label="Hapus foto">✕</button>`; $('#chPhotos', b).insertBefore(fig, $('.upload', b)); }); $('.upload', b).hidden = files.length >= 4; };
        $('#chFiles', b).addEventListener('change', (e) => { for (const f of e.target.files) if (files.length < 4) files.push(f); e.target.value = ''; draw(); });
        $('#chPhotos', b).addEventListener('click', (e) => { const x = e.target.closest('[data-rm]'); if (x) { files.splice(Number(x.dataset.rm), 1); draw(); } });
      },
      onOk: async (d) => {
        if (!files.length) throw new Error('Lampirkan minimal satu foto.');
        await BonaLoader.during('Mengirim foto piket…', async () => {
          const paths = [];
          for (const f of files) paths.push((await api('POST', '/upload?kind=piket', undefined, await shrink(f, 1400))).path);
          await api('POST', '/chores/report', { taskId: c.taskId, date: c.date, note: d.note, photos: paths });
        });
        toast('Terima kasih! Bukti piket terkirim.'); setTimeout(() => refresh(), 50);
      },
    });
  }
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

  // ========== PENGUMUMAN ==========
  function pengumuman() {
    const list = data.announcements;
    const unread = list.filter((a) => !a.read);
    main.innerHTML = head('Pengumuman', 'Informasi dari pengelola kos.') + (list.length ? list.map((a) => `<article class="ann ${a.priority === 'penting' ? 'ann--penting' : ''}">
        <div class="ann__head"><div><h3>${esc(a.title)}</h3><p class="ann__meta">${waktu(a.createdAt)}${a.expiresOn ? `, berlaku sampai ${tgl(a.expiresOn)}` : ''}</p></div>
          <div class="btn-row">${!a.read ? '<span class="pill pill--menunggu">Baru</span>' : ''}${a.priority === 'penting' ? '<span class="pill pill--penting">Penting</span>' : ''}</div></div>
        ${a.body ? `<p class="ann__body">${esc(a.body)}</p>` : ''}</article>`).join('') : '<section class="panel empty">Belum ada pengumuman.</section>');
    // Dibuka = dibaca. Tanda "Baru" tetap tampil sampai menu ini ditinggalkan.
    if (unread.length) {
      Promise.all(unread.map((a) => api('POST', `/announcements/${a.id}/read`).then(() => { a.read = true; }).catch(() => {})))
        .then(() => { badges(); data.notifications = data.notifications.filter((n) => n.kind !== 'pengumuman'); });
    }
  }

  // ========== KERUSAKAN ==========
  const CATS = ['Listrik', 'Air & kamar mandi', 'Pintu & kunci', 'Perabot', 'WiFi', 'Kebersihan', 'Lainnya'];
  const ISSUE = { baru: 'Diterima', dikerjakan: 'Sedang dikerjakan', selesai: 'Selesai' };
  function kerusakan() {
    let photo = null;
    main.innerHTML = head('Lapor kerusakan', 'Laporkan yang rusak di kamar atau fasilitas bersama. Pengelola memperbarui statusnya di sini.') + `
      <div class="detail-grid">
        <section class="panel"><h2>Laporan baru</h2>
          <form class="fields" id="issueForm" novalidate>
            <fieldset class="chips-field"><legend>Apa yang bermasalah?</legend><div class="chips">${CATS.map((c, i) => `<label class="chip"><input type="radio" name="category" value="${esc(c)}" ${i === 0 ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</div></fieldset>
            <label>Judul singkat<input name="title" maxlength="120" placeholder="Contoh: Lampu kamar mandi mati" required></label>
            <label>Keterangan <span class="hint">opsional</span><textarea name="description" rows="3" maxlength="1500" placeholder="Sejak kapan, seberapa parah, kapan Anda ada di kamar"></textarea></label>
            <div class="btn-row"><label class="btn btn--ghost btn--sm">Tambah foto<input type="file" accept="image/*" id="issueFile" hidden></label><span class="muted small" id="issueFileName"></span></div>
            <p class="err" id="issueErr" role="alert" hidden></p>
            <button class="btn btn--red" type="submit">Kirim laporan</button>
          </form></section>
        <section class="panel"><h2>Laporan Anda</h2>${data.issues.length ? `<div class="list">${data.issues.map((i) => `<div class="list__item"><div><strong>${esc(i.title)}</strong> <span class="pill pill--${i.status === 'selesai' ? 'selesai' : i.status === 'baru' ? 'baru' : 'dikonfirmasi'}">${ISSUE[i.status]}</span>
            <span class="sub">${esc(i.category)}, dilaporkan ${tgl(i.createdAt)}${i.hasPhoto ? ', dengan foto' : ''}</span>${i.ownerNote ? `<span class="sub">Pengelola: ${esc(i.ownerNote)}</span>` : ''}</div></div>`).join('')}</div>` : '<p class="muted">Belum ada laporan.</p>'}</section>
      </div>`;
    $('#issueFile').addEventListener('change', (e) => { photo = e.target.files[0] || null; $('#issueFileName').textContent = photo ? photo.name : ''; });
    // Menyimpan sementara id laporan yang sudah dibuat tetapi fotonya belum berhasil terkirim, supaya
    // menekan "Kirim" lagi hanya mengulang unggahan foto (dulu membuat laporan kedua).
    let createdId = null;
    $('#issueForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target; const err = $('#issueErr'); const body = Object.fromEntries(new FormData(f));
      if (!String(body.title || '').trim()) { err.textContent = 'Tulis singkat apa yang rusak.'; err.hidden = false; return; }
      err.hidden = true;
      try {
        await BonaLoader.during('Mengirim laporan…', async () => {
          createdId ||= (await api('POST', '/issues', body)).id;
          if (photo) await api('POST', `/issues/${createdId}/photo`, undefined, await shrink(photo));
        });
        createdId = null;
        toast('Laporan terkirim. Pengelola akan menindaklanjuti.'); await refresh();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
  }

  // ========== PROFIL & KARTU ==========
  function profil() {
    const { tenant: t, room, property, card } = data;
    main.innerHTML = head('Profil & kartu penghuni', 'Data Anda yang tercatat di pengelola, kartu penghuni, dan kata sandi.') + `
      <div class="detail-grid">
        <section class="panel"><h2>Kartu penghuni</h2>
          ${idCardHtml({ name: t.name, propertyName: property?.name || 'Bonaasina', roomCode: room?.code || '-', since: t.startDate, until: card.validUntil, photoUrl: t.photoUrl, qrSvg: card.qrSvg, code: card.code, active: true })}
          <div class="panel-actions"><button class="btn btn--red btn--sm" id="cardPdf">Unduh kartu (PDF)</button><label class="btn btn--ghost btn--sm">${t.photoUrl ? 'Ganti foto' : 'Unggah foto wajah'}<input type="file" accept="image/*" id="photoIn" hidden></label></div>
          <p class="hint mt">${t.photoUrl ? 'Kartu bisa ditunjukkan dari HP atau dicetak.' : 'Unggah foto wajah yang jelas (seperti pas foto) supaya kartu lengkap.'} Orang lain dapat memindai QR untuk memastikan Anda penghuni aktif.</p>
        </section>
        <section class="panel"><h2>Data Anda</h2>
          <dl class="kv"><dt>Nama</dt><dd>${esc(t.name)}</dd><dt>Username</dt><dd>${esc(t.username)}</dd><dt>Kamar</dt><dd>${esc(room?.code || '-')}, ${esc(property?.name || '')}</dd><dt>Sewa</dt><dd>${rp(t.rentAmount)} per ${CW(t.rentCycle)}</dd><dt>Mulai</dt><dd>${tgl(t.startDate)}</dd><dt>Deposit</dt><dd>${rp(t.deposit)}</dd><dt>WhatsApp</dt><dd>${esc(t.phone || '-')}</dd><dt>Kontak darurat</dt><dd>${esc([t.emergencyName, t.emergencyPhone].filter(Boolean).join(', ') || '-')}</dd></dl>
          <p class="hint mt">Ada data yang salah? Hubungi pengelola untuk memperbaikinya.</p>
          <form class="fields mt" id="emailForm" novalidate>
            <label>Email notifikasi <span class="hint">tagihan, pembayaran, kontrak, pengumuman, laporan kerusakan</span><input type="email" name="email" inputmode="email" autocomplete="email" value="${esc(t.email || '')}" placeholder="nama@gmail.com"></label>
            <div><button class="btn btn--ghost btn--sm" type="submit">Simpan email</button></div>
          </form>
        </section>
        <section class="panel"><h2>Ganti kata sandi</h2>
          <form class="fields" id="pwForm" novalidate>
            <label>Kata sandi sekarang<input type="password" name="oldPassword" autocomplete="current-password" required></label>
            <label>Kata sandi baru<input type="password" name="newPassword" autocomplete="new-password" minlength="8" required><span class="hint">Minimal 8 karakter.</span></label>
            <label>Ulangi kata sandi baru<input type="password" name="newPassword2" autocomplete="new-password" required></label>
            <p class="err" id="pwErr" role="alert" hidden></p>
            <div><button class="btn btn--red" type="submit">Simpan kata sandi</button></div>
          </form></section>
      </div>`;
    $('#cardPdf').onclick = () => download('/card.pdf', `kartu-penghuni-${safeName(t.name)}.pdf`);
    $('#photoIn').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { await BonaLoader.during('Mengunggah foto…', async () => api('POST', '/photo', undefined, await shrink(f, 900, true))); toast('Foto kartu diperbarui.'); await refresh(); }
      catch (ex) { toast(ex.message, true); }
    });
    $('#emailForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const out = await BonaLoader.during('Menyimpan…', () => api('PUT', '/email', Object.fromEntries(new FormData(e.target)))); t.email = out.email; toast(out.email ? 'Email tersimpan. Cek kotak masuk Anda.' : 'Email dihapus.'); }
      catch (ex) { toast(ex.message, true); }
    });
    $('#pwForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); const err = $('#pwErr');
      if (d.newPassword !== d.newPassword2) { err.textContent = 'Kedua kata sandi baru belum sama.'; err.hidden = false; return; }
      try { await BonaLoader.during('Menyimpan…', () => api('POST', '/password', d)); e.target.reset(); err.hidden = true; toast('Kata sandi diganti. Perangkat lain otomatis keluar.'); }
      catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
  }
  const fmtCode = (c) => (c ? `${c.slice(0, 4)}-${c.slice(4, 8)}`.toUpperCase() : '-');
  function idCardHtml(c) {
    return `<div class="idcard ${c.active ? '' : 'is-off'}" role="img" aria-label="Kartu penghuni ${esc(c.name)}">
      <div class="idcard__top"><img src="/assets/img/mark.webp" alt=""><div><strong>BONAASINA</strong><small>KARTU PENGHUNI</small></div><em>${esc(c.propertyName)}</em></div>
      <div class="idcard__body"><div class="idcard__photo">${c.photoUrl ? `<img src="${esc(c.photoUrl)}" alt="">` : 'FOTO'}</div>
        <div><div class="idcard__name">${esc(c.name)}</div><div class="idcard__f">Kamar</div><div class="idcard__v">${esc(c.roomCode)}</div>
          <div class="idcard__f">Penghuni sejak</div><div class="idcard__v">${tgl(c.since)}</div>${c.until ? `<div class="idcard__f">Kontrak s.d.</div><div class="idcard__v">${tgl(c.until)}</div>` : ''}</div>
        <div class="idcard__qr">${c.qrSvg || ''}<span>No. ${fmtCode(c.code)}</span></div></div></div>`;
  }

  // ---------- mulai ----------
  if (getSession()?.token) start(); else showLogin();
})();
