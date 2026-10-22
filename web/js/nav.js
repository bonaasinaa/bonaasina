/* Menu HP untuk halaman publik selain beranda (kos sekitar, detail kos, mitra). */
(() => {
  const nav = document.getElementById('nav'); if (!nav || document.getElementById('menuBtn')) return;
  const links = [...nav.querySelectorAll('.nav__links a')]; const cta = nav.querySelector('.nav__cta');
  const btn = document.createElement('button'); btn.className = 'nav__menu'; btn.id = 'menuBtn'; btn.type = 'button';
  btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'mobileMenu'); btn.textContent = 'Menu';
  const menu = document.createElement('nav'); menu.className = 'mobile-menu'; menu.id = 'mobileMenu'; menu.setAttribute('aria-label', 'Menu'); menu.hidden = true;
  links.forEach((a) => { const c = a.cloneNode(true); menu.appendChild(c); });
  if (cta && !links.some((a) => a.getAttribute('href') === cta.getAttribute('href'))) { const c = cta.cloneNode(true); c.className = 'btn btn--red'; menu.appendChild(c); }
  nav.append(btn, menu);
  const set = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', open); btn.textContent = open ? 'Tutup' : 'Menu'; document.body.classList.toggle('menu-open', open); };
  btn.addEventListener('click', () => set(menu.hidden));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { set(false); btn.focus(); } });
  // Logo Bonaasina dari pengaturan admin (bila sudah diganti).
  const API = (window.BONA_CONFIG?.apiBase || '/api').replace(/\/$/, '');
  fetch(API + '/brand').then((r) => r.json()).then((b) => { if (b.brandLogo) document.querySelectorAll('[data-brand-logo]').forEach((im) => { im.src = b.brandLogo; }); }).catch(() => {});
})();
