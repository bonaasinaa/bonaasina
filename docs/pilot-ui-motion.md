# Pilot UI/motion, Bonaasina

Catatan satu putaran kerja: enam langkah (docs, design system, komponen, gerak, audit,
verifikasi) dijalankan pada situs ini sebagai proyek percontohan. Isinya angka yang
diukur, bukan rencana.

Ruang lingkup: beranda (`web/index.html`) dan `web/js/site.js`. Halaman lain tidak
disentuh. `DESIGN.md` tidak diubah karena arah visualnya sudah ditetapkan pemilik.

## 1. Docs

Sumber pustaka yang dipakai situs ini dibaca ulang, bukan dari ingatan:

- GSAP `3.15.0` dan ScrollTrigger `3.15.0` di `web/vendor/`, Lenis `1.3.27`. Ketiganya
  versi terkini, jadi tidak ada API usang yang perlu diganti.
- Lisensi dulu dicek karena GSAP bukan MIT: sejak 30 April 2025 GSAP memakai
  "Standard No Charge License" yang membolehkan pemakaian komersial, termasuk plugin
  yang dulu berbayar. Yang dilarang hanya memakainya di dalam pembuat animasi visual
  tanpa kode yang bersaing dengan Webflow. Pemakaian di situs ini aman.
- Dokumentasi Lenis dan GSAP diambil lewat Context7 (`/websites/gsap`,
  `/darkroomengineering/lenis`). Keluarannya berupa cuplikan dari dokumentasi resmi
  dengan tautan sumber. Untuk dua hal yang dipakai di bawah, isi dokumentasi resmi
  yang lengkap (README Lenis dan halaman ScrollTrigger) tetap jadi rujukan utama
  karena cuplikan Context7 tidak selalu mengenai bagian yang dicari.

## 2. Design system (ui-ux-pro-max)

Alat ini dijalankan dengan dial variance 3, motion 2, density 4, untuk kategori
"boarding house listing". Hasil yang relevan:

| Keluaran | Isi | Keputusan |
| --- | --- | --- |
| Pola halaman | Marketplace / Directory: hero, kategori, daftar unggulan, kepercayaan, ajakan jadi mitra | Dipertahankan. Beranda sudah memuat kelima bagian itu (hero, dua rumah, kamar dan harga, cara menyewa, survei/tanya) |
| Gaya | Minimalism & Swiss Style, biaya performa rendah | Sesuai arah yang sudah ada |
| Gerak | Scroll reveal halus: opacity 0 ke 1, geser 12 px, 300 sampai 400 ms, `power1.out`, mulai `top 90%` | Diadopsi, dengan jarak 14 px dan mulai `top 88%` |
| Tipografi | Inter dan Playfair Display | Ditolak. Situs memakai Libre Caslon Display dan Plus Jakarta Sans yang disimpan sendiri karena CSP ketat |
| Warna | Hijau `#059669` dan turunannya | Ditolak. Palet diturunkan dari logo (krem, merah ulos, hitam gorga) dan sudah tertulis di `DESIGN.md` |

Kesimpulan langkah ini: jangan membuat design system kedua. `DESIGN.md` tetap satu
satunya sumber arah visual. Yang diambil dari alat ini hanya rekomendasi gerak dan
daftar periksa sebelum rilis (kontras 4,5:1, fokus terlihat, reduced motion, lebar
375/768/1024/1440).

## 3. Komponen (React Bits, Magic UI, shadcn)

Ketiganya menyediakan komponen React yang dipasang lewat registry shadcn. Situs ini
HTML, CSS, dan JavaScript tanpa proses build dan tanpa React, jadi tidak ada satu pun
komponen yang bisa dipasang apa adanya, dan memasang React hanya untuk empat efek
tidak sepadan dengan biayanya.

Yang dipakai adalah idenya, ditulis ulang dalam bentuk yang sudah ada di sini:

- BlurFade (Magic UI) menjadi reveal berbasis ScrollTrigger di `site.js` (langkah 4).
- Marquee (Magic UI) sudah ada sebagai pita ulos berjalan lambat.
- Hover lift dan transisi 200 sampai 250 ms sudah ada di `.btn`, `.near__card--titip`,
  dan kartu galeri.
- Registry React Bits dan Magic UI tidak dipakai di repo ini, jadi tidak ada berkas
  berlisensi MIT + Commons Clause yang ikut masuk. Kalau nanti dibutuhkan di proyek
  React lain, batasnya jelas: boleh dipakai komersial, tidak boleh dijual ulang
  sebagai komponen.

## 4. Gerak (GSAP dan Lenis)

Tiga perubahan di `web/js/site.js`:

1. Lenis diputar oleh `gsap.ticker`, bukan loop `requestAnimationFrame` sendiri, dan
   `lagSmoothing(0)` dipasang. Sebelumnya ada dua jam animasi berjalan bersamaan.
   Kalau GSAP tidak ada, loop `requestAnimationFrame` lama tetap dipakai.
2. Reveal `[data-reveal]` dengan `ScrollTrigger.batch`, `once`, `duration .4`,
   `power1.out`, `stagger .06`, mulai `top 88%`.
3. `ScrollTrigger.refresh()` setelah `load` dan setelah font siap, karena tinggi
   halaman berubah setelah foto dan daftar kamar masuk.

Di `web/index.html`, atribut `data-reveal` dipasang pada enam bagian di bawah hero
(`rumah`, `kamar`, `cara`, `lokasi`, `survei`, `tanya`) dan token `js/site.js?v=`
dinaikkan ke `20261101a`.

Aturan yang dijaga: keadaan tersembunyi hanya dipasang kalau GSAP dan ScrollTrigger
siap dan gerak tidak dimatikan, dan `try/catch` membersihkan properti kalau animasi
gagal dibuat. Tidak ada CSS yang menyembunyikan isi halaman.

## 5. Audit dan pengukuran

Alat: `scripts/audit-ui.js` dari skill proyek untuk 4 halaman x 5 lebar (1440, 1024,
768, 414, 375), ditambah pengukuran khusus gerak. Pembanding adalah `origin/main`
yang disajikan terpisah di port lain.

| Ukuran | Sebelum (`origin/main`) | Sesudah (branch) |
| --- | --- | --- |
| Elemen keluar viewport | 0 | 0 |
| Teks terpotong (klaim mentah) | 3 | 3 |
| Target di bawah 44 px (klaim mentah) | 116 | 116 |
| Kontras gagal (klaim mentah) | 20 | 20 |
| CLS beranda, 3 pengukuran | 0,0160 | 0,0161 |
| Bagian masih tersembunyi setelah scroll penuh | tidak ada target | 0 dari 6 |
| `prefers-reduced-motion: reduce` | tidak ada target | 6 dari 6 terlihat |
| GSAP diblokir | tidak ada target | 6 dari 6 terlihat |
| Panggilan `requestAnimationFrame` per detik saat diam | 125 | 64 |

Catatan kejujuran atas angka di tabel:

- Tiga klaim teks terpotong adalah positif palsu yang sudah diperiksa: `span.line`
  hanya melebar 3 px karena span pengukur tersembunyi di `.rotator` (setelah span itu
  dibuang, `clientWidth == scrollWidth` di 375 px), dan `.availability__long` adalah
  elemen 1x1 untuk pembaca layar.
- 116 target kecil hampir semuanya tautan di dalam kalimat dan kotak centang di dalam
  label, yang memang bukan target sentuh yang berdiri sendiri.
- 20 kontras gagal semuanya berasio 1 karena pemindai membandingkan tinta dengan
  tintanya sendiri pada tombol dan tab berlapis.
- CLS tidak berubah. Satu pergeseran 0,016 sudah ada sebelumnya, berasal dari teks bar
  ketersediaan yang berganti dari "Memuat" ke jumlah kamar sebenarnya.
- `requestAnimationFrame` turun dari 125 ke 64 per detik karena satu loop animasi
  dihapus. Jumlah event scroll dan waktu tempuh ke dasar halaman tidak berubah, jadi
  ini soal efisiensi, bukan kecepatan yang lebih terasa.

Tidak diukur di putaran ini: halaman di balik login (admin, pemilik, penghuni),
Lighthouse lab, dan perangkat asli.

## 6. Penjagaan dan rilis

- `node scripts/check-comments.mjs --strict`: 0 pelanggaran, 0 catatan blok.
- `node scripts/check-ui.mjs`: 0 masalah.
- Perubahan hanya di `web/js/site.js`, `web/index.html`, dan berkas catatan ini. Merge
  ke `main` menerbitkan ulang situs lewat Cloudflare Pages.
