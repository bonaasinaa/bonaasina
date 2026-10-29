/* Dashboard customer Bonaasina: status reservasi, pembayaran DP, chat dengan pemilik, refund, bukti booking. */
(() => {
  const M = window.BonaMarket;
  const { esc, rp, tgl, waktu, sisa } = M;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const main = $('#main');
  const API = (window.BONA_CONFIG?.apiBase || '/api').replace(/\/$/, '');
  const KEY = M.KEYS.customer;
  const getSession = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
  const setSession = (s) => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* abaikan */ } };
  let data = null; let chatBox = null; let tab = 'status'; let lastJson = '';

  // Kegagalan yang tidak ditangani tetap diberitahukan ke pengguna (dulu beberapa tombol gagal tanpa pesan).
  window.addEventListener('unhandledrejection', (e) => {
    e.preventDefault();
    console.error(e.reason);
    toast(e.reason?.message || 'Terjadi kesalahan. Coba lagi.', true);
  });
  async function api(method, path, body, raw) {
    const opt = { method, headers: {} };
    const s = getSession(); if (s?.token) opt.headers['X-Lead-Session'] = s.token;
    if (raw) { opt.body = raw; opt.headers['Content-Type'] = raw.type; }
    else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
    let res;
    try { res = await fetch(API + '/akun' + path, opt); }
    catch { throw new Error('Tidak bisa terhubung. Periksa sinyal atau koneksi internet, lalu coba lagi.'); }
    const ct = res.headers.get('content-type') || '';
    const out = ct.includes('json') ? await res.json().catch(() => ({})) : ct.includes('pdf') ? await res.blob() : await res.text();
    if (res.status === 401) { setSession(null); showLogin('Sesi Anda berakhir. Silakan masuk lagi.'); throw new Error('Silakan masuk dulu.'); }
    if (res.status === 403 && /kata sandi bawaan/.test(out.error || '')) { showChange(); throw new Error(out.error); }
    if (!res.ok) throw new Error(out.error || 'Terjadi kesalahan. Coba lagi.');
    return out;
  }
  let toastTimer;
  function toast(msg, isError) {
    const t = $('#toast'); t.textContent = msg; t.classList.toggle('is-error', !!isError); t.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('is-on'), 3800);
  }
  M.onError = (ex) => toast(ex.message, true);
  function shrink(file, max = 1600) {
    return new Promise((resolve) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob((b) => resolve(b || file), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }
  function saveBlob(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // Dialog
  const dlg = $('#dlg'); let dlgHandler = null;
  function openDialog({ title, body, ok = 'Simpan', okClass = 'btn--red', onOk, onOpen }) {
    $('#dlgTitle').textContent = title; $('#dlgBody').innerHTML = body;
    $('#dlgOk').textContent = ok; $('#dlgOk').className = `btn ${okClass}`; $('#dlgOk').hidden = !onOk;
    $('.dlg__foot .btn--ghost').textContent = onOk ? 'Batal' : 'Tutup';
    $('#dlgErr').hidden = true; dlgHandler = onOk; dlg.showModal(); onOpen?.($('#dlgBody'));
  }
  $('#dlgForm').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'ok' || !dlgHandler) return;
    e.preventDefault(); const btn = $('#dlgOk'); btn.disabled = true;
    try { await dlgHandler(Object.fromEntries(new FormData($('#dlgForm'))), $('#dlgBody')); dlg.close(); }
    catch (ex) { $('#dlgErr').textContent = ex.message; $('#dlgErr').hidden = false; }
    finally { btn.disabled = false; }
  });
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

  // Masuk
  const params = new URLSearchParams(location.search);
  function showLogin(msg) {
    BonaLoader.reset(); chatBox?.stop();
    $('#app').hidden = true; $('#changePw').hidden = true; $('#login').hidden = false; if (dlg.open) dlg.close();
    if (params.get('u') && !$('#loginUser').value) $('#loginUser').value = params.get('u');
    if (msg) { $('#loginErr').textContent = msg; $('#loginErr').hidden = false; }
    ($('#loginUser').value ? $('#loginPass') : $('#loginUser')).focus();
  }
  function showChange() {
    BonaLoader.reset();
    $('#app').hidden = true; $('#login').hidden = true; $('#changePw').hidden = false;
    $('#pwUser').value = getSession()?.username || '';
    $('#pwNew').focus();
  }
  $$('[data-show]').forEach((b) => b.addEventListener('click', () => {
    const inp = $('#' + b.dataset.show); const on = inp.type === 'password'; inp.type = on ? 'text' : 'password';
    b.textContent = on ? 'Sembunyikan' : 'Lihat'; b.setAttribute('aria-pressed', on);
  }));
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = $('button[type=submit]', e.target); btn.disabled = true;
    try {
      const out = await M.login(e.target.username.value, e.target.password.value);
      if (out.kind !== 'customer') { location.href = out.home; return; }
      e.target.password.value = ''; $('#loginErr').hidden = true;
      if (out.mustChange) showChange(); else start();
    } catch (ex) { $('#loginErr').textContent = ex.message; $('#loginErr').hidden = false; }
    finally { btn.disabled = false; }
  });
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    if (f.newPassword.value !== f.newPassword2.value) { $('#pwErr').textContent = 'Kedua kata sandi belum sama.'; $('#pwErr').hidden = false; return; }
    const btn = $('button[type=submit]', f); btn.disabled = true;
    try {
      await api('POST', '/password', { newPassword: f.newPassword.value });
      const s = getSession(); if (s) { s.mustChange = false; setSession(s); }
      f.reset(); $('#pwErr').hidden = true; toast('Kata sandi baru tersimpan.'); start();
    } catch (ex) { $('#pwErr').textContent = ex.message; $('#pwErr').hidden = false; }
    finally { btn.disabled = false; }
  });
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-logout]')) return;
    try { await api('POST', '/logout'); } catch { /* tetap keluar */ }
    setSession(null); data = null; chatBox?.stop(); main.innerHTML = ''; showLogin();
  });

  // Data
  async function load() { data = await api('GET', '/me'); return data; }
  async function start() {
    $('#login').hidden = true; $('#changePw').hidden = true; $('#app').hidden = false;
    BonaLoader.show('Membuka reservasi Anda…', 0);
    try { await load(); lastJson = JSON.stringify(data.lead); render(); }
    catch (ex) { if (!/masuk dulu|bawaan/.test(ex.message)) main.innerHTML = `<div class="panel empty mt">${esc(ex.message)}<br><button class="btn btn--red" id="retry">Coba lagi</button></div>`; $('#retry')?.addEventListener('click', start); }
    finally { BonaLoader.hide(); }
  }
  async function refresh() { await BonaLoader.during('Memperbarui…', load); lastJson = JSON.stringify(data.lead); render(true); }
  // Status diperbarui otomatis tiap 30 detik (bila tidak sedang mengisi dialog).
  setInterval(async () => {
    if (!data || document.hidden || dlg.open || $('#app').hidden) return;
    try {
      const prev = lastJson; await load(); lastJson = JSON.stringify(data.lead);
      if (prev !== lastJson) { render(true); toast('Ada pembaruan pada reservasi Anda.'); } else bell();
    } catch { /* coba lagi nanti */ }
  }, 30000);

  function bell() {
    const n = data.notifications?.unread || 0;
    $('#bellBadge').textContent = n; $('#bellBadge').hidden = !n;
  }
  $('#bellBtn').addEventListener('click', async () => {
    const list = data?.notifications?.items || [];
    openDialog({ title: 'Notifikasi', body: M.notifs(list) });
    if (data?.notifications?.unread) { try { await api('POST', '/notifications/read', {}); data.notifications.unread = 0; list.forEach((n) => { n.readAt ||= new Date().toISOString(); }); bell(); } catch { /* abaikan */ } }
  });

  // Tampilan
  function nextCard(l) {
    const pay = l.payTo ? `<div class="bank">${esc(l.payTo)}</div>` : '<p class="hint">Rekening pemilik akan tampil di sini. Tanyakan lewat chat bila belum ada.</p>';
    switch (l.status) {
      case 'baru': return `<section class="next next--wait"><h2>Menunggu konfirmasi pemilik</h2>
        <p>Pemilik ${esc(l.propertyName)} sedang memastikan kamar tersedia untuk Anda. <strong>Anda belum perlu membayar apa pun.</strong> Setelah dikonfirmasi, nominal DP dan rekening tujuan muncul di sini, dan pemilik juga mengabari lewat WhatsApp.</p>
        <div class="btn-row"><button class="btn btn--ghost" data-visit>${l.visitStatus ? 'Ubah permintaan kunjungan' : 'Minta jadwal kunjungan'}</button><button class="btn btn--ghost" data-cancel>Batalkan reservasi</button></div></section>`;
      case 'menunggu_dp': return `<section class="next next--act"><h2>Kamar tersedia, bayar DP untuk mengunci</h2>
        ${l.dpRejectNote ? `<p class="err">Bukti sebelumnya belum diterima: ${esc(l.dpRejectNote)}</p>` : ''}
        <p>Transfer booking/DP langsung ke rekening pemilik kos:</p>
        <p class="big-amount">${rp(l.dpAmount)}</p>${pay}
        <p>Batas bayar: <strong>${waktu(l.dpDeadline)}</strong> <span class="countdown">(${sisa(l.dpDeadline)})</span>. Total sewa ${rp(l.priceTotal)}; sisa ${rp(l.remaining)} dibayar langsung ke pemilik sesuai kesepakatan.</p>
        ${l.ownerMessage ? `<p class="info-box">Pesan pemilik: ${esc(l.ownerMessage)}</p>` : ''}
        ${l.bookingPolicy ? `<p class="hint">Aturan booking: ${esc(l.bookingPolicy)}</p>` : ''}
        <div class="btn-row"><label class="btn btn--red">Unggah bukti transfer<input type="file" accept="image/*" id="dpFile" hidden></label><button class="btn btn--ghost" data-cancel>Batalkan</button></div>
        <p class="hint">Simpan struk/tangkapan layar transfer. Pemilik memeriksa mutasi rekening, lalu admin Bonaasina menerbitkan bukti booking resmi.</p></section>`;
      case 'dp_dikirim': return `<section class="next next--wait"><h2>Bukti DP terkirim</h2><p>Pemilik sedang mencocokkan transfer ${rp(l.dpAmount)} dengan mutasi rekeningnya. Anda akan diberi tahu di sini.</p>${l.dpProofUrl ? `<a class="proof-img" href="${esc(l.dpProofUrl)}" target="_blank" rel="noopener"><img src="${esc(l.dpProofUrl)}" alt="Bukti DP Anda"></a>` : ''}</section>`;
      case 'dp_diterima': return `<section class="next next--ok"><h2>DP diterima, kamar ditahan untuk Anda</h2><p>Pemilik sudah memastikan DP ${rp(l.dpAmount)} masuk. Admin Bonaasina sedang memeriksa transaksi lalu menerbitkan bukti booking resmi.</p></section>`;
      case 'berhasil': return `<section class="next next--ok"><h2>Booking berhasil 🎉</h2><p>Bukti booking <strong>${esc(l.invoiceNo)}</strong> sudah terbit. Tunjukkan saat datang. Sisa pembayaran <strong>${rp(l.remaining)}</strong> dibayar langsung ke pemilik.</p>
        <div class="btn-row"><button class="btn btn--red" data-pdf>Unduh bukti booking (PDF)</button>${l.visitStatus !== 'selesai' ? '<button class="btn btn--ghost" data-visit>Atur kunjungan / jam datang</button>' : ''}</div></section>`;
      case 'ditolak': return `<section class="next next--wait"><h2>Kamar belum bisa diterima</h2><p>${esc(l.rejectReason || 'Kamar tidak tersedia.')}</p><div class="btn-row"><a class="btn btn--red" href="/kos-sekitar/">Lihat kos lain di sekitar</a></div></section>`;
      case 'kedaluwarsa': return `<section class="next next--wait"><h2>Batas bayar DP sudah lewat</h2><p>Reservasi otomatis kedaluwarsa karena bukti DP belum dikirim. Bila masih berminat, kirim pesan ke pemilik, dan pemilik bisa menawarkan ulang.</p><div class="btn-row"><a class="btn btn--ghost" href="/kos/?k=${esc(l.propertySlug)}">Buka halaman kos</a></div></section>`;
      default: return `<section class="next"><h2>${esc(M.STATUS[l.status] || l.status)}</h2><p>${esc(l.cancelReason || '')}</p>${l.invoiceNo ? '<div class="btn-row"><button class="btn btn--ghost" data-pdf>Unduh bukti booking</button></div>' : ''}<div class="btn-row"><a class="btn btn--ghost" href="/kos-sekitar/">Cari kos lain</a></div></section>`;
    }
  }
  function refundCard(l) {
    const paid = ['dp_dikirim', 'dp_diterima', 'berhasil'].includes(l.status);
    if (!l.refundStatus) return paid ? `<details class="panel"><summary><strong>Perlu membatalkan setelah transfer DP?</strong></summary><p class="muted mt">Ajukan pengembalian DP. Pemilik memproses sesuai aturan booking kos${l.bookingPolicy ? `: “${esc(l.bookingPolicy)}”` : ''}. Bila ada masalah, admin Bonaasina membantu menengahi.</p><div class="btn-row mt"><button class="btn btn--ghost" data-refund>Minta refund DP</button></div></details>` : '';
    const t = {
      diminta: `<p>Permintaan refund sedang diproses pemilik.${l.cancelledBy === 'pemilik' ? ' Pemilik membatalkan booking dan akan mengembalikan DP Anda.' : ''}</p><p>Rekening tujuan: <strong>${esc(l.refundAccount || 'belum diisi')}</strong></p><div class="btn-row"><button class="btn btn--${l.refundAccount ? 'ghost' : 'red'}" data-refund-acc>${l.refundAccount ? 'Ubah rekening tujuan' : 'Isi rekening tujuan refund'}</button></div>`,
      ditolak: `<p>Pemilik menolak refund: ${esc(l.refundNote)}</p><div class="btn-row"><button class="btn btn--ghost" data-refund-report>Laporkan ke admin Bonaasina</button></div>`,
      dikirim: `<p>Pemilik sudah mentransfer refund <strong>${rp(l.refundAmount)}</strong>. Periksa rekening Anda.</p>${l.refundProofUrl ? `<a class="proof-img" href="${esc(l.refundProofUrl)}" target="_blank" rel="noopener"><img src="${esc(l.refundProofUrl)}" alt="Bukti refund"></a>` : ''}<div class="btn-row"><button class="btn btn--green" data-refund-ok>Sudah saya terima</button><button class="btn btn--ghost" data-refund-report>Belum diterima</button></div>`,
      dilaporkan: '<p>Laporan Anda sudah diterima admin Bonaasina. Admin akan menghubungi Anda dan pemilik.</p>',
      selesai: `<p>Refund ${rp(l.refundAmount)} selesai. Terima kasih.</p>`,
    }[l.refundStatus];
    return `<section class="next ${l.refundStatus === 'selesai' ? 'next--ok' : 'next--act'}"><h3>${esc(M.REFUND[l.refundStatus])}</h3>${t}</section>`;
  }
  function render(keep) {
    const l = data.lead; const y = keep ? scrollY : 0;
    document.title = `Reservasi ${l.propertyName} | Bonaasina`;
    bell();
    const wa = l.ownerWhatsapp ? `https://wa.me/${l.ownerWhatsapp}?text=${encodeURIComponent(`Horas, saya ${l.name} (reservasi #${l.code}, ${l.username}) di ${l.propertyName}. `)}` : null;
    const unread = data.unreadMessages ? `<span class="unread">${data.unreadMessages}</span>` : '';
    const html = `
      <div class="page-head mt"><div><h1>${esc(l.propertyName)}</h1><p>Reservasi #${esc(l.code)} atas nama ${esc(l.name)}. ${M.pill(l)}</p></div>
        <div class="actions">${wa ? `<a class="btn btn--green" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp pemilik</a>` : ''}<a class="btn btn--ghost" href="/kos/?k=${esc(l.propertySlug)}">Lihat kos</a></div></div>
      <div class="seg tabs-mini" role="tablist"><button aria-pressed="${tab === 'status'}" data-tab="status">Status</button><button aria-pressed="${tab === 'chat'}" data-tab="chat">Chat pemilik${unread}</button></div>
      <div class="cust__grid" data-tab="${tab}">
        <div class="cust__col cust__col--main">
          ${nextCard(l)}${refundCard(l)}
          <div class="panel"><h2>Perjalanan reservasi</h2>${M.timeline(l)}</div>
          <div class="panel"><h2>Detail</h2>${M.infoKv(l, 'customer')}</div>
          <div class="panel"><h2>Cara kerja reservasi</h2><ol class="guide">
            <li><div><strong>Kirim reservasi</strong><span>Gratis. Pilih kamar, lama sewa, dan tanggal masuk.</span></div></li>
            <li><div><strong>Pemilik konfirmasi</strong><span>Pemilik memastikan kamarnya ada, lalu mengabari jumlah DP lewat WhatsApp dan halaman ini.</span></div></li>
            <li><div><strong>Transfer DP &amp; unggah bukti</strong><span>Uang DP langsung ke rekening pemilik. Unggah buktinya di sini.</span></div></li>
            <li><div><strong>Bukti booking resmi</strong><span>Setelah pemilik menerima DP dan admin Bonaasina memeriksa, bukti booking terbit.</span></div></li></ol></div>
          <div class="panel"><h2>Akun</h2><p class="muted">Username <strong>${esc(l.username)}</strong>. Simpan untuk melihat status kapan saja di ${esc(location.host)}/akun.</p><p class="muted">Email notifikasi: <strong>${esc(l.email || 'belum diisi')}</strong></p><div class="btn-row mt"><button class="btn btn--ghost btn--sm" data-email>${l.email ? 'Ubah email' : 'Tambah email'}</button><button class="btn btn--ghost btn--sm" data-pw>Ganti kata sandi</button></div></div>
        </div>
        <div class="cust__col cust__col--chat"><div id="chatBox"></div>
          ${wa ? `<p class="hint">Lebih suka WhatsApp? <a href="${esc(wa)}" target="_blank" rel="noopener">Chat pemilik lewat WhatsApp</a>.</p>` : ''}</div>
      </div>`;
    main.innerHTML = html;
    chatBox?.stop();
    chatBox = M.chat($('#chatBox'), {
      title: `Chat dengan pemilik ${l.propertyName}`, me: 'customer', enabled: l.chatEnabled && !['batal', 'ditolak'].includes(l.status) || (l.chatEnabled && !!l.refundStatus),
      offText: l.chatEnabled ? 'Reservasi sudah ditutup. Gunakan WhatsApp bila perlu.' : 'Pemilik mematikan chat. Hubungi lewat WhatsApp.',
      who: { pemilik: 'Pemilik kos' },
      load: (after) => api('GET', `/messages?after=${after}`), send: (body) => api('POST', '/messages', { body }),
    });
    if (keep) scrollTo(0, y);
    bind(l);
  }
  function bind(l) {
    $$('.tabs-mini button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; $$('.tabs-mini button').forEach((x) => x.setAttribute('aria-pressed', x === b)); $('.cust__grid').dataset.tab = tab; if (tab === 'chat') { data.unreadMessages = 0; $('.tabs-mini .unread')?.remove(); } }));
    $('#dpFile')?.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { await BonaLoader.during('Mengunggah bukti transfer…', async () => api('POST', '/dp-proof', undefined, await shrink(f))); toast('Bukti terkirim. Pemilik akan memeriksa.'); window.bonaEvent?.('add_payment_info', { kos: l.propertyName }); refresh(); }
      catch (ex) { toast(ex.message, true); }
    });
    main.onclick = async (e) => {
      if (e.target.closest('[data-pdf]')) { try { await BonaLoader.during('Menyiapkan PDF…', async () => saveBlob(await api('GET', '/booking.pdf'), `bukti-booking-${l.code}.pdf`)); } catch (ex) { toast(ex.message, true); } }
      if (e.target.closest('[data-cancel]')) {
        openDialog({ title: 'Batalkan reservasi', ok: 'Batalkan reservasi', body: '<p class="muted">Karena belum ada pembayaran, reservasi langsung dibatalkan.</p><label class="mt">Alasan <span class="hint">opsional</span><textarea name="reason" rows="2"></textarea></label>', onOk: async (d) => { await api('POST', '/cancel', d); toast('Reservasi dibatalkan.'); refresh(); } });
      }
      if (e.target.closest('[data-visit]')) {
        const d0 = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
        openDialog({
          title: 'Jadwal kunjungan', ok: 'Kirim ke pemilik',
          body: `<p class="muted">Lihat kamar dan lingkungan dulu sebelum membayar. Pemilik akan mengonfirmasi jadwalnya.</p><div class="fields fields--2 mt">
            <label>Tanggal<input type="date" name="visitDate" min="${d0}" value="${esc(l.visitDate || d0)}" required></label>
            <label>Jam<select name="visitTime">${['09.00–11.00', '11.00–13.00', '13.00–15.00', '15.00–18.00'].map((t) => `<option ${l.visitTime === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
            <label class="span-all">Catatan <span class="hint">opsional</span><input name="visitNote"></label></div>`,
          onOk: async (d) => { await api('POST', '/visit', d); toast('Permintaan kunjungan terkirim.'); refresh(); },
        });
      }
      if (e.target.closest('[data-refund]')) openDialog({
        title: 'Minta pengembalian DP', ok: 'Kirim permintaan',
        body: `<p class="muted">Pemilik memproses sesuai aturan booking kos. Uang dikembalikan ke rekening yang Anda tulis.</p>${l.bookingPolicy ? `<p class="info-box mt">Aturan booking: ${esc(l.bookingPolicy)}</p>` : ''}
          <label class="mt">Alasan<textarea name="reason" rows="3" required></textarea></label>
          <label>Rekening tujuan refund<input name="account" required placeholder="Bank, nomor rekening, atas nama"></label>`,
        onOk: async (d) => { await api('POST', '/refund', d); toast('Permintaan refund terkirim ke pemilik.'); refresh(); },
      });
      if (e.target.closest('[data-refund-acc]')) openDialog({ title: 'Rekening tujuan refund', ok: 'Simpan', body: `<label>Bank, nomor rekening, atas nama<input name="account" value="${esc(l.refundAccount)}" required></label>`, onOk: async (d) => { await api('POST', '/refund', d); toast('Rekening tujuan dikirim ke pemilik.'); refresh(); } });
      if (e.target.closest('[data-refund-ok]')) { if (await askConfirm('Refund sudah diterima?', `Pastikan ${rp(l.refundAmount)} sudah masuk ke rekening Anda.`, 'Ya, sudah diterima')) { try { await api('POST', '/refund/confirm', { received: true }); toast('Terima kasih. Refund selesai.'); refresh(); } catch (ex) { toast(ex.message, true); } } }
      if (e.target.closest('[data-refund-report]')) openDialog({ title: 'Laporkan ke admin Bonaasina', ok: 'Kirim laporan', body: '<p class="muted">Admin akan menengahi antara Anda dan pemilik kos.</p><label class="mt">Ceritakan masalahnya<textarea name="note" rows="4" required></textarea></label>', onOk: async (d) => { await api('POST', '/refund/confirm', { received: false, note: d.note }); toast('Laporan terkirim ke admin.'); refresh(); } });
      if (e.target.closest('[data-email]')) openDialog({
        title: 'Email notifikasi', ok: 'Simpan',
        body: `<p class="muted">Kabar status reservasi, DP, bukti booking, dan refund juga dikirim ke email ini. Kosongkan untuk berhenti menerima email.</p><label class="mt">Email<input type="email" name="email" inputmode="email" autocomplete="email" value="${esc(l.email || '')}" placeholder="nama@gmail.com"></label>`,
        onOk: async (d) => { await api('PUT', '/email', d); toast(d.email ? 'Email tersimpan. Cek kotak masuk Anda.' : 'Email dihapus.'); refresh(); },
      });
      if (e.target.closest('[data-pw]')) openDialog({
        title: 'Ganti kata sandi', ok: 'Simpan',
        body: `<div class="fields"><input type="text" name="username" value="${esc(l.username)}" autocomplete="username" hidden><label>Kata sandi sekarang<input type="password" name="oldPassword" autocomplete="current-password" required></label><label>Kata sandi baru<input type="password" name="newPassword" autocomplete="new-password" minlength="8" required></label></div>`,
        onOk: async (d) => { await api('POST', '/password', d); toast('Kata sandi diganti.'); },
      });
    };
  }

  if (getSession()?.token) { if (getSession().mustChange) showChange(); else start(); } else showLogin();
})();
