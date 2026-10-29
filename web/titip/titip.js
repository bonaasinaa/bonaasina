/* Bonaasina — Titip jualan & jasa mahasiswa: daftar iklan + formulir pasang iklan (disetujui admin). */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const API = (window.BONA_CONFIG?.apiBase || '/api').replace(/\/$/, '');
  const st = { kind: 'semua', cat: 'semua', q: '', list: [], cats: { jual: [], jasa: [] } };
  const ICON = { jual: '<svg viewBox="0 0 24 24"><path d="M7 7V6a5 5 0 0 1 10 0v1h3l-1 15H5L4 7h3Zm2 0h6V6a3 3 0 0 0-6 0v1Z"/></svg>', jasa: '<svg viewBox="0 0 24 24"><path d="M22.7 19 13.6 9.9a6 6 0 0 0-7.9-7.6l3.9 3.9-2.8 2.8-4-3.9A6 6 0 0 0 10.4 13l9.1 9.1a1 1 0 0 0 1.4 0l1.8-1.8a1 1 0 0 0 0-1.3Z"/></svg>' };
  const WA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.4-.7-2.8-1.1-4.6-4-4.8-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.7-.1l2 .9c.3.2.5.2.6.4.1.1.1.8-.2 1.5Z"/></svg>';
  $('#year').textContent = new Date().getFullYear();

  fetch(API + '/titip').then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then((d) => { st.list = d.listings || []; st.cats = d.categories || st.cats; chips(); draw(); fillCats(); })
    .catch(() => { $('#grid').innerHTML = '<p class="kempty">Iklan belum bisa dimuat. Coba muat ulang halaman.</p>'; });

  function chips() {
    const n = (k) => st.list.filter((l) => k === 'semua' || l.kind === k).length;
    $('#kindChips').innerHTML = [['semua', 'Semua'], ['jual', 'Barang'], ['jasa', 'Jasa']].map(([k, t]) => `<button class="chip" aria-pressed="${st.kind === k}" data-kind="${k}">${t} <span class="chip__n">${n(k)}</span></button>`).join('');
    const cats = [...new Set(st.list.filter((l) => st.kind === 'semua' || l.kind === st.kind).map((l) => l.category))];
    $('#catChips').innerHTML = cats.length > 1 ? ['semua', ...cats].map((c) => `<button class="chip chip--soft" aria-pressed="${st.cat === c}" data-cat="${esc(c)}">${c === 'semua' ? 'Semua kategori' : esc(c)}</button>`).join('') : '';
  }
  document.addEventListener('click', (e) => {
    const k = e.target.closest('[data-kind]'); if (k) { st.kind = k.dataset.kind; st.cat = 'semua'; chips(); draw(); }
    const c = e.target.closest('[data-cat]'); if (c) { st.cat = c.dataset.cat; chips(); draw(); }
  });
  $('#q').addEventListener('input', (e) => { st.q = e.target.value.trim().toLowerCase(); draw(); });

  function draw() {
    let list = st.list.filter((l) => (st.kind === 'semua' || l.kind === st.kind) && (st.cat === 'semua' || l.category === st.cat));
    if (st.q) list = list.filter((l) => `${l.title} ${l.description} ${l.category} ${l.sellerInfo} ${l.area}`.toLowerCase().includes(st.q));
    if (!st.list.length) { $('#grid').innerHTML = '<div class="kempty">Belum ada iklan. Jadilah yang pertama: <a href="#pasang">pasang iklan gratis</a>.</div>'; return; }
    if (!list.length) { $('#grid').innerHTML = '<div class="kempty">Tidak ada yang cocok. Coba kata lain atau kategori lain.</div>'; return; }
    $('#grid').innerHTML = list.map((l) => `<article class="tcard${l.featured ? ' is-featured' : ''}">
      <div class="tcard__img">${l.photos?.[0] ? `<img src="${esc(l.photos[0])}" alt="Foto ${esc(l.title)}" loading="lazy">` : `<div class="tcard__ph">${ICON[l.kind]}</div>`}
        <span class="tcard__kind">${l.kind === 'jasa' ? 'Jasa' : 'Barang'}</span>${l.photos?.length > 1 ? `<span class="tcard__more">+${l.photos.length - 1} foto</span>` : ''}</div>
      <div class="tcard__body">
        <span class="tcard__cat">${esc(l.category)}</span>
        <h3 class="tcard__title">${esc(l.title)}</h3>
        <p class="tcard__price">${l.price != null ? rp(l.price) : 'Harga nego'}${l.priceNote && !(l.price == null && /nego/i.test(l.priceNote)) ? ` <span>${esc(l.priceNote)}</span>` : ''}</p>
        <p class="tcard__desc">${esc(l.description)}</p>
        <p class="tcard__seller"><span class="tcard__av" aria-hidden="true">${esc(l.sellerName.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase())}</span><span><strong>${esc(l.sellerName)}</strong>${l.sellerInfo || l.area ? `<small>${esc([l.sellerInfo, l.area].filter(Boolean).join(', '))}</small>` : ''}</span></p>
        <a class="btn btn--wa btn--block" href="${esc(l.waUrl)}" target="_blank" rel="noopener">${WA}Chat penjual</a>
      </div></article>`).join('');
  }

  // ---------- formulir ----------
  const form = $('#tjForm'), photos = [];
  function fillCats() {
    const k = form.kind.value; $('#tjCat').innerHTML = (st.cats[k] || ['Lainnya']).map((c) => `<option>${esc(c)}</option>`).join('');
  }
  form.addEventListener('change', (e) => { if (e.target.name === 'kind') fillCats(); });
  function shrink(file, max = 1400) {
    return new Promise((resolve) => {
      const img = new Image(); const u = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); c.toBlob((b) => resolve(b || file), 'image/jpeg', 0.82); };
      img.onerror = () => resolve(file); img.src = u;
    });
  }
  function drawPhotos() {
    const box = $('#tjPhotos'), add = box.querySelector('.tphotos__add');
    box.querySelectorAll('figure').forEach((f) => f.remove());
    photos.forEach((u, i) => { const f = document.createElement('figure'); f.innerHTML = `<img src="${esc(u)}" alt=""><button type="button" data-rm="${i}" aria-label="Hapus foto">✕</button>`; box.insertBefore(f, add); });
    add.hidden = photos.length >= 3;
  }
  $('#tjPhotos').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { photos.splice(Number(b.dataset.rm), 1); drawPhotos(); } });
  $('#tjPhotos input[type=file]').addEventListener('change', async (e) => {
    const add = $('#tjPhotos .tphotos__add');
    for (const f of [...e.target.files].slice(0, 3 - photos.length)) {
      add.classList.add('is-busy');
      try {
        const blob = await shrink(f);
        const r = await fetch(API + '/titip/foto', { method: 'POST', headers: { 'Content-Type': blob.type || f.type }, body: blob });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Foto gagal diunggah.');
        photos.push(d.url); drawPhotos();
      } catch (ex) { showErr(ex.message); } finally { add.classList.remove('is-busy'); }
    }
    e.target.value = '';
  });
  const showErr = (m) => { $('#tjErr').textContent = m; $('#tjErr').hidden = !m; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); showErr('');
    const d = Object.fromEntries(new FormData(form)); d.photos = photos;
    d.price = String(d.price || '').replace(/\D/g, '');
    if (!d.title.trim()) return showErr('Isi nama barang atau jasa.');
    if (d.description.trim().length < 10) return showErr('Ceritakan sedikit tentang barang atau jasa Anda (minimal 10 huruf).');
    if (!d.sellerName.trim()) return showErr('Isi nama Anda.');
    if (String(d.sellerPhone).replace(/\D/g, '').length < 10) return showErr('Nomor WhatsApp belum benar. Contoh: 0812 3456 7890.');
    const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Mengirim…';
    try {
      const r = await fetch(API + '/titip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      const out = await r.json(); if (!r.ok) throw new Error(out.error || 'Gagal mengirim. Coba lagi.');
      form.hidden = true; $('#tjDone').hidden = false; $('#tjDone').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (ex) { showErr(ex.message); } finally { btn.disabled = false; btn.textContent = 'Kirim iklan'; }
  });
  $('#tjAgain').addEventListener('click', () => { form.reset(); photos.length = 0; drawPhotos(); fillCats(); form.hidden = false; $('#tjDone').hidden = true; });
})();
