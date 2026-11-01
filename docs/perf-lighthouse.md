# Lighthouse, catatan putaran

Lighthouse 13.6.0 dijalankan dengan Chromium bawaan Hermes: mode mobile bawaan untuk
beranda, `/kos/asina/`, dan satu putaran desktop untuk beranda. Pembanding kedua
adalah salinan branch yang disajikan lokal, jadi CSP tidak berlaku di sana (server
lokal tidak mengirim `_headers`).

Versi dibaca dari `lighthouseVersion` di setiap berkas laporan (ketujuhnya 13.6.0), karena `npx lighthouse` tanpa pin memasang versi terbaru tanpa pemberitahuan.

## Angka awal di produksi

| Halaman | Performa | Aksesibilitas | Praktik terbaik | SEO | LCP | CLS | TBT |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Beranda, mobile | 97 | 100 | 92 | 100 | 2,2 s | 0,003 | 100 ms |
| Beranda, desktop | 100 | 100 | 92 | 100 | 0,6 s | 0,024 | 0 ms |
| `/kos/asina/`, mobile | 96 | 100 | 92 | 100 | 2,7 s | 0,001 | 0 ms |

Nilai 92 di praktik terbaik berasal dari dua galat konsol, dan tiga temuan lain yang
bisa dibereskan tanpa mengubah desain.

## Yang ditemukan dan diperbaiki

| Temuan | Bukti | Perbaikan |
| --- | --- | --- |
| Skrip inline di halaman kos diblokir CSP | `<script>document.getElementById('year')...` di `/kos/asina/` dan `/kos/bona/`; tahun di footer tidak pernah terisi | Dipindah ke `web/js/tahun.js` |
| Beacon Cloudflare Web Analytics diblokir | `static.cloudflareinsights.com/beacon.min.js` melanggar `script-src` | Domain ditambahkan ke `script-src`, `cloudflareinsights.com` ke `connect-src` |
| Logo hero (LCP beranda) tidak diminta lebih awal | `lcp-discovery-insight` skor 0, `priorityHinted: false` | `<link rel="preload" as="image">` + `fetchpriority="high"` pada `#heroLogo` |
| Foto depan (LCP halaman kos) tanpa prioritas | `lcp-discovery-insight` skor 0 di `/kos/asina/` | `fetchpriority="high"` pada foto pertama, foto lain tetap `lazy` |
| Logo footer tanpa ukuran | `unsized-images` skor 0,5 | `aspect-ratio` + `object-fit` pada `.footer__logos img` |
| Foto unggahan di-cache 1 jam | `cache-insight` 437 KiB terbuang | `cacheControl: '31536000'` di `putFile` (path selalu bertimestamp, tidak pernah ditimpa) |

Penjaga baru `scripts/check-csp.mjs` ikut CI: menolak skrip inline di halaman mana pun
dan memeriksa setiap sumber skrip, gaya, dan gambar terhadap CSP di `web/_headers`.
Sudah diuji dua arah: dengan skrip inline disisipkan ia keluar 1 dan menunjuk
`kos/bona/index.html:198`, setelah dipulihkan keluar 0.

## Verifikasi lokal (branch, CSP tidak berlaku)

| Audit | Produksi | Branch (lokal) |
| --- | --- | --- |
| `unsized-images` beranda | 0,5 | 1 |
| `lcp-discovery-insight` beranda | 0 | 1 |
| `lcp-discovery-insight` `/kos/asina/` | 0 | 1 |
| `errors-in-console` beranda | 0 | 1 |
| Praktik terbaik beranda | 92 | 100 |

Skor performa lokal lebih rendah dari produksi (87 sampai 92 berbanding 96 sampai 100)
karena foto kamar diambil langsung dari Supabase tanpa cache edge Cloudflare dan
disk lokal tidak punya CDN. Yang dibandingkan di sini adalah audit per item, bukan
skornya.

## Belum diperbaiki, dengan alasannya

- **JavaScript tak terpakai 74 KiB** (GSAP, ScrollTrigger, Lenis). Ketiganya memikul
  animasi yang baru dipasang di batch sebelumnya; menundanya sampai interaksi akan
  membuat hero tidak beranimasi pada kunjungan pertama.
- **Empat CSS yang memblokir render** (site, fonts, pwa, livechat). Mengubahnya jadi
  non-blokir berisiko kilatan gaya sebelum CSS datang; perlu diuji dengan tangkapan
  layar, bukan hanya angka.
- **Pengiriman gambar**: foto unggahan disajikan seukuran aslinya (440 KiB terbuang di
  `/kos/asina/`, 87 KiB di beranda). Perlu transformasi gambar Supabase atau resize
  saat unggah, dan itu mengubah pipeline unggah, bukan markup.
- **`cache-insight` 437 KiB** hanya membaik untuk foto yang diunggah setelah perubahan
  ini; objek lama tetap 1 jam sampai diunggah ulang.
- **Skrip inline dari Cloudflare** (`/cdn-cgi/challenge-platform/scripts/jsd/main.js`)
  tidak bisa di-hash karena namanya memuat `ray` per permintaan. Satu galat konsol dari
  sumber ini akan tetap muncul; mematikannya berarti mematikan deteksi bot di zona.

## Verifikasi setelah merge

Lighthouse mobile ulang ke produksi untuk beranda dan `/kos/asina/`: `errors-in-console`
harus turun ke satu (hanya skrip Cloudflare), `unsized-images` dan
`lcp-discovery-insight` bernilai 1, dan praktik terbaik naik dari 92. Foto yang diunggah
baru harus menjawab `Cache-Control: max-age=31536000`.
