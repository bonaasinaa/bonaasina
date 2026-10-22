/* Bonaasina — perilaku bersama dashboard: navigasi bawah di HP, grup menu yang bisa dilipat,
   animasi masuk sekali per menu, angka yang berhitung, dan pembantu grafik kecil (donut, batang). */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ICONS = {
    wallet: 'M3 6a3 3 0 0 1 3-3h12v4h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a3 3 0 0 1-3-3V6Zm3-1a1 1 0 0 0 0 2h10V5H6Zm11 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
    alarm: 'M12 4a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm1 4v4.6l3.2 1.9-1 1.7L11 13.7V8h2ZM3.3 2.6 7 5.7 5.7 7.2 2 4.1l1.3-1.5Zm17.4 0L22 4.1l-3.7 3.1L17 5.7l3.7-3.1Z',
    calendar: 'M7 2v2H4v18h16V4h-3V2h-2v2H9V2H7Zm-1 8h12v10H6V10Zm2 2v2h3v-2H8Z',
    check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z',
    inbox: 'M4 3h16l2 10v8H2v-8L4 3Zm1.6 2-1.4 8H9a3 3 0 0 0 6 0h4.8l-1.4-8H5.6Z',
    home: 'M12 3 2 11h3v10h5v-6h4v6h5V11h3L12 3Z',
    bed: 'M3 10V5h2v4h14V5h2v5H3Zm0 2h18v7h-2v-2H5v2H3v-7Z',
    people: 'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-2.7 0-8 1.3-8 4v3h16v-3c0-2.7-5.3-4-8-4Zm8 0c-.3 0-.7 0-1.1.1A4.2 4.2 0 0 1 17 17v3h7v-3c0-2.7-5.3-4-8-4Z',
    coin: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15.9V19h-2v-1.1c-1.7-.3-3-1.4-3.1-3h2c.1.9.8 1.5 2.1 1.5 1.4 0 1.8-.7 1.8-1.2 0-.6-.3-1.2-2-1.6-1.9-.5-3.2-1.2-3.2-2.8 0-1.3 1.1-2.3 2.4-2.6V7h2v1.2c1.4.4 2.3 1.4 2.4 2.8h-2c0-.8-.6-1.4-1.8-1.4-1.1 0-1.7.5-1.7 1.1 0 .6.5 1 2 1.4 1.6.4 3.2 1.1 3.2 3 0 1.4-1 2.4-2.1 2.8Z',
    chat: 'M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 1-2Z',
    wa: 'M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.4-.7-2.8-1.1-4.6-4-4.8-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.7-.1l2 .9c.3.2.5.2.6.4.1.1.1.8-.2 1.5Z',
    bell: 'M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5-6.7V3a2 2 0 1 0-4 0v1.3A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z',
    menu: 'M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z',
    tool: 'M22.7 19 13.6 9.9a6 6 0 0 0-7.9-7.6l3.9 3.9-2.8 2.8-4-3.9A6 6 0 0 0 10.4 13l9.1 9.1a1 1 0 0 0 1.4 0l1.8-1.8a1 1 0 0 0 0-1.3Z',
  };
  const ico = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ICONS.check}"/></svg>`;

  // Warna avatar tetap untuk nama yang sama.
  const AV = ['#F4DCD6', '#E3EFE2', '#F6E8C8', '#E2E9F4', '#EADFF0', '#F1E2D3'];
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const avatar = (name, cls = '') => {
    let h = 0; for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `<span class="av ${cls}" style="--av:${AV[h % AV.length]}" aria-hidden="true">${esc(initials(name))}</span>`;
  };

  /** Donut: segs = [{label, value, color}], mid = {value, label}. */
  function donut(segs, mid = {}) {
    const total = segs.reduce((s, x) => s + (x.value || 0), 0) || 1;
    const R = 52, C = 2 * Math.PI * R;
    let off = 0;
    const rings = segs.map((x) => {
      const len = (x.value / total) * C;
      const el = `<circle class="seg" r="${R}" cx="70" cy="70" stroke="${x.color}" data-len="${len.toFixed(2)}" stroke-dasharray="${reduce ? `${len.toFixed(2)} ${C}` : `0 ${C}`}" stroke-dashoffset="${(-off).toFixed(2)}"/>`;
      off += len; return el;
    }).join('');
    const label = segs.map((x) => `${x.value} ${x.label}`).join(', ');
    return `<div class="viz"><div class="donut" role="img" aria-label="${esc(label)}"><svg viewBox="0 0 140 140"><circle r="${R}" cx="70" cy="70" stroke="rgba(36,22,15,.07)"/>${rings}</svg>
      <div class="donut__mid"><strong>${esc(mid.value ?? '')}</strong><span>${esc(mid.label ?? '')}</span></div></div>
      <div class="legend2">${segs.map((x) => `<div><i style="background:${x.color}"></i>${esc(x.label)}<b>${x.value}</b></div>`).join('')}</div></div>`;
  }

  /** Batang kolom: items = [{label, value, text, now}] */
  function colbars(items, aria = '') {
    const max = Math.max(1, ...items.map((i) => i.value || 0));
    return `<div class="colbars" style="--n:${items.length}" role="img" aria-label="${esc(aria)}">${items.map((i) => `<div class="colbars__c ${i.now ? 'is-now' : ''}" title="${esc(i.label)}: ${esc(i.text)}">
      <span class="colbars__v">${esc(i.short ?? i.text)}</span><span class="colbars__bar" data-h="${((i.value || 0) / max) * 100}" style="${reduce ? `height:${((i.value || 0) / max) * 100}%` : ''}"></span><span class="colbars__l">${esc(i.label)}</span></div>`).join('')}</div>`;
  }

  /** Corong / batang horizontal: rows = [{label, value, color}] */
  function funnel(rows) {
    const max = Math.max(1, ...rows.map((r) => r.value || 0));
    return `<div class="funnel">${rows.map((r) => `<div><span>${esc(r.label)}</span><i style="--tone:${r.color}" data-w="${((r.value || 0) / max) * 100}"></i><b>${r.value || 0}</b></div>`).join('')}</div>`;
  }

  const short = (n) => {
    n = Number(n) || 0;
    if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace('.0', '').replace('.', ',')} M`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.0', '').replace('.', ',')} jt`;
    if (n >= 1e3) return `${Math.round(n / 1e3)} rb`;
    return String(n);
  };

  // Jalankan isian grafik & angka berhitung untuk elemen yang baru tampil.
  function play(root, animateNumbers) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.querySelectorAll('.donut .seg[data-len]').forEach((c) => { const C = 2 * Math.PI * 52; c.setAttribute('stroke-dasharray', `${c.dataset.len} ${C}`); });
      root.querySelectorAll('.colbars__bar[data-h]').forEach((b) => { b.style.height = `${b.dataset.h}%`; });
      root.querySelectorAll('.funnel i[data-w], .meter i[data-w]').forEach((b) => { b.style.width = `${b.dataset.w}%`; });
    }));
    if (!animateNumbers || reduce) return;
    root.querySelectorAll('[data-count]').forEach((el) => {
      const end = Number(el.dataset.count); if (!Number.isFinite(end) || end === 0) return;
      const fmt = el.dataset.fmt === 'rp' ? (v) => `Rp${Math.round(v).toLocaleString('id-ID')}` : (v) => Math.round(v).toLocaleString('id-ID');
      const final = el.textContent; const t0 = performance.now(), dur = 700;
      const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = k < 1 ? fmt(end * (1 - Math.pow(1 - k, 3))) : final; if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }

  // Animasi masuk hanya saat berpindah menu, bukan saat data diperbarui di tempat.
  function watchMain() {
    const main = document.getElementById('main'); if (!main) return;
    let lastKey = null;
    const obs = new MutationObserver(() => {
      if (!main.firstElementChild || main.querySelector('.skeleton')) return;
      const key = location.pathname + location.hash;
      const isNew = key !== lastKey; lastKey = key;
      if (isNew && !reduce) {
        main.classList.remove('is-enter'); void main.offsetWidth;
        [...main.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i, 8)));
        main.querySelectorAll('.grid').forEach((g) => [...g.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i + 1, 8))));
        main.classList.add('is-enter');
        clearTimeout(watchMain.t); watchMain.t = setTimeout(() => main.classList.remove('is-enter'), 1100);
      }
      play(main, isNew);
    });
    obs.observe(main, { childList: true });
  }

  // Grup menu samping bisa dilipat (diingat per perangkat).
  function collapsibleGroups() {
    const nav = document.getElementById('sideNav'); if (!nav) return;
    const groups = [...nav.querySelectorAll('p.side__group')]; if (groups.length < 3) return;
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('bona.navGroups') || '{}'); } catch { /* abaikan */ }
    groups.forEach((p) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'side__group'; b.textContent = p.textContent;
      const links = []; let n = p.nextElementSibling;
      while (n && !n.classList.contains('side__group')) { if (n.tagName === 'A') links.push(n); n = n.nextElementSibling; }
      const set = (open) => {
        b.setAttribute('aria-expanded', open);
        links.forEach((a) => a.classList.toggle('is-collapsed', !open && a.getAttribute('aria-current') !== 'page'));
      };
      b.onclick = () => { const open = b.getAttribute('aria-expanded') !== 'true'; set(open); saved[p.textContent] = open; try { localStorage.setItem('bona.navGroups', JSON.stringify(saved)); } catch { /* abaikan */ } };
      p.replaceWith(b); set(saved[p.textContent] !== false);
      // tetap tampilkan menu aktif walau grupnya terlipat
      new MutationObserver(() => set(b.getAttribute('aria-expanded') === 'true')).observe(nav, { attributes: true, subtree: true, attributeFilter: ['aria-current'] });
    });
  }

  // Navigasi bawah di HP: menu bertanda data-bnav + tombol Menu yang membuka laci.
  function bottomNav() {
    const nav = document.getElementById('sideNav'); const menuBtn = document.getElementById('menuBtn');
    if (!nav || !menuBtn) return;
    const picks = [...nav.querySelectorAll('a[data-bnav]')]; if (!picks.length) return;
    const bar = document.createElement('nav'); bar.className = 'bnav'; bar.setAttribute('aria-label', 'Menu cepat');
    bar.style.setProperty('--n', picks.length + 1);
    picks.forEach((a) => {
      const l = document.createElement('a'); l.href = a.getAttribute('href'); l.dataset.view = a.dataset.view;
      const svg = a.querySelector('svg')?.outerHTML || ''; const badge = a.querySelector('.badge');
      l.innerHTML = `${svg}<span class="lbl">${esc(a.dataset.bnav || a.textContent.trim())}</span>`;
      if (badge) { const b = document.createElement('span'); b.className = 'badge'; b.hidden = true; l.appendChild(b); new MutationObserver(() => { b.textContent = badge.textContent; b.hidden = badge.hidden; }).observe(badge, { attributes: true, childList: true, characterData: true, subtree: true }); }
      bar.appendChild(l);
    });
    const m = document.createElement('button'); m.type = 'button'; m.innerHTML = `${ico('menu')}<span class="lbl">Menu</span>`;
    m.onclick = () => menuBtn.click(); bar.appendChild(m);
    const dot = document.getElementById('navDot');
    if (dot) { const b = document.createElement('span'); b.className = 'badge'; b.style.minWidth = '10px'; b.style.height = '10px'; b.hidden = true; m.appendChild(b); new MutationObserver(() => { b.hidden = dot.hidden; }).observe(dot, { attributes: true }); }
    const sync = () => { const cur = nav.querySelector('a[aria-current="page"]')?.dataset.view; bar.querySelectorAll('a').forEach((l) => (l.dataset.view === cur ? l.setAttribute('aria-current', 'page') : l.removeAttribute('aria-current'))); };
    new MutationObserver(sync).observe(nav, { attributes: true, subtree: true, attributeFilter: ['aria-current'] });
    const app = document.getElementById('app') || document.body; app.appendChild(bar); sync();
  }

  // Widget kecil di bawah menu samping (isi diatur oleh tiap dashboard).
  function sideWidget(html) {
    const side = document.getElementById('side'); if (!side) return;
    let w = side.querySelector('.side__widget');
    if (!w) { w = document.createElement('div'); w.className = 'side__widget'; side.insertBefore(w, side.querySelector('.side__logout')); }
    w.innerHTML = html || ''; play(w, false);
  }

  const greet = () => { const h = new Date().getHours(); return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 19 ? 'Selamat sore' : 'Selamat malam'; };

  window.BonaDash = { ico, avatar, donut, colbars, funnel, short, play, sideWidget, greet };
  const init = () => { collapsibleGroups(); bottomNav(); watchMain(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
