/* Google Analytics 4 untuk semua halaman. Page view dikirim manual dengan alamat bersih (tanpa #hash dan ?query)
   supaya token portal tidak terkirim ke Google; admin & dashboard memanggil bonaTrack('/admin/<menu>') saat pindah menu. Tidak aktif di localhost. */
(() => {
  const id = window.BONA_CONFIG?.ga4Id;
  const noop = () => {};
  window.bonaTrack = noop; window.bonaEvent = noop;
  if (!id || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  const path = location.pathname;
  const area = path.startsWith('/admin') ? 'Admin' : path.startsWith('/penghuni') ? 'Dashboard penghuni' : path.startsWith('/cek') ? 'Cek kartu' : 'Website';
  const clean = (p) => location.origin + p;

  gtag('js', new Date());
  gtag('config', id, { send_page_view: false, page_location: clean(path), page_referrer: document.referrer.split(/[?#]/)[0], content_group: area });

  window.bonaTrack = (p, title) => gtag('event', 'page_view', { page_location: clean(p), page_title: title || document.title, content_group: area });
  window.bonaEvent = (name, params = {}) => gtag('event', name, { content_group: area, ...params });

  // Halaman biasa: satu page view saat dibuka. Admin & dashboard penghuni mengirim sendiri per menu.
  // Halaman 404 dicatat sebagai /404 dengan alamat yang dicari, supaya tautan rusak mudah ditemukan.
  if (document.documentElement.dataset.page === '404') window.bonaEvent('page_not_found', { missing_path: path.slice(0, 100) });
  if (area !== 'Admin' && area !== 'Dashboard penghuni') window.bonaTrack(document.documentElement.dataset.page === '404' ? '/404' : path, document.title);

  // Klik penting di website: hubungi lewat WhatsApp.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href*="wa.me/"]');
    if (a) window.bonaEvent('contact_whatsapp', { link_text: (a.textContent || '').trim().slice(0, 60) });
  }, { capture: true });

  const s = document.createElement('script');
  s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
})();
