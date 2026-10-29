/* Mendaftarkan service worker supaya Bonaasina bisa dipasang sebagai aplikasi; gagal
   mendaftar tidak mengganggu apa pun karena situs tetap jalan seperti biasa. */
(() => {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  });
})();
