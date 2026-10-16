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
  let cache = { properties: [], settings: null };

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
  async function api(method, path, body, raw) {
    // Perpanjang sesi sebelum habis (token login berlaku sekitar 1 jam).
    const s = getSession();
    if (s?.expiresAt && s.expiresAt * 1000 < Date.now() + 60000 && !PUBLIC_PATHS.includes(path)) await refreshSession();
    let res;
    try { res = await rawFetch(method, path, body, raw); }
    catch { throw new Error('Tidak bisa terhubung ke server. Periksa koneksi internet lalu coba lagi.'); }
    if (res.status === 401 && !PUBLIC_PATHS.includes(path) && (await refreshSession())) res = await rawFetch(method, path, body, raw);
    if (res.status === 401 && !PUBLIC_PATHS.includes(path)) { setSession(null); showLogin(); throw new Error('Silakan masuk dulu.'); }
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : res.headers.get('content-type')?.includes('csv') ? await res.blob() : await res.text();
    if (!res.ok) throw new Error(data.error || 'Terjadi kesalahan.');
    return data;
  }
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
  function openDialog({ title, body, ok = 'Simpan', okClass = 'btn--red', onOk, onOpen }) {
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
      dlg.close();
    } catch (ex) { if (!ex.keepOpen) { $('#dlgErr').textContent = ex.message; $('#dlgErr').hidden = false; } }
    finally { btn.disabled = false; }
  });
  dlg.addEventListener('close', () => { if (dlg.dataset.refresh) { delete dlg.dataset.refresh; route(); } });
  const normPhone = (p) => { let x = String(p || '').replace(/[^0-9+]/g, ''); if (x.startsWith('+')) x = x.slice(1); if (x.startsWith('0')) x = '62' + x.slice(1); if (x.startsWith('8')) x = '62' + x; return x; };

  // Konfirmasi di dalam halaman (dialog bawaan browser tidak selalu tersedia).
  function askConfirm(title, text, ok = 'Ya, lanjutkan') {
    return new Promise((resolve) => {
      let done = false;
      openDialog({ title, ok, body: `<p>${esc(text)}</p>`, onOk: async () => { done = true; resolve(true); } });
      dlg.addEventListener('close', () => { if (!done) resolve(false); }, { once: true });
    });
  }
  // Tampilkan teks (CSV/cadangan) untuk disalin, dipakai bila unduhan tidak tersedia.
  function showTextDialog(title, note, text) {
    openDialog({
      title, body: `<p class="muted">${esc(note)}</p><textarea id="txtOut" rows="12" readonly style="font-size:12px;margin-top:10px">${esc(text)}</textarea>
        <div style="margin-top:10px"><button type="button" class="btn btn--ghost btn--sm" id="txtCopy">Salin semua</button></div>`,
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
    try {
      setSession(await api('POST', '/login', { email: e.target.email.value, password: e.target.password.value }));
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
  $('#logout').addEventListener('click', () => { setSession(null); showLogin(); });

  async function start() {
    $('#login').hidden = true; $('#app').hidden = false;
    [cache.properties, cache.settings] = await Promise.all([api('GET', '/properties'), api('GET', '/settings')]);
    route();
  }

  // ---------- router ----------
  const views = { ringkasan, tagihan, penghuni, kamar, survei, kerusakan, laporan, pengaturan };
  async function route() {
    const name = (location.hash.slice(1) || 'ringkasan').split('?')[0];
    const view = views[name] || ringkasan;
    $$('#sideNav a').forEach((a) => { if (a.dataset.view === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    main.onclick = null; main.onchange = null;
    main.classList.remove('is-in'); void main.offsetWidth; main.classList.add('is-in');
    try { await view(); } catch (ex) { if (ex.message !== 'Silakan masuk dulu.') main.innerHTML = `<div class="empty">${esc(ex.message)}</div>`; }
    refreshBadges();
  }
  addEventListener('hashchange', route);
  async function refreshBadges() {
    try {
      const s = await api('GET', '/summary');
      const b1 = $('#badgeTagihan'); b1.textContent = s.overdue; b1.hidden = !s.overdue;
      const b2 = $('#badgeSurvei'); b2.textContent = s.newSurveys; b2.hidden = !s.newSurveys;
      const b3 = $('#badgeKerusakan'); b3.textContent = s.openIssues; b3.hidden = !s.openIssues;
      const n1 = s.overdue + s.proofsPending; b1.textContent = n1; b1.hidden = !n1;
    } catch { /* abaikan */ }
  }
  const propName = (id) => cache.properties.find((p) => p.id === id)?.name || '-';
  const head = (title, sub, actions = '') => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="actions">${actions}</div></div>`;

  // ========== RINGKASAN ==========
  async function ringkasan() {
    const [s, inv] = await Promise.all([api('GET', '/summary'), api('GET', '/invoices')]);
    const overdue = inv.filter((i) => i.status === 'belum' && i.overdue).slice(0, 6);
    const soon = inv.filter((i) => i.status === 'belum' && !i.overdue).slice(0, 6);
    const proofs = inv.filter((i) => i.status === 'belum' && i.proofStatus === 'menunggu');
    const sample = s.isSample ? `<div class="notice"><p><strong>Kamar, harga, deskripsi, nomor WhatsApp, dan rekening masih contoh.</strong> Perbarui di menu Kamar & kos dan Pengaturan sebelum website dibagikan ke calon penyewa.</p><button class="btn btn--sm" id="clearSample">Sudah saya perbarui</button></div>` : '';
    const occ = s.perProperty.map((p) => {
      const pct = (n) => (p.total ? (n / p.total) * 100 : 0);
      return `<div class="occ__row"><div class="occ__top"><strong>${esc(p.name)}</strong><span>${p.terisi} dari ${p.total} terisi</span></div>
        <div class="occ__bar" role="img" aria-label="${p.terisi} terisi, ${p.kosong} kosong, ${p.dipesan} dipesan, ${p.perbaikan} perbaikan">
          <span class="c-terisi" style="width:${pct(p.terisi)}%"></span><span class="c-dipesan" style="width:${pct(p.dipesan)}%"></span><span class="c-kosong" style="width:${pct(p.kosong)}%"></span><span class="c-perbaikan" style="width:${pct(p.perbaikan)}%"></span>
        </div></div>`;
    }).join('');
    const invRows = (list, emptyText) => list.length ? `<table><tbody>${list.map((i) => `<tr>
        <td data-label="Penghuni"><strong>${esc(i.tenantName)}</strong><span class="sub">${esc(i.roomCode)}, ${esc(i.periodLabel)}</span></td>
        <td data-label="Jatuh tempo" class="nowrap">${tgl(i.dueDate)}${i.overdue ? `<span class="sub" style="color:var(--red)">lewat ${i.overdueDays} hari</span>` : ''}</td>
        <td class="num" data-label="Jumlah">${rp(i.amount)}</td>
        <td class="actions"><button class="btn btn--green btn--sm" data-remind="${i.id}">Kirim pengingat WA</button><button class="btn btn--ghost btn--sm" data-pay="${i.id}">Tandai lunas</button></td></tr>`).join('')}</tbody></table>` : `<div class="empty">${emptyText}</div>`;
    main.innerHTML = head('Ringkasan', `Hari ini ${tgl(s.today)}.${s.newInvoices ? ` ${s.newInvoices} tagihan baru dibuat otomatis.` : ''}`,
      '<a class="btn btn--ghost" href="/" target="_blank" rel="noopener">Lihat website</a>') + sample + `
      <div class="grid grid--stats">
        <div class="panel stat ${s.overdue ? 'stat--alert' : ''}"><p class="stat__label">Tunggakan</p><p class="stat__value">${rp(s.overdueAmount)}</p><p class="stat__sub">${s.overdue} tagihan lewat jatuh tempo</p></div>
        <div class="panel stat"><p class="stat__label">Jatuh tempo ${cache.settings?.invoiceLeadDays ?? 7} hari ke depan</p><p class="stat__value">${rp(s.dueSoonAmount)}</p><p class="stat__sub">${s.dueSoon} tagihan</p></div>
        <div class="panel stat"><p class="stat__label">Uang masuk bulan ini</p><p class="stat__value">${rp(s.incomeThisMonth)}</p><p class="stat__sub">Pengeluaran ${rp(s.expensesThisMonth)}</p></div>
        <div class="panel stat ${s.proofsPending ? 'stat--alert' : ''}"><p class="stat__label">Perlu dicek</p><p class="stat__value">${s.proofsPending + s.openIssues + s.newSurveys}</p><p class="stat__sub"><a href="#tagihan">${s.proofsPending} bukti bayar</a>, <a href="#kerusakan">${s.openIssues} kerusakan</a>, <a href="#survei">${s.newSurveys} survei</a></p></div>
      </div>
      ${proofs.length ? `<div class="panel" style="margin-top:14px"><h2>Bukti bayar menunggu dicek</h2><table><tbody>${proofs.map((i) => `<tr>
        <td data-label="Penghuni"><strong>${esc(i.tenantName)}</strong><span class="sub">${esc(i.roomCode)}, ${esc(i.periodLabel)}</span></td>
        <td data-label="Dikirim" class="nowrap">${tgl(i.proofUploadedAt)}</td>
        <td class="num" data-label="Jumlah">${rp(i.amount)}</td>
        <td class="actions"><button class="btn btn--red btn--sm" data-proof="${i.id}">Cek bukti</button></td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="grid grid--2" style="margin-top:14px">
        <div class="panel"><h2>Hunian kamar</h2><div class="occ">${occ}</div>
          <div class="legend"><span><i class="c-terisi"></i>Terisi</span><span><i class="c-dipesan"></i>Dipesan</span><span><i class="c-kosong"></i>Kosong</span><span><i class="c-perbaikan"></i>Perbaikan</span></div></div>
        <div class="panel"><h2>Perlu ditagih sekarang <a class="small" href="#tagihan">Semua tagihan</a></h2>${invRows(overdue, 'Tidak ada tunggakan. Semua penghuni membayar tepat waktu.')}</div>
      </div>
      <div class="panel" style="margin-top:14px"><h2>Akan jatuh tempo</h2>${invRows(soon, 'Belum ada tagihan yang akan jatuh tempo dalam waktu dekat.')}</div>`;
    $('#clearSample')?.addEventListener('click', async () => {
      if (!(await askConfirm('Data sudah diperbarui?', 'Pengingat ini akan disembunyikan. Pastikan harga, nomor WhatsApp, dan rekening sudah benar.', 'Ya, sembunyikan'))) return;
      cache.settings = await api('PUT', '/settings', { isSample: false }); toast('Pengingat disembunyikan.'); route();
    });
    bindInvoiceActions(inv);
  }

  // ---------- aksi tagihan (dipakai di beberapa halaman) ----------
  function bindInvoiceActions(list) {
    main.onclick = async (e) => {
      const r = e.target.closest('[data-remind]'), p = e.target.closest('[data-pay]'), u = e.target.closest('[data-unpay]'), x = e.target.closest('[data-del-inv]'), pf = e.target.closest('[data-proof]');
      if (pf) {
        const inv = list.find((i) => i.id === pf.dataset.proof);
        try {
          const { url } = await api('GET', `/file?path=${encodeURIComponent(inv.proofPath)}`);
          openDialog({
            title: 'Cek bukti bayar', ok: 'Terima & tandai lunas', okClass: 'btn--green',
            body: `<p class="muted">${esc(inv.tenantName)}, kamar ${esc(inv.roomCode)}, ${esc(inv.periodLabel)}. Tagihan <strong>${rp(inv.amount)}</strong>. Dikirim ${tgl(inv.proofUploadedAt)}.</p>
              <a href="${esc(url)}" target="_blank" rel="noopener" class="proof-img"><img src="${esc(url)}" alt="Bukti bayar ${esc(inv.tenantName)}"></a>
              <p class="hint">Cocokkan nominal dan nama pengirim dengan mutasi rekening sebelum menerima.</p>
              <div class="fields fields--2" style="margin-top:12px">
                <label>Tanggal uang masuk<input type="date" name="paidAt" value="${today()}" max="${today()}"></label>
                <label>Jumlah diterima<input type="number" name="paidAmount" value="${inv.amount}" min="0" step="1000"></label>
                <label>Cara bayar<select name="method"><option value="transfer">Transfer bank</option><option value="qris">QRIS</option><option value="lainnya">Lainnya</option></select></label>
              </div>
              <details class="reject"><summary>Tolak bukti ini</summary>
                <label style="margin-top:10px">Alasan (dikirim ke portal penghuni)<input id="rejectNote" placeholder="Contoh: nominal kurang Rp50.000"></label>
                <button type="button" class="btn btn--ghost btn--sm" id="rejectBtn" style="margin-top:10px">Tolak bukti</button></details>`,
            onOpen: (b) => {
              $('#rejectBtn', b).onclick = async () => {
                try { await api('POST', `/invoices/${inv.id}/reject-proof`, { note: $('#rejectNote', b).value }); dlg.close(); toast('Bukti ditolak. Penghuni akan melihat alasannya di portal.'); route(); }
                catch (ex) { $('#dlgErr').textContent = ex.message; $('#dlgErr').hidden = false; }
              };
            },
            onOk: async (d) => { await api('POST', `/invoices/${inv.id}/pay`, d); toast(`Bukti diterima. Tagihan ${inv.tenantName} lunas.`); route(); },
          });
        } catch (ex) { toast(ex.message, true); }
      }
      if (r) {
        // Tampilkan pesan dulu supaya pemilik bisa memeriksa, lalu buka WhatsApp lewat tautan biasa.
        try {
          const out = await api('GET', `/invoices/${r.dataset.remind}/reminder?site=${encodeURIComponent(location.origin)}`);
          openDialog({
            title: 'Pengingat WhatsApp',
            body: `<p class="muted">Periksa pesannya, lalu tekan Buka WhatsApp dan kirim dari sana.</p>
              <div class="preview" id="remText">${esc(out.text)}</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
                <a class="btn btn--green" href="${esc(out.url)}" target="_blank" rel="noopener">Buka WhatsApp</a>
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
            <div class="fields fields--2" style="margin-top:14px">
              <label>Tanggal bayar<input type="date" name="paidAt" value="${today()}" max="${today()}"></label>
              <label>Jumlah dibayar<input type="number" name="paidAmount" value="${inv.amount}" min="0" step="1000"></label>
              <label>Cara bayar<select name="method"><option value="transfer">Transfer bank</option><option value="qris">QRIS</option><option value="tunai">Tunai</option><option value="lainnya">Lainnya</option></select></label>
              <label>Catatan <span class="hint">opsional</span><input name="note" value="${esc(inv.note || '')}"></label>
            </div>`,
          onOk: async (d) => { await api('POST', `/invoices/${inv.id}/pay`, d); toast(`Tagihan ${inv.tenantName} ditandai lunas.`); route(); },
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
    const [inv, tenants] = await Promise.all([api('GET', '/invoices'), api('GET', '/tenants')]);
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
        <td data-label="Penghuni"><strong>${esc(i.tenantName)}</strong><span class="sub">Kamar ${esc(i.roomCode)}, ${esc(propName(i.propertyId))}</span></td>
        <td data-label="Periode">${esc(i.periodLabel)}${i.cycle === 'tahunan' ? '<span class="sub">Sewa tahunan</span>' : ''}</td>
        <td data-label="Jatuh tempo">${tgl(i.dueDate)}${i.overdue ? `<span class="sub" style="color:var(--red)">lewat ${i.overdueDays} hari</span>` : ''}${i.lastRemindedAt ? `<span class="sub">Diingatkan ${tgl(i.lastRemindedAt)}</span>` : ''}</td>
        <td class="num" data-label="Jumlah">${rp(i.amount)}${i.status === 'lunas' && i.paidAmount !== i.amount ? `<span class="sub">dibayar ${rp(i.paidAmount)}</span>` : ''}</td>
        <td data-label="Status">${i.status === 'lunas' ? `<span class="pill pill--lunas">Lunas ${tgl(i.paidAt)}</span>` : i.proofStatus === 'menunggu' ? '<span class="pill pill--dikonfirmasi">Bukti dikirim</span>' : i.overdue ? '<span class="pill pill--terlambat">Terlambat</span>' : '<span class="pill pill--belum">Belum bayar</span>'}${i.proofStatus === 'ditolak' && i.status === 'belum' ? `<span class="sub">Bukti ditolak: ${esc(i.proofNote)}</span>` : ''}</td>
        <td class="actions">${i.status === 'belum'
          ? (i.proofStatus === 'menunggu' ? `<button class="btn btn--red btn--sm" data-proof="${i.id}">Cek bukti</button>` : `<button class="btn btn--green btn--sm" data-remind="${i.id}">Kirim pengingat WA</button>`) + `<button class="btn btn--ghost btn--sm" data-pay="${i.id}">Tandai lunas</button>`
          : `<button class="btn btn--ghost btn--sm" data-unpay="${i.id}">Batalkan lunas</button>`}</td></tr>`).join('')}</tbody></table>`
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
          <div class="fields fields--2" style="margin-top:14px">
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
    const [tenants, rooms] = await Promise.all([api('GET', '/tenants'), api('GET', '/rooms')]);
    const draw = () => {
      const list = tenants.filter((t) => tenantFilter === 'semua' || t.status === tenantFilter);
      $('#tnTable').innerHTML = list.length ? `<table><thead><tr><th>Nama</th><th>Kamar</th><th>Sewa</th><th>Mulai</th><th>Tagihan</th><th></th></tr></thead><tbody>${list.map((t) => `<tr>
        <td data-label="Nama"><strong>${esc(t.name)}</strong><span class="sub">${esc(t.phone || 'Belum ada nomor WA')}${t.occupation ? `, ${esc(t.occupation)}` : ''}</span></td>
        <td data-label="Kamar">${esc(t.room?.code || '-')}<span class="sub">${esc(propName(t.room?.propertyId))}</span></td>
        <td data-label="Sewa">${rp(t.rentAmount)}<span class="sub">per ${t.rentCycle === 'tahunan' ? 'tahun' : 'bulan'}</span></td>
        <td data-label="Mulai">${tgl(t.startDate)}${t.endDate ? `<span class="sub">${t.status === 'keluar' ? 'Keluar' : 'Sampai'} ${tgl(t.endDate)}</span>` : ''}</td>
        <td data-label="Tagihan">${t.status !== 'aktif' ? `<span class="pill pill--keluar">Sudah keluar</span>` : t.unpaidCount ? `<span class="pill ${t.overdue ? 'pill--terlambat' : 'pill--belum'}">${t.unpaidCount} belum bayar, ${rp(t.unpaidAmount)}</span>` : '<span class="pill pill--lunas">Lunas semua</span>'}</td>
        <td class="actions">${t.status === 'aktif' ? `<button class="btn btn--${t.hasPortal ? 'ghost' : 'green'} btn--sm" data-portal="${t.id}">${t.hasPortal ? 'Link portal' : 'Kirim link portal'}</button>` : ''}<button class="btn btn--ghost btn--sm" data-edit="${t.id}">Ubah</button>${t.status === 'aktif' ? `<button class="btn btn--ghost btn--sm" data-out="${t.id}">Keluar</button>` : ''}</td></tr>`).join('')}</tbody></table>`
        : `<div class="empty">${tenantFilter === 'aktif' ? 'Belum ada penghuni aktif.' : 'Tidak ada data.'}<br><button class="btn btn--red" data-add>Tambah penghuni</button></div>`;
    };
    main.innerHTML = head('Penghuni', `${tenants.filter((t) => t.status === 'aktif').length} penghuni aktif.`, '<button class="btn btn--red" data-add>Tambah penghuni</button>') + `
      <div class="toolbar"><div class="seg" id="tnSeg">${[['aktif', 'Aktif'], ['keluar', 'Sudah keluar'], ['semua', 'Semua']].map(([k, l]) => `<button aria-pressed="${tenantFilter === k}" data-k="${k}">${l}</button>`).join('')}</div></div>
      <div class="table-wrap" id="tnTable"></div>`;
    draw();
    $('#tnSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; tenantFilter = b.dataset.k; $$('#tnSeg button').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(); };

    main.onclick = (e) => {
      if (e.target.closest('[data-add]')) tenantDialog(null, rooms);
      const ed = e.target.closest('[data-edit]'); if (ed) tenantDialog(tenants.find((t) => t.id === ed.dataset.edit), rooms);
      const pt = e.target.closest('[data-portal]');
      if (pt) {
        const t = tenants.find((x) => x.id === pt.dataset.portal);
        openDialog({
          title: `Portal ${t.name}`, ok: t.hasPortal ? 'Buat link baru' : 'Buat link portal',
          body: `<p>Lewat portal, penghuni bisa melihat tagihan, mengunggah bukti bayar, dan melaporkan kerusakan tanpa perlu akun atau kata sandi.</p>
            ${t.hasPortal ? '<p class="hint" style="margin-top:10px">Penghuni ini sudah punya link. Link tidak bisa ditampilkan ulang karena hanya disimpan dalam bentuk tersandi. Membuat link baru akan mematikan link lama.</p>' : ''}
            <div id="portalOut"></div>`,
          onOk: async (_d, body) => {
            const { token } = await api('POST', `/tenants/${t.id}/portal`);
            const link = `${location.origin}/portal/#${token}`;
            const msg = `Horas ${t.name}, ini link portal penghuni Bonaasina untuk Anda:\n${link}\n\nDi sana Anda bisa melihat tagihan, mengunggah bukti bayar, dan melaporkan kerusakan kamar. Simpan link ini dan jangan dibagikan ke orang lain.`;
            const wa = t.phone ? `https://wa.me/${normPhone(t.phone)}?text=${encodeURIComponent(msg)}` : null;
            t.hasPortal = true; dlg.dataset.refresh = '1';
            $('#portalOut', body).innerHTML = `<div class="preview" id="portalLink" style="word-break:break-all">${esc(link)}</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${wa ? `<a class="btn btn--green" href="${esc(wa)}" target="_blank" rel="noopener">Kirim lewat WhatsApp</a>` : '<span class="hint">Nomor WA penghuni belum diisi.</span>'}
              <button type="button" class="btn btn--ghost" id="portalCopy">Salin link</button></div>`;
            $('#portalCopy', body).onclick = () => copyText($('#portalLink', body));
            $('#dlgOk').hidden = true; $('.dlg__foot .btn--ghost').textContent = 'Selesai';
            throw Object.assign(new Error(''), { keepOpen: true });
          },
        });
        return;
      }
      const out = e.target.closest('[data-out]');
      if (out) {
        const t = tenants.find((x) => x.id === out.dataset.out);
        openDialog({
          title: `${t.name} keluar`, ok: 'Simpan', body: `<p class="muted">Kamar ${esc(t.room?.code)} akan menjadi kosong. Tagihan yang belum dibayar untuk periode setelah tanggal keluar akan dihapus; tunggakan sebelumnya tetap tercatat.</p>
            <label style="margin-top:14px">Tanggal keluar<input type="date" name="endDate" value="${today()}"></label>
            ${t.deposit ? `<p class="hint">Ingat: deposit ${rp(t.deposit)} perlu dikembalikan atau diperhitungkan.</p>` : ''}`,
          onOk: async (d) => { await api('POST', `/tenants/${t.id}/checkout`, d); toast(`${t.name} tercatat keluar.`); route(); },
        });
      }
    };
  }
  function tenantDialog(t, rooms) {
    const isNew = !t;
    const free = rooms.filter((r) => r.effectiveStatus !== 'terisi' || (t && r.id === t.roomId));
    const opts = cache.properties.map((p) => `<optgroup label="${esc(p.name)}">${free.filter((r) => r.propertyId === p.id).map((r) => `<option value="${r.id}" data-m="${r.priceMonthly}" data-y="${r.priceYearly}" ${t?.roomId === r.id ? 'selected' : ''}>${esc(r.code)}, ${esc(r.type)}${r.effectiveStatus !== 'kosong' && r.id !== t?.roomId ? ` (${STATUS_KAMAR[r.effectiveStatus]})` : ''}</option>`).join('')}</optgroup>`).join('');
    const v = (k) => esc(t?.[k] ?? '');
    openDialog({
      title: isNew ? 'Tambah penghuni' : `Ubah data ${t.name}`, ok: isNew ? 'Tambah penghuni' : 'Simpan perubahan',
      body: `<div class="fields fields--2">
          <p class="fieldset-title span-all">Data penghuni</p>
          <label>Nama lengkap<input name="name" value="${v('name')}" required></label>
          <label>Nomor WhatsApp<input name="phone" inputmode="tel" value="${v('phone')}" placeholder="0812…"></label>
          <label>Pekerjaan / kampus<input name="occupation" value="${v('occupation')}"></label>
          <label>Asal daerah<input name="origin" value="${v('origin')}"></label>
          <p class="fieldset-title span-all">Sewa</p>
          <label>Kamar<select name="roomId" id="tRoom">${opts}</select></label>
          <label>Jenis sewa<select name="rentCycle" id="tCycle"><option value="bulanan" ${t?.rentCycle !== 'tahunan' ? 'selected' : ''}>Bulanan</option><option value="tahunan" ${t?.rentCycle === 'tahunan' ? 'selected' : ''}>Tahunan</option></select></label>
          <label>Harga sewa<input type="number" name="rentAmount" id="tAmount" value="${t?.rentAmount ?? ''}" min="0" step="1000"><span class="hint">Terisi otomatis dari harga kamar, bisa diubah.</span></label>
          <label>Deposit<input type="number" name="deposit" value="${t?.deposit ?? ''}" min="0" step="1000"></label>
          <label>Tanggal mulai sewa<input type="date" name="startDate" value="${v('startDate') || today()}"><span class="hint">Jatuh tempo berikutnya mengikuti tanggal ini.</span></label>
          <label>Tagih mulai <span class="hint">opsional</span><input type="date" name="billFrom" value="${v('billFrom')}"><span class="hint">Isi jika penghuni lama: tagihan sebelum tanggal ini dianggap sudah beres.</span></label>
          <p class="fieldset-title span-all">Kontak darurat</p>
          <label>Nama<input name="emergencyName" value="${v('emergencyName')}"></label>
          <label>Nomor<input name="emergencyPhone" inputmode="tel" value="${v('emergencyPhone')}"></label>
          <label>Hubungan<input name="emergencyRelation" value="${v('emergencyRelation')}" placeholder="Orang tua, saudara…"></label>
          <label class="span-all">Catatan<textarea name="note" rows="2">${v('note')}</textarea></label>
          <p class="hint span-all">Foto KTP sengaja tidak disimpan di sistem ini. Cukup periksa KTP saat penghuni masuk, sesuai prinsip UU Pelindungan Data Pribadi.</p>
        </div>`,
      onOpen: (body) => {
        const fill = () => {
          const o = $('#tRoom', body).selectedOptions[0]; if (!o) return;
          if (isNew || !$('#tAmount', body).dataset.touched) $('#tAmount', body).value = $('#tCycle', body).value === 'tahunan' ? o.dataset.y : o.dataset.m;
        };
        $('#tAmount', body).addEventListener('input', (e) => { e.target.dataset.touched = 1; });
        if (!isNew) $('#tAmount', body).dataset.touched = 1;
        $('#tRoom', body).addEventListener('change', fill); $('#tCycle', body).addEventListener('change', () => { delete $('#tAmount', body).dataset.touched; fill(); });
        if (isNew) fill();
      },
      onOk: async (d) => {
        if (!d.billFrom) d.billFrom = '';
        if (isNew) { await api('POST', '/tenants', d); toast(`${d.name} ditambahkan. Tagihannya dibuat otomatis.`); }
        else { await api('PUT', `/tenants/${t.id}`, d); toast('Perubahan disimpan.'); }
        route();
      },
    });
  }

  // ========== KAMAR & KOS ==========
  async function kamar() {
    const [rooms, props] = await Promise.all([api('GET', '/rooms'), api('GET', '/properties')]);
    cache.properties = props;
    main.innerHTML = head('Kamar & kos', 'Ubah status, harga, foto, dan informasi yang tampil di website.', '<button class="btn btn--red" data-add-room>Tambah kamar</button>') +
      `<div class="prop-cards">${props.map((p) => `<div class="panel prop-card"><img src="${esc(p.logo)}" alt=""><div style="flex:1"><strong>${esc(p.name)}</strong><p class="small muted">${esc(p.gender ? 'Kos ' + p.gender.toLowerCase() + ', ' : '')}${(p.photos || []).length} foto, ${p.mapsQuery ? 'peta sudah diatur' : 'peta belum diatur'}</p></div><button class="btn btn--ghost btn--sm" data-edit-prop="${p.id}">Ubah info kos</button></div>`).join('')}</div>` +
      props.map((p) => {
        const list = rooms.filter((r) => r.propertyId === p.id);
        return `<div class="room-head"><h2>${esc(p.name)}</h2><span class="muted small">${list.filter((r) => r.effectiveStatus === 'kosong').length} kosong dari ${list.length} kamar</span></div>
        <div class="table-wrap">${list.length ? `<table><thead><tr><th>Kamar</th><th>Tipe</th><th class="num">Bulanan</th><th class="num">Tahunan</th><th>Status</th><th>Penghuni</th><th></th></tr></thead><tbody>${list.map((r) => `<tr>
          <td data-label="Kamar"><strong>${esc(r.code)}</strong>${r.hidden ? '<span class="sub">Disembunyikan dari website</span>' : ''}</td>
          <td data-label="Tipe">${esc(r.type)}<span class="sub">${[r.sizeM2, r.floor].filter(Boolean).map(esc).join(', ')}${(r.photos || []).length ? `, ${r.photos.length} foto` : ''}</span></td>
          <td class="num" data-label="Bulanan">${rp(r.priceMonthly)}</td>
          <td class="num" data-label="Tahunan">${rp(r.priceYearly)}</td>
          <td data-label="Status">${r.tenant ? '<span class="pill pill--terisi">Terisi</span>' : `<select class="inline" data-status="${r.id}" aria-label="Status kamar ${esc(r.code)}">${['kosong', 'dipesan', 'perbaikan', 'terisi'].map((s) => `<option value="${s}" ${r.status === s ? 'selected' : ''}>${STATUS_KAMAR[s]}</option>`).join('')}</select>`}</td>
          <td data-label="Penghuni">${r.tenant ? esc(r.tenant.name) : '<span class="muted">-</span>'}</td>
          <td class="actions"><button class="btn btn--ghost btn--sm" data-edit-room="${r.id}">Ubah</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Belum ada kamar.</div>'}</div>`;
      }).join('');

    main.onchange = async (e) => {
      const s = e.target.closest('[data-status]'); if (!s) return;
      try { await api('PUT', `/rooms/${s.dataset.status}`, { status: s.value }); toast('Status kamar diperbarui. Website ikut berubah.'); }
      catch (ex) { toast(ex.message, true); }
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

  function roomDialog(r) {
    const isNew = !r;
    openDialog({
      title: isNew ? 'Tambah kamar' : `Ubah kamar ${r.code}`, ok: isNew ? 'Tambah kamar' : 'Simpan perubahan',
      body: `<div class="fields fields--2">
        <label>Kos<select name="propertyId" ${isNew ? '' : 'disabled'}>${cache.properties.map((p) => `<option value="${p.id}" ${r?.propertyId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <label>Kode kamar<input name="code" value="${esc(r?.code || '')}" placeholder="A-09" required></label>
        <label>Tipe<input name="type" value="${esc(r?.type || '')}" placeholder="Kamar mandi dalam"></label>
        <label>Ukuran<input name="sizeM2" value="${esc(r?.sizeM2 || '')}" placeholder="3 × 4 m"></label>
        <label>Lantai<input name="floor" value="${esc(r?.floor || '')}" placeholder="Lantai 1"></label>
        <label>Status<select name="status">${['kosong', 'dipesan', 'perbaikan', 'terisi'].map((s) => `<option value="${s}" ${(r?.status || 'kosong') === s ? 'selected' : ''}>${STATUS_KAMAR[s]}</option>`).join('')}</select></label>
        <label>Harga bulanan<input type="number" name="priceMonthly" value="${r?.priceMonthly ?? ''}" min="0" step="1000"></label>
        <label>Harga tahunan<input type="number" name="priceYearly" value="${r?.priceYearly ?? ''}" min="0" step="1000"></label>
        <label class="span-all">Fasilitas kamar <span class="hint">satu per baris</span><textarea name="facilities" rows="3">${lines(r?.facilities)}</textarea></label>
        <label class="span-all">Keterangan singkat<input name="note" value="${esc(r?.note || '')}" placeholder="Listrik sudah termasuk"></label>
        ${photoField('photos', r?.photos || [])}
        <label class="span-all"><input type="checkbox" name="hidden" ${r?.hidden ? 'checked' : ''}>Sembunyikan kamar ini dari website</label>
      </div>`,
      onOpen: (b) => bindPhotos(b, 'photos'),
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
        <label>Aturan kos <span class="hint">satu per baris</span><textarea name="rules" rows="5">${lines(p.rules)}</textarea></label>
        <label class="span-all">Dekat dengan <span class="hint">satu per baris, misalnya "Pasar — 5 menit"</span><textarea name="nearby" rows="3">${lines(p.nearby)}</textarea></label>
        ${photoField('photos', p.photos || [])}
      </div>`,
      onOpen: (b) => bindPhotos(b, 'photos'),
      onOk: async (d) => { d.photos = JSON.parse(d.photos || '[]'); await api('PUT', `/properties/${p.id}`, d); cache.properties = await api('GET', '/properties'); toast('Info kos disimpan.'); route(); },
    });
  }

  // ========== SURVEI ==========
  async function survei() {
    const list = await api('GET', '/surveys');
    main.innerHTML = head('Survei', 'Permintaan survei dari website. Hubungi lewat WhatsApp, lalu ubah statusnya.') +
      `<div class="table-wrap">${list.length ? `<table><thead><tr><th>Calon penyewa</th><th>Kos & kamar</th><th>Jadwal</th><th>Catatan</th><th>Status</th><th></th></tr></thead><tbody>${list.map((s) => `<tr>
        <td data-label="Calon penyewa"><strong>${esc(s.name)}</strong><span class="sub">${esc(s.phone)}${s.occupation ? `, ${esc(s.occupation)}` : ''}</span></td>
        <td data-label="Kos & kamar">${esc(s.propertyName)}<span class="sub">${s.roomCode ? `Kamar ${esc(s.roomCode)}` : 'Kamar belum dipilih'}, sewa ${esc(s.duration)}</span></td>
        <td data-label="Jadwal">${tgl(s.date)}<span class="sub">${esc(s.time)}</span></td>
        <td data-label="Catatan" style="max-width:260px">${esc(s.note) || '<span class="muted">-</span>'}</td>
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
    const list = await api('GET', '/issues');
    const draw = () => {
      const rows = list.filter((i) => issueFilter === 'semua' || (issueFilter === 'terbuka' ? i.status !== 'selesai' : i.status === 'selesai'));
      $('#issTable').innerHTML = rows.length ? `<table><thead><tr><th>Laporan</th><th>Kamar</th><th>Dilaporkan</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((i) => `<tr>
        <td data-label="Laporan" style="max-width:340px"><strong>${esc(i.title)}</strong><span class="sub">${esc(i.category)}${i.description ? `: ${esc(i.description)}` : ''}</span>${i.ownerNote ? `<span class="sub">Catatan Anda: ${esc(i.ownerNote)}</span>` : ''}</td>
        <td data-label="Kamar">${esc(i.roomCode)}<span class="sub">${esc(i.propertyName)}, ${esc(i.tenantName)}</span></td>
        <td data-label="Dilaporkan" class="nowrap">${tgl(i.createdAt)}</td>
        <td data-label="Status"><span class="pill pill--${i.status === 'selesai' ? 'selesai' : i.status === 'baru' ? 'baru' : 'dikonfirmasi'}">${STATUS_ISSUE[i.status]}</span></td>
        <td class="actions">${i.photoPath ? `<button class="btn btn--ghost btn--sm" data-photo="${esc(i.photoPath)}">Lihat foto</button>` : ''}<button class="btn btn--ghost btn--sm" data-issue="${i.id}">Perbarui</button>${i.waUrl ? `<a class="btn btn--green btn--sm" href="${esc(i.waUrl)}" target="_blank" rel="noopener">Balas di WA</a>` : ''}</td></tr>`).join('')}</tbody></table>`
        : `<div class="empty">${issueFilter === 'terbuka' ? 'Tidak ada laporan kerusakan yang terbuka.' : 'Tidak ada laporan.'}</div>`;
    };
    main.innerHTML = head('Kerusakan', 'Laporan dari portal penghuni. Ubah statusnya supaya penghuni tahu perkembangannya.') + `
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
            <label>Catatan untuk penghuni <span class="hint">tampil di portal</span><textarea name="ownerNote" rows="3" placeholder="Contoh: tukang datang Sabtu pagi">${esc(i.ownerNote || '')}</textarea></label></div>`,
          onOk: async (d) => { await api('PUT', `/issues/${i.id}`, d); toast('Laporan diperbarui.'); route(); },
        });
      }
    };
  }

  // ========== LAPORAN ==========
  let repYear = String(new Date().getFullYear());
  async function laporan() {
    const [rep, exps] = await Promise.all([api('GET', `/reports?year=${repYear}`), api('GET', '/expenses')]);
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
      <div class="panel" style="margin-top:14px"><h2>Per bulan</h2>
        <div class="bars" role="img" aria-label="Grafik uang masuk dan pengeluaran per bulan">${rep.months.map((m, i) => `<div class="bars__col" title="${BULAN[i]}: masuk ${rp(m.income)}, keluar ${rp(m.expense)}"><div class="bars__pair"><span class="bars__in" style="height:${(m.income / max) * 100}%"></span><span class="bars__out" style="height:${(m.expense / max) * 100}%"></span></div><span class="bars__lbl">${BULAN[i]}</span></div>`).join('')}</div>
        <div class="legend"><span><i class="c-terisi"></i>Uang masuk</span><span><i class="c-perbaikan"></i>Pengeluaran</span></div>
      </div>
      <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Bulan</th>${rep.properties.map((p) => `<th class="num">${esc(p.name)}</th>`).join('')}<th class="num">Total masuk</th><th class="num">Pengeluaran</th><th class="num">Selisih</th></tr></thead><tbody>
        ${rep.months.map((m, i) => `<tr><td data-label="Bulan">${BULAN[i]} ${repYear}</td>${rep.properties.map((p) => `<td class="num" data-label="${esc(p.name)}">${rp(m.byProp[p.id]?.income)}</td>`).join('')}<td class="num" data-label="Total masuk"><strong>${rp(m.income)}</strong></td><td class="num" data-label="Pengeluaran">${rp(m.expense)}</td><td class="num" data-label="Selisih">${rp(m.net)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="room-head"><h2>Pengeluaran ${repYear}</h2></div>
      <div class="table-wrap">${yExp.length ? `<table><thead><tr><th>Tanggal</th><th>Kategori</th><th>Kos</th><th>Keterangan</th><th class="num">Jumlah</th><th></th></tr></thead><tbody>${yExp.map((e) => `<tr>
        <td data-label="Tanggal">${tgl(e.date)}</td><td data-label="Kategori">${esc(e.category)}</td><td data-label="Kos">${e.propertyId ? esc(propName(e.propertyId)) : 'Umum'}</td><td data-label="Keterangan">${esc(e.note) || '-'}</td><td class="num" data-label="Jumlah">${rp(e.amount)}</td>
        <td class="actions"><button class="btn btn--ghost btn--sm" data-del-exp="${e.id}">Hapus</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Belum ada pengeluaran tercatat tahun ini.</div>'}</div>
      <p class="small muted" style="margin-top:16px">Catatan pajak: penghasilan kos dikecualikan dari PPh final 10% sewa bangunan (PP 34/2017 Pasal 2 ayat 3), jadi diperlakukan sebagai penghasilan usaha. Pastikan skema yang berlaku untuk Anda ke KPP atau konsultan pajak.</p>`;
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

  // ========== PENGATURAN ==========
  async function pengaturan() {
    const s = await api('GET', '/settings'); cache.settings = s;
    const faq = s.faq || [];
    main.innerHTML = head('Pengaturan', 'Informasi umum website dan pesan pengingat.') + `
      <form class="grid" id="setForm" style="max-width:820px">
        <div class="panel fields fields--2">
          <p class="fieldset-title span-all">Kontak & pembayaran</p>
          <label>Nama pemilik / pengelola<input name="ownerName" value="${esc(s.ownerName)}"></label>
          <label>Nomor WhatsApp untuk website<input name="whatsapp" inputmode="tel" value="${esc(s.whatsapp)}"><span class="hint">Calon penyewa akan menghubungi nomor ini.</span></label>
          <label class="span-all">Info rekening / cara bayar <span class="hint">dimasukkan ke pesan pengingat</span><textarea name="paymentInfo" rows="2">${esc(s.paymentInfo)}</textarea></label>
          <label class="span-all">Metode pembayaran (tampil di website)<input name="paymentMethods" value="${esc(s.paymentMethods)}"></label>
          <label class="span-all">Aturan deposit (tampil di website)<input name="depositInfo" value="${esc(s.depositInfo)}"></label>
          <label>Jam survei<input name="surveyHours" value="${esc(s.surveyHours)}"></label>
          <label>Buat tagihan berapa hari sebelum jatuh tempo<input type="number" name="invoiceLeadDays" min="0" max="60" value="${esc(s.invoiceLeadDays ?? 7)}"></label>
        </div>
        <div class="panel fields">
          <p class="fieldset-title">Halaman depan</p>
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
        <div class="panel fields">
          <p class="fieldset-title">Tanya jawab di website</p>
          <div id="faqRows" class="fields">${faq.map(faqRow).join('')}</div>
          <div><button type="button" class="btn btn--ghost btn--sm" id="faqAdd">Tambah pertanyaan</button></div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn--red" type="submit">Simpan pengaturan</button><button type="button" class="btn btn--ghost" id="expBtn">Unduh cadangan data</button></div>
      </form>`;
    const preview = () => {
      $('#tplPreview').textContent = $('#tpl').value
        .replaceAll('{nama}', 'Rina').replaceAll('{kos}', 'Kos Asina').replaceAll('{kamar}', 'A-01').replaceAll('{periode}', 'Oktober 2026')
        .replaceAll('{jumlah}', 'Rp550.000').replaceAll('{jatuh_tempo}', '18 Oktober 2026').replaceAll('{keterlambatan}', ' Saat ini sudah lewat 3 hari.')
        .replaceAll('{rekening}', $('[name=paymentInfo]').value || '-');
    };
    preview(); $('#tpl').oninput = preview; $('[name=paymentInfo]').addEventListener('input', preview);
    $('#tplReset').onclick = () => { $('#tpl').value = s.defaultReminderTemplate; preview(); };
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

  // ---------- mulai ----------
  fetch('/api/admin/me').then((r) => (r.ok ? start() : showLogin())).catch(showLogin);
})();
