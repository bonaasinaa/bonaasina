/* Mendaftarkan service worker supaya Bonaasina bisa dipasang sebagai aplikasi; gagal
   mendaftar tidak mengganggu apa pun karena situs tetap jalan seperti biasa. */
(() => {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    // updateViaCache 'none': zona ini menaikkan max-age sw.js jadi 4 jam, jadi pemeriksaan
    // versi harus lewat jaringan supaya perbaikan service worker tidak tertahan cache.
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
  });
})();
