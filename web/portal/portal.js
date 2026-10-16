/* Portal penghuni Bonaasina (Fase 2).
   Masuk lewat link pribadi /portal/#TOKEN yang dikirim pemilik. Token disimpan di perangkat ini
   lalu dihapus dari alamat supaya tidak ikut terbagi saat link halaman disalin. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const tgl = (s) => { if (!s) return '-'; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return `${d} ${BULAN[m - 1]} ${y}`; };
  const API = (window.BONA_CONFIG?.apiBase || '/api').replace(/\/$/, '') + '/portal';
  const KEY = 'bonaasina-portal-token';
  const app = $('#app');
  const CATS = ['Listrik', 'Air & kamar mandi', 'Pintu & kunci', 'Perabot', 'WiFi', 'Kebersihan', 'Lainnya'];

  // ---------- token ----------
  let token = '';
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (fromHash.length >= 20) {
    token = fromHash;
    try { localStorage.setItem(KEY, token); } catch { /* tetap jalan tanpa penyimpanan */ }
    history.replaceState(null, '', location.pathname);
  } else {
    try { token = localStorage.getItem(KEY) || ''; } catch { token = ''; }
  }

  async function api(method, path, body, raw) {
    const opt = { method, headers: { 'X-Portal-Token': token } };
    if (raw) { opt.body = raw; opt.headers['Content-Type'] = raw.type; }
    else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
    let res;
    try { res = await fetch(API + path, opt); }
    catch { throw new Error('Tidak bisa terhubung. Periksa sinyal atau koneksi internet, lalu coba lagi.'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { showInvalid(data.error); throw new Error(data.error || 'Link tidak berlaku.'); }
    if (!res.ok) throw new Error(data.error || 'Terjadi kesalahan. Coba lagi.');
    return data;
  }

  let toastTimer;
  function toast(msg, isError) {
    const t = $('#toast'); t.textContent = msg; t.classList.toggle('is-error', !!isError); t.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('is-on'), 3600);
  }

  function showInvalid(msg) {
    try { localStorage.removeItem(KEY); } catch { /* abaikan */ }
    app.innerHTML = `<section class="p-empty">
      <img src="/assets/img/mark.webp" alt="" width="140" height="95">
      <h1>Link portal tidak berlaku</h1>
      <p>${esc(msg || 'Link ini sudah diganti atau salah salin.')} Minta link baru ke pemilik kos lewat WhatsApp, lalu buka dari pesan itu.</p>
      <a class="btn btn--ink" href="/">Ke website Bonaasina</a>
    </section>`;
  }

  // ---------- muat ----------
  let data = null;
  async function load() {
    if (!token) return showInvalid('Halaman ini hanya bisa dibuka dari link pribadi yang dikirim pemilik.');
    try { data = await api('GET', '/me'); render(); }
    catch (e) { if (!$('.p-empty')) app.innerHTML = `<section class="p-empty"><h1>Belum bisa memuat</h1><p>${esc(e.message)}</p><button class="btn btn--ink" id="retry">Coba lagi</button></section>`; $('#retry')?.addEventListener('click', load); }
  }

  function invoiceState(i) {
    if (i.status === 'lunas') return { cls: 'ok', text: `Lunas ${tgl(i.paidAt)}` };
    if (i.proofStatus === 'menunggu') return { cls: 'wait', text: 'Bukti terkirim, sedang dicek pemilik' };
    if (i.proofStatus === 'ditolak') return { cls: 'bad', text: `Bukti ditolak: ${i.proofNote || 'hubungi pemilik'}` };
    if (i.overdue) return { cls: 'bad', text: `Terlambat ${i.overdueDays} hari` };
    return { cls: 'due', text: 'Belum dibayar' };
  }

  function render() {
    const { tenant, room, property, owner, invoices, issues } = data;
    const unpaid = invoices.filter((i) => i.status === 'belum').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const paid = invoices.filter((i) => i.status === 'lunas');
    const wa = (t) => owner.whatsapp ? `https://wa.me/${owner.whatsapp}?text=${encodeURIComponent(t)}` : null;
    const firstName = (tenant.name || '').split(' ')[0];

    app.innerHTML = `
      <section class="p-hello">
        ${property?.logo ? `<img class="p-hello__logo" src="${esc(property.logo)}" alt="Logo ${esc(property.name)}" width="120" height="135">` : ''}
        <div>
          <p class="p-hello__hi">Horas, ${esc(firstName)}</p>
          <h1>Kamar ${esc(room?.code || '-')}</h1>
          <p class="p-hello__meta">${esc(property?.name || '')}${room?.type ? `, ${esc(room.type)}` : ''}. Sewa ${rp(tenant.rentAmount)} per ${tenant.rentCycle === 'tahunan' ? 'tahun' : 'bulan'}.</p>
        </div>
      </section>

      <nav class="p-tabs" role="tablist" aria-label="Bagian portal">
        <button role="tab" aria-selected="true" aria-controls="tab-tagihan" id="t-tagihan">Tagihan${unpaid.length ? ` <span class="p-count">${unpaid.length}</span>` : ''}</button>
        <button role="tab" aria-selected="false" aria-controls="tab-lapor" id="t-lapor" tabindex="-1">Lapor kerusakan</button>
      </nav>

      <section id="tab-tagihan" role="tabpanel" aria-labelledby="t-tagihan" class="p-panel">
        ${unpaid.length ? unpaid.map((i) => {
          const st = invoiceState(i);
          const canUpload = i.proofStatus !== 'menunggu';
          return `<article class="bill bill--${st.cls}">
            <div class="bill__top"><span class="bill__period">${esc(i.periodLabel)}</span><span class="bill__state">${esc(st.text)}</span></div>
            <p class="bill__amount">${rp(i.amount)}</p>
            <p class="bill__due">Jatuh tempo ${tgl(i.dueDate)}</p>
            <div class="bill__actions">
              ${canUpload ? `<button class="btn btn--red" data-upload="${i.id}">${i.proofStatus === 'ditolak' ? 'Unggah ulang bukti' : 'Unggah bukti bayar'}</button>` : `<button class="btn btn--ghost" data-upload="${i.id}">Ganti bukti</button>`}
            </div>
          </article>`;
        }).join('') : `<article class="bill bill--ok"><p class="bill__amount">Semua lunas</p><p class="bill__due">Tidak ada tagihan yang perlu dibayar sekarang. Tagihan berikutnya muncul di sini sekitar seminggu sebelum jatuh tempo.</p></article>`}

        ${data.paymentInfo ? `<div class="pay">
          <h2>Cara bayar</h2>
          <p class="pay__info" id="payInfo">${esc(data.paymentInfo)}</p>
          ${data.paymentMethods ? `<p class="pay__note">${esc(data.paymentMethods)}</p>` : ''}
          <button class="btn btn--ghost btn--sm" id="copyPay">Salin info rekening</button>
          <p class="pay__note">Setelah transfer, tekan <strong>Unggah bukti bayar</strong> dan pilih foto atau tangkapan layar bukti transfer.</p>
        </div>` : ''}

        <details class="history" ${unpaid.length ? '' : 'open'}>
          <summary>Riwayat pembayaran (${paid.length})</summary>
          ${paid.length ? `<ul>${paid.map((i) => `<li><span>${esc(i.periodLabel)}<small>Dibayar ${tgl(i.paidAt)}${i.method ? `, ${esc(i.method)}` : ''}</small></span><strong>${rp(i.paidAmount ?? i.amount)}</strong></li>`).join('')}</ul>` : '<p class="muted">Belum ada pembayaran tercatat.</p>'}
        </details>
      </section>

      <section id="tab-lapor" role="tabpanel" aria-labelledby="t-lapor" class="p-panel" hidden>
        <form class="issue-form" id="issueForm" novalidate>
          <fieldset><legend>Apa yang bermasalah?</legend>
            <div class="chips">${CATS.map((c, i) => `<label class="chip-radio"><input type="radio" name="category" value="${esc(c)}" ${i === 0 ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</div>
          </fieldset>
          <label>Judul singkat<input name="title" id="issueTitle" maxlength="120" placeholder="Contoh: Lampu kamar mandi mati" required></label>
          <label>Keterangan <span class="opt">(opsional)</span><textarea name="description" id="issueDesc" rows="3" maxlength="1500" placeholder="Sejak kapan, seberapa parah, kapan Anda ada di kamar"></textarea></label>
          <div class="issue-photo"><button type="button" class="btn btn--ghost btn--sm" id="issuePhotoBtn">Tambah foto</button><span id="issuePhotoName" class="muted"></span></div>
          <p class="form__error" id="issueErr" role="alert" hidden></p>
          <button class="btn btn--red btn--block" type="submit" id="issueSubmit">Kirim laporan</button>
        </form>
        <h2 class="p-h2">Laporan Anda</h2>
        ${issues.length ? `<ul class="issues">${issues.map((i) => `<li class="issue issue--${i.status}">
          <div class="issue__top"><strong>${esc(i.title)}</strong><span class="issue__status">${{ baru: 'Diterima', dikerjakan: 'Sedang dikerjakan', selesai: 'Selesai' }[i.status]}</span></div>
          <p class="muted">${esc(i.category)}, dilaporkan ${tgl(i.createdAt)}${i.hasPhoto ? ', dengan foto' : ''}</p>
          ${i.ownerNote ? `<p class="issue__note">Pemilik: ${esc(i.ownerNote)}</p>` : ''}
        </li>`).join('')}</ul>` : '<p class="muted">Belum ada laporan. Laporan yang Anda kirim akan muncul di sini beserta statusnya.</p>'}
      </section>

      <section class="p-contact">
        ${wa(`Horas, saya ${tenant.name} dari kamar ${room?.code || ''}. `) ? `<a class="btn btn--green btn--block" href="${esc(wa(`Horas, saya ${tenant.name} dari kamar ${room?.code || ''}. `))}" target="_blank" rel="noopener">Chat pemilik di WhatsApp</a>` : ''}
        ${(property?.rules || []).length ? `<details class="history"><summary>Aturan ${esc(property.name)}</summary><ul class="rules">${property.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></details>` : ''}
        <p class="muted small">Link portal ini khusus untuk Anda. Jangan bagikan ke orang lain. Kalau ganti HP, buka lagi link dari WhatsApp pemilik.</p>
      </section>`;
    bind();
  }

  // ---------- interaksi ----------
  let uploadFor = null, issuePhoto = null;
  function bind() {
    const tabs = $$('.p-tabs [role=tab]');
    const select = (btn) => tabs.forEach((t) => { const on = t === btn; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; $('#' + t.getAttribute('aria-controls')).hidden = !on; });
    tabs.forEach((t) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => { if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { const n = tabs[(tabs.indexOf(t) + 1) % tabs.length]; select(n); n.focus(); } });
    });
    $('#copyPay')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('#payInfo').textContent); toast('Info rekening disalin.'); }
      catch { getSelection().selectAllChildren($('#payInfo')); toast('Teks sudah dipilih, salin secara manual.'); }
    });
    $$('[data-upload]').forEach((b) => b.addEventListener('click', () => { uploadFor = b.dataset.upload; issuePhoto = null; $('#fileInput').click(); }));
    $('#issuePhotoBtn').addEventListener('click', () => { uploadFor = 'issue'; $('#fileInput').click(); });
    $('#issueForm').addEventListener('submit', submitIssue);
  }

  $('#fileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    if (uploadFor === 'issue') { issuePhoto = file; $('#issuePhotoName').textContent = file.name; return; }
    const btn = $(`[data-upload="${uploadFor}"]`); const label = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Mengunggah…'; }
    try {
      await api('POST', `/invoices/${uploadFor}/proof`, undefined, await shrink(file));
      toast('Bukti terkirim. Pemilik akan mengecek dan menandai lunas.');
      await load();
    } catch (ex) { toast(ex.message, true); if (btn) { btn.disabled = false; btn.textContent = label; } }
  });

  async function submitIssue(e) {
    e.preventDefault();
    const f = e.target, err = $('#issueErr'), btn = $('#issueSubmit');
    const body = Object.fromEntries(new FormData(f));
    if (!String(body.title || '').trim()) { err.textContent = 'Tulis singkat apa yang rusak.'; err.hidden = false; $('#issueTitle').focus(); return; }
    err.hidden = true; btn.disabled = true; btn.textContent = 'Mengirim…';
    try {
      const rec = await api('POST', '/issues', body);
      if (issuePhoto) await api('POST', `/issues/${rec.id}/photo`, undefined, await shrink(issuePhoto));
      issuePhoto = null;
      toast('Laporan terkirim. Pemilik akan menindaklanjuti.');
      await load();
      $('#t-lapor').click();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = 'Kirim laporan'; } }
  }

  // Perkecil foto dari HP sebelum diunggah (hemat kuota, tetap terbaca).
  function shrink(file, max = 1600) {
    return new Promise((resolve) => {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return resolve(file);
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob((b) => resolve(b && b.size < file.size ? b : file), 'image/jpeg', 0.85);
      };
      img.onerror = () => resolve(file); img.src = url;
    });
  }

  load();
})();
