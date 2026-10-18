/* Bonaasina — daftar Kos Sekitar (kos mitra yang sudah tayang). */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rpShort = (n) => (n >= 1e6 ? 'Rp' + (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' jt' : 'Rp' + Math.round(n / 1000) + ' rb');
  const API = (window.BONA_CONFIG?.apiBase || '/api').replace(/\/$/, '');
  const PER = { harian: ['Harian', 'malam'], bulanan: ['Bulanan', 'bln'], semesteran: ['6 bulanan', '6 bln'], tahunan: ['Tahunan', 'thn'] };
  const st = { gender: 'semua', period: 'semua', free: false, list: [] };
  $('#year').textContent = new Date().getFullYear();
  const ago = (iso) => { if (!iso) return ''; const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5); return d <= 0 ? 'hari ini' : d === 1 ? 'kemarin' : `${d} hari lalu`; };

  fetch(API + '/kos-sekitar').then((r) => r.json()).then((d) => {
    st.list = d.properties || [];
    if (d.intro) $('#intro').textContent = d.intro;
    chips(); draw();
  }).catch(() => { $('#grid').innerHTML = '<p class="kempty">Daftar kos belum bisa dimuat. Coba muat ulang halaman.</p>'; });

  function chips() {
    const g = ['semua', ...new Set(st.list.map((p) => p.gender).filter(Boolean))];
    $('#genderChips').innerHTML = g.map((x) => `<button class="chip" aria-pressed="${st.gender === x}" data-g="${esc(x)}">${x === 'semua' ? 'Semua' : esc(x)}</button>`).join('');
    const per = ['semua', ...Object.keys(PER).filter((k) => st.list.some((p) => (p.periods || []).includes(k)))];
    $('#periodChips').innerHTML = per.length > 2 ? per.map((x) => `<button class="chip" aria-pressed="${st.period === x}" data-p="${x}">${x === 'semua' ? 'Semua periode' : PER[x][0]}</button>`).join('') : '';
  }
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-g]'); if (g) { st.gender = g.dataset.g; chips(); draw(); }
    const p = e.target.closest('[data-p]'); if (p) { st.period = p.dataset.p; chips(); draw(); }
  });
  $('#onlyFree').addEventListener('change', (e) => { st.free = e.target.checked; draw(); });

  function draw() {
    let list = st.list;
    if (st.gender !== 'semua') list = list.filter((p) => p.gender === st.gender);
    if (st.period !== 'semua') list = list.filter((p) => (p.periods || []).includes(st.period));
    if (st.free) list = list.filter((p) => p.freeRooms > 0);
    list = [...list].sort((a, b) => (b.freeRooms > 0) - (a.freeRooms > 0));
    if (!st.list.length) { $('#grid').innerHTML = '<div class="kempty">Belum ada kos di sini. Sementara itu, lihat <a href="/">Kos Asina &amp; Kos Bona</a>, atau <a href="/mitra/">daftarkan kos Anda</a>.</div>'; return; }
    if (!list.length) { $('#grid').innerHTML = '<div class="kempty">Tidak ada kos yang cocok dengan pilihan ini.</div>'; return; }
    $('#grid').innerHTML = list.map((p) => {
      const prices = Object.entries(p.priceFrom || {}).filter(([k]) => st.period === 'semua' || k === st.period).slice(0, 3);
      return `<a class="kcard" href="/kos/?k=${encodeURIComponent(p.slug)}">
        <div class="kcard__img">${p.photo ? `<img src="${esc(p.photo)}" alt="Foto ${esc(p.name)}" loading="lazy">` : '<div class="ph">Foto menyusul</div>'}
          <span class="kcard__badge ${p.freeRooms ? '' : 'is-full'}">${p.freeRooms ? `${p.freeRooms} kamar kosong` : 'Sedang penuh'}</span></div>
        <div class="kcard__body">
          <span class="kcard__name">${esc(p.name)}</span>
          <span class="kcard__meta">${[p.gender ? `Kos ${p.gender.toLowerCase()}` : '', p.city, p.twoPerson ? 'ada kamar untuk 2 orang' : ''].filter(Boolean).map(esc).join(', ')}</span>
          ${p.tagline ? `<span class="kcard__meta">${esc(p.tagline)}</span>` : ''}
          ${prices.length ? `<div class="kcard__price">${prices.map(([k, v]) => `<span>mulai <strong>${rpShort(v)}</strong>/${PER[k][1]}</span>`).join('')}</div>` : ''}
          ${(p.facilities || []).length ? `<div class="kcard__fac">${p.facilities.map((f) => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
          ${p.checkedAt ? `<span class="kcard__meta">Ketersediaan dicek ${ago(p.checkedAt)}</span>` : ''}
        </div></a>`;
    }).join('');
  }
})();
