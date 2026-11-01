# Desain: CSS non-blokir dan pengiriman gambar

Batch lanjutan dari sisa PR #35, dijalankan lewat alur superpowers (brainstorming, desain,
rencana, eksekusi, verifikasi). Yang dipilih pemilik: opsi A (transformasi gambar) lalu C
(CSS non-blokir). A ternyata tertutup, jadi batch ini berisi C dan catatan keputusan A.

## A tertutup di tiga jalur, semuanya diukur

| Jalur | Hasil | Bukti |
| --- | --- | --- |
| Transformasi Supabase Storage | Tidak aktif untuk project ini | `GET /storage/v1/render/image/public/...` menjawab `403 FeatureNotEnabled` |
| Cloudflare Image Resizing | Tidak aktif di zona | `https://bonaasina.my.id/cdn-cgi/image/width=400/...` menjawab `404` |
| Varian offline dengan ffmpeg | Justru lebih besar dari aslinya | `scale=560` menghasilkan 82 sampai 105 KB sementara berkas 900 px aslinya 46 KB |

Jadi srcset tidak bisa dibangun tanpa fitur berbayar atau unggahan ganda. Keputusan itu
dikembalikan ke pemilik, bukan dipaksakan.

## C yang dikerjakan

`livechat.css` (3,7 KB) tadinya dimuat di `head` lima halaman, memblokir render, padahal
panelnya sendiri belum tentu tampil karena admin bisa mematikannya. Sekarang CSS itu dimuat
oleh `js/livechat.js` tepat sebelum panel dipasang ke DOM:

- `loadChatCss()` menyisipkan `<link>` sekali saja, menunggu `load`, `error`, atau batas
  1,2 detik sebagai jaring pengaman.
- `await loadChatCss()` dipanggil setelah pemeriksaan `cfg.visible` dan `cfg.enabled`, jadi
  halaman yang tidak menampilkan chat tidak pernah mengunduh berkas ini.
- Token `livechat.css` menjadi `20261101a` di dalam JS, dan `livechat.js` dinaikkan ke
  `20261101a` di lima halaman supaya browser mengambil versi baru.

## Bukti

- 0,8 detik setelah load: tidak ada `<link>` bertanda `data-livechat-css` dan tidak ada
  permintaan `livechat.css` di head.
- 5,2 detik: `<link>` ada dengan `?v=20261101a`, stylesheet terparse dengan 69 aturan.
- `check-comments --strict` 0 pelanggaran 0 catatan, `check-ui` 0 masalah, `check-csp`
  0 masalah (tidak ada skrip inline baru).

## Yang sengaja tidak diubah

- `pwa.css` tetap memblokir. Isinya aturan `env(safe-area-inset-*)` untuk aplikasi
  terpasang; memuatnya setelah paint menggeser layout di mode standalone, dan mode itu
  tidak bisa diemulasikan lokal sehingga regresinya tidak bisa dibuktikan sebelum rilis.
- `fonts.css` tetap memblokir. Berkas ini dipakai 17 halaman, termasuk dashboard yang tidak
  memuat `site.css`, jadi menggabungkannya ke `site.css` memecah lima halaman.
- CSS kritis inline ditolak: blok `@font-face` yang membawa lisensi SIL OFL akan tersalin
  ke 17 berkas dan gampang melenceng dari aslinya.

## Dampak yang diharapkan

Satu permintaan render-blocking hilang di lima halaman (beranda, kos-sekitar, mitra,
sekitar, titip). Perkiraan penghematan 3,7 KB dan satu round trip; angka sesudahnya diukur
di produksi setelah merge, karena server lokal tidak menerapkan CSP maupun cache zona.
