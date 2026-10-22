/* Bonaasina — Info sekitar kos: warung, laundry, toko, dll. + formulir usulan tempat. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const API = (window.BONA_CONFIG?.apiBase || '/api').replace(/\/$/, '');
  const ICON = { makan: '🍛', toko: '🛒', laundry: '🧺', fotokopi: '🖨️', kesehatan: '💊', transport: '🛵', ibadah: '⛪', lainnya: '📍' };
  const st = { cat: 'semua', q: '', list: [], cats: {} };
  $('#year').textContent = new Date().getFullYear();
  const mapUrl = (p) => { const qy = p.mapsQuery || [p.name, p.address].filter(Boolean).join(', '); return qy ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(qy)}` : null; };

  fetch(API + '/sekitar').then((r) => r.json()).then((d) => {
    st.list = d.places || []; st.cats = d.categories || {};
    $('#usulCat').innerHTML = Object.entries(st.cats).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    chips(); draw();
  }).catch(() => { $('#grid').innerHTML = '<p class="kempty">Info sekitar belum bisa dimuat. Coba muat ulang halaman.</p>'; });

  function chips() {
    const used = Object.keys(st.cats).filter((k) => st.list.some((p) => p.category === k));
    $('#catChips').innerHTML = ['semua', ...used].map((k) => `<button class="chip" aria-pressed="${st.cat === k}" data-cat="${k}">${k === 'semua' ? 'Semua' : `${ICON[k]} ${esc(st.cats[k])}`} <span class="chip__n">${k === 'semua' ? st.list.length : st.list.filter((p) => p.category === k).length}</span></button>`).join('');
  }
  document.addEventListener('click', (e) => { const c = e.target.closest('[data-cat]'); if (c) { st.cat = c.dataset.cat; chips(); draw(); } });
  $('#q').addEventListener('input', (e) => { st.q = e.target.value.trim().toLowerCase(); draw(); });

  function draw() {
    let list = st.list.filter((p) => st.cat === 'semua' || p.category === st.cat);
    if (st.q) list = list.filter((p) => `${p.name} ${p.description} ${p.address} ${p.priceNote}`.toLowerCase().includes(st.q));
    if (!st.list.length) { $('#grid').innerHTML = '<div class="kempty">Daftar tempat sedang kami lengkapi. Tahu tempat yang bagus? <a href="#usul">Usulkan di sini</a>.</div>'; return; }
    if (!list.length) { $('#grid').innerHTML = '<div class="kempty">Tidak ada tempat yang cocok.</div>'; return; }
    $('#grid').innerHTML = list.map((p) => { const m = mapUrl(p); return `<article class="pcard">
      ${p.photo ? `<div class="pcard__img"><img src="${esc(p.photo)}" alt="Foto ${esc(p.name)}" loading="lazy"></div>` : ''}
      <div class="pcard__body">
        <div class="pcard__top"><span class="pcard__ico" aria-hidden="true">${ICON[p.category] || '📍'}</span><div><h3>${esc(p.name)}</h3><span class="pcard__cat">${esc(st.cats[p.category] || '')}</span></div></div>
        ${p.description ? `<p class="pcard__desc">${esc(p.description)}</p>` : ''}
        <ul class="pcard__facts">${p.distanceNote ? `<li><b>Jarak</b>${esc(p.distanceNote)}</li>` : ''}${p.openHours ? `<li><b>Buka</b>${esc(p.openHours)}</li>` : ''}${p.priceNote ? `<li><b>Harga</b>${esc(p.priceNote)}</li>` : ''}${p.address ? `<li><b>Alamat</b>${esc(p.address)}</li>` : ''}</ul>
        ${m || p.waUrl ? `<div class="pcard__act">${m ? `<a class="btn btn--ghost btn--sm" href="${esc(m)}" target="_blank" rel="noopener">Petunjuk arah</a>` : ''}${p.waUrl ? `<a class="btn btn--wa btn--sm" href="${esc(p.waUrl)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>` : ''}
      </div></article>`; }).join('');
  }

  const form = $('#usulForm');
  const err = (m) => { $('#usulErr').textContent = m; $('#usulErr').hidden = !m; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err('');
    const d = Object.fromEntries(new FormData(form));
    if (!d.name.trim()) return err('Isi nama tempat.');
    const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Mengirim…';
    try {
      const r = await fetch(API + '/sekitar/usul', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      const out = await r.json(); if (!r.ok) throw new Error(out.error || 'Gagal mengirim. Coba lagi.');
      form.hidden = true; $('#usulDone').hidden = false;
    } catch (ex) { err(ex.message); } finally { btn.disabled = false; btn.textContent = 'Kirim usulan'; }
  });
  $('#usulAgain').addEventListener('click', () => { form.reset(); form.hidden = false; $('#usulDone').hidden = true; });
})();
