/* Service worker Bonaasina: memasang situs sebagai aplikasi dan menampilkan halaman offline
   saat jaringan mati; aset situs tidak di-cache supaya deploy baru langsung terpakai. */
const SHELL = 'bonaasina-v1';
const OFFLINE = '/offline.html';
// Hanya berkas halaman offline sendiri yang disimpan: halaman + logo yang dipakainya.
const PRECACHE = [OFFLINE, '/assets/img/logo-bonaasina.webp'];

async function storeOfflinePage() {
  const cache = await caches.open(SHELL);
  await cache.addAll(PRECACHE).catch(() => {});
}

// Browser bisa menghapus Cache Storage saat penyimpanan menipis; simpan ulang begitu ada koneksi.
async function keepOfflinePage() {
  const cache = await caches.open(SHELL);
  if (await cache.match(OFFLINE)) return;
  await storeOfflinePage();
}

async function offlinePage() {
  const hit = await caches.match(OFFLINE);
  if (hit) return hit;
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>Tidak ada koneksi | Bonaasina</title>' +
    '<p style="font:400 17px/1.6 system-ui;padding:24px">Tidak ada koneksi. Sambungkan internet, lalu muat ulang halaman.</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(storeOfflinePage().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode !== 'navigate') {
    // Aset situs tetap langsung ke jaringan; hanya berkas halaman offline yang dilayani dari cache.
    if (PRECACHE.includes(url.pathname)) {
      event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
    }
    return;
  }

  event.respondWith(fetch(request).then((response) => {
    event.waitUntil(keepOfflinePage());
    return response;
  }).catch(offlinePage));
});
