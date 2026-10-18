/* Bonaasina — halaman detail satu kos (mitra atau milik sendiri): foto, kamar & harga per periode, aturan, lokasi, reservasi. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const API = (window.BONA_CONFIG?.apiBase || '/api').replace(/\/$/, '');
  const PERIODS = { harian: ['Harian', 'malam', 'priceDaily'], bulanan: ['Bulanan', 'bulan', 'priceMonthly'], semesteran: ['6 bulan', '6 bulan', 'priceSemester'], tahunan: ['Tahunan', 'tahun', 'priceYearly'] };
  const STATUS = { kosong: 'Kosong', terisi: 'Terisi', dipesan: 'Sudah dipesan', perbaikan: 'Sedang diperbaiki' };
  const slug = new URLSearchParams(location.search).get('k') || '';
  const box = $('#kos'); let d = null; let cycle = 'bulanan'; let booking = null;
  $('#year').textContent = new Date().getFullYear();
  const ago = (iso) => { if (!iso) return ''; const n = Math.floor((Date.now() - Date.parse(iso)) / 864e5); return n <= 0 ? 'hari ini' : n === 1 ? 'kemarin' : `${n} hari lalu`; };

  if (!slug) { box.innerHTML = '<div class="kempty">Kos tidak ditemukan. <a href="/kos-sekitar/">Lihat semua kos sekitar</a>.</div>'; return; }
  fetch(`${API}/kos/${encodeURIComponent(slug)}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; }).then((data) => {
    d = data; const p = d.property;
    cycle = p.periods.includes('bulanan') ? 'bulanan' : p.periods[0];
    document.title = `${p.name} — Kos Sekitar Bonaasina`;
    $('meta[name=description]').content = `${p.name}${p.city ? `, ${p.city}` : ''}. ${p.tagline || 'Lihat kamar kosong, harga, dan pesan lewat Bonaasina.'}`;
    render();
  }).catch((ex) => { box.innerHTML = `<div class="kempty">${esc(ex.message || 'Kos tidak ditemukan.')} <a href="/kos-sekitar/">Lihat kos lain</a>.</div>`; });

  const wa = (text) => (d.property.whatsapp ? `https://wa.me/${d.property.whatsapp}?text=${encodeURIComponent(text)}` : null);
  function render() {
    const p = d.property; const free = d.rooms.filter((r) => r.status === 'kosong').length;
    const photos = (p.photos || []).slice(0, 3);
    const gallery = photos.map((u, j) => `<button type="button" class="gallery__item" data-photo="${j}" aria-label="Perbesar foto ${j + 1}"><img src="${esc(u)}" alt="Foto ${esc(p.name)} ${j + 1}" loading="${j ? 'lazy' : 'eager'}"></button>`).join('')
      + ['Foto tampak depan menyusul', 'Foto kamar menyusul', 'Foto area bersama menyusul'].slice(photos.length).map((t) => `<div class="ph">${esc(t)}</div>`).join('');
    const hello = `Horas, saya melihat ${p.name} di Bonaasina. Apakah masih ada kamar kosong?`;
    const waUrl = p.waEnabled ? wa(hello) : null;
    if (waUrl) { $('#waFloat').href = waUrl; $('#waFloat').hidden = false; }
    box.innerHTML = `
      <p class="crumbs"><a href="/">Bonaasina</a> / <a href="/kos-sekitar/">Kos sekitar</a> / ${esc(p.name)}</p>
      <div class="page__head"><div><h1>${esc(p.name)}</h1>${p.tagline ? `<p>${esc(p.tagline)}</p>` : ''}
        <div class="kd__tags">${p.gender ? `<span>Kos ${esc(p.gender.toLowerCase())}</span>` : ''}${p.city ? `<span>${esc(p.city)}</span>` : ''}<span>${free ? `${free} kamar kosong` : 'Sedang penuh'}</span>${p.checkedAt ? `<span class="is-fresh">Ketersediaan dicek ${ago(p.checkedAt)}</span>` : ''}
          ${p.periods.map((k) => `<span>${PERIODS[k][0]}</span>`).join('')}</div></div></div>
      <div class="kd">
        <div class="kd__main">
          <div class="gallery">${gallery}</div>
          ${p.description ? `<p class="kd__desc">${esc(p.description)}</p>` : ''}
          <section id="kamar"><div class="section__head section__head--split"><div><h2>Kamar &amp; harga</h2><p>${free} dari ${d.rooms.length} kamar kosong.</p></div>
            ${p.periods.length > 1 ? `<div class="toggle" role="radiogroup" aria-label="Lama sewa" id="cyc" style="--n:${p.periods.length};--i:${p.periods.indexOf(cycle)}" data-n="${p.periods.length}"><span class="toggle__pill" aria-hidden="true"></span>${p.periods.map((k) => `<button role="radio" aria-checked="${k === cycle}" data-cycle="${k}">${PERIODS[k][0]}</button>`).join('')}</div>` : ''}</div>
            <ul class="rooms" id="rooms"></ul></section>
          <div class="kd__cols">
            ${(p.facilities || []).length ? `<div><h3>Fasilitas bersama</h3><ul class="kd__list">${p.facilities.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>` : ''}
            ${(p.rules || []).length ? `<div><h3>Aturan kos</h3><ul class="kd__list">${p.rules.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>` : ''}
            ${(p.nearby || []).length ? `<div><h3>Dekat dengan</h3><ul class="kd__list">${p.nearby.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>` : ''}
            ${p.bookingPolicy ? `<div><h3>Aturan booking &amp; pembatalan</h3><p class="kd__desc" style="margin-top:12px">${esc(p.bookingPolicy)}</p></div>` : ''}
          </div>
          <section><h2>Lokasi</h2><p class="kd__desc" style="margin:10px 0 16px">${esc(p.address || '')}</p>
            ${p.mapsQuery ? `<div class="kd__map"><iframe title="Peta ${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${encodeURIComponent(p.mapsQuery)}&output=embed"></iframe></div><p style="margin-top:10px"><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.mapsQuery)}" target="_blank" rel="noopener">Buka di Google Maps</a></p>` : '<p class="muted">Titik peta belum diatur. Tanyakan lokasi lewat chat atau WhatsApp.</p>'}</section>
        </div>
        <aside class="kd__side" id="pesan">
          <div class="kd__contact"><h3>Pesan kamar</h3><p>Belum perlu membayar. Pemilik memastikan kamar tersedia dulu${p.minBooking ? `, lalu Anda membayar booking/DP minimal ${rp(p.minBooking)} langsung ke rekening pemilik` : ''}. Setelah DP diperiksa, Bonaasina menerbitkan bukti booking resmi.</p>
            ${p.visitHours ? `<p>Jam kunjungan: ${esc(p.visitHours)}</p>` : ''}
            <p>${p.chatEnabled ? 'Setelah reservasi terkirim, Anda bisa chat langsung dengan pemilik di dashboard reservasi.' : ''}${waUrl ? ` <a href="${esc(waUrl)}" target="_blank" rel="noopener">Atau tanya lewat WhatsApp</a>.` : ''}</p></div>
          <div id="bookingBox"></div>
        </aside>
      </div>`;
    rooms();
    booking = BonaBooking.mount($('#bookingBox'), { properties: [p], rooms: d.rooms, period: cycle });
    $('#cyc')?.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; cycle = b.dataset.cycle;
      $('#cyc').style.setProperty('--i', p.periods.indexOf(cycle));
      $$('#cyc button').forEach((x) => x.setAttribute('aria-checked', x === b)); rooms(); booking.setPeriod(cycle);
    });
    box.addEventListener('click', (e) => {
      const r = e.target.closest('[data-book]');
      if (r) { booking.setRoom(r.dataset.book); $('#pesan').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); setTimeout(() => $('#bookingBox [name=name]')?.focus({ preventScroll: true }), 500); }
      const ph = e.target.closest('[data-photo]'); if (ph) lightbox(p.photos, Number(ph.dataset.photo), p.name);
      const rp2 = e.target.closest('[data-rphoto]'); if (rp2) { const rr = d.rooms.find((x) => x.id === rp2.dataset.rphoto); lightbox(rr.photos, 0, `Kamar ${rr.code}`); }
    });
  }
  function rooms() {
    const k = PERIODS[cycle];
    const order = { kosong: 0, dipesan: 1, terisi: 2, perbaikan: 3 };
    const list = [...d.rooms].sort((a, b) => order[a.status] - order[b.status] || a.code.localeCompare(b.code, 'id', { numeric: true }));
    $('#rooms').innerHTML = list.length ? list.map((r) => {
      const price = Number(r[k[2]]) || 0; const avail = r.status === 'kosong';
      return `<li class="room ${avail ? '' : 'is-unavailable'}">
        <div class="room__code">${esc(r.code)}${(r.photos || []).length ? `<button type="button" class="room__thumb" data-rphoto="${r.id}" aria-label="Lihat foto kamar ${esc(r.code)}"><img src="${esc(r.photos[0])}" alt="" loading="lazy"><span>${r.photos.length} foto</span></button>` : ''}</div>
        <div class="room__info"><div class="room__type">${esc(r.type || 'Kamar')}</div><div class="room__meta">${[r.sizeM2, r.floor].filter(Boolean).map(esc).join(', ')}</div>
          ${Number(r.capacity) === 2 ? `<div class="room__cap">Bisa untuk 2 orang${r.extraPersonFee ? ` (+${rp(r.extraPersonFee)}/bln)` : ''}</div>` : ''}
          <span class="status status--${r.status}">${STATUS[r.status] || esc(r.status)}</span></div>
        <div class="room__fac">${(r.facilities || []).map(esc).join(', ')}${r.note ? `<span class="room__note">${esc(r.note)}</span>` : ''}</div>
        <div class="room__price">${price ? `<span class="room__amount">${rp(price)}</span><span class="room__per">per ${k[1]}</span>` : `<span class="room__per">Harga ${k[0].toLowerCase()} belum ada</span>`}</div>
        <div class="room__actions">${avail ? `<button class="btn btn--red btn--sm" data-book="${r.id}">Pesan kamar ini</button>` : `<span class="room__per">${STATUS[r.status]}</span>`}</div></li>`;
    }).join('') : '<li class="rooms__empty">Pemilik belum menambahkan kamar.</li>';
  }

  // lightbox sederhana
  let lb;
  function lightbox(list, i, title) {
    if (!list?.length) return;
    if (!lb) {
      lb = document.createElement('dialog'); lb.className = 'lightbox';
      lb.innerHTML = '<figure><img alt=""><figcaption></figcaption></figure><button type="button" class="lightbox__close" aria-label="Tutup">✕</button><button type="button" class="lightbox__nav lightbox__prev" aria-label="Sebelumnya">‹</button><button type="button" class="lightbox__nav lightbox__next" aria-label="Berikutnya">›</button>';
      document.body.appendChild(lb);
      $('.lightbox__close', lb).onclick = () => lb.close();
      lb.addEventListener('click', (e) => { if (e.target === lb) lb.close(); });
    }
    let idx = i;
    const show = () => { $('img', lb).src = list[idx]; $('img', lb).alt = `${title} ${idx + 1}`; $('figcaption', lb).textContent = `${title} — ${idx + 1} dari ${list.length}`; $$('.lightbox__nav', lb).forEach((b) => { b.hidden = list.length < 2; }); };
    $('.lightbox__prev', lb).onclick = () => { idx = (idx - 1 + list.length) % list.length; show(); };
    $('.lightbox__next', lb).onclick = () => { idx = (idx + 1) % list.length; show(); };
    show(); lb.showModal();
  }
})();
