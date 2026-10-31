# DESIGN.md, Bonaasina

Dial: ENERGY 2 / RHYTHM 3 / MOTION 2

File ini mencatat arah visual yang **sudah dipakai** situs ini, dibaca dari `web/css/site.css`, `web/css/dash.css`, `web/css/fonts.css`, dan `web/index.html`. Isinya bukan usulan arah baru. Kalau ada yang tidak sesuai maksud Anda, ubah di sini dulu, lalu kode dan CSS mengikuti.

Aturan antislop ada di `antislop.md`. File ini hanya arah: identitas, palet, tipografi, motif, gerak, dan suara copy.

## Identitas

Bonaasina mengelola dua kos di Sipoholon, Tapanuli Utara: Kos Asina (campur) dan Kos Bona (khusus putri), keduanya dekat Kampus IAKN Tarutung. Ini bukan produk perangkat lunak. Yang dijual adalah kamar yang bisa dilihat, harga per periode yang jelas, dan pemilik yang bisa dihubungi lewat WhatsApp.

Wataknya: rumah Batak yang rapi. Hangat, tenang, dan jujur soal harga serta fasilitas. Tidak mewah, tidak teknologis, tidak berteriak.

Arah ini punya asal yang bisa ditunjuk: warna diambil langsung dari logo (krem latar, merah ulos, hitam gorga), dan pemiliknya sendiri yang memutuskan arah visualnya.

## Palet

Tiga warna inti ditambah satu aksen. Sisanya netral.

| Peran | Nilai | Alasan |
| --- | --- | --- |
| Latar | `--cream #F7EDE3` | Krem dari latar logo, lebih hangat daripada putih dan tidak menyilaukan di layar ponsel |
| Permukaan | `--paper #FFFBF6` | Putih gading untuk kartu dan panel, supaya kartu terpisah dari latar tanpa bayangan |
| Tinta | `--ink #24160F` | Hitam gorga yang hangat, dipakai untuk teks dan tombol utama |
| Aksen | `--red #8E1B1B` (gelap `#6E1212`) | Merah ulos. Hanya untuk satu hal penting per layar: tombol utama, penanda aktif, fokus keyboard |
| Teks sekunder | `--ijuk #6B4B3A` | Cokelat ijuk, dipakai untuk keterangan dan label |
| Status | `--green #2F6B3F` | Hanya untuk status kamar kosong. Bukan warna dekoratif |

Hijau dan kuning (`--amber #8A5A0B`) tidak boleh dipakai untuk memperindah, hanya untuk status.

## Tipografi

- **Judul: Libre Caslon Display** (serif, 400). Alasan: memberi nada rumah dan cetakan, bukan nada aplikasi. Dipakai untuk `h1` dan `h2` dengan ukuran `clamp(2.1rem, 4.6vw, 3.6rem)` dan `line-height` 1.05.
- **Teks: Plus Jakarta Sans** (400, 500, 600, 700). Alasan: huruf tanpa kait yang ramah dan terbaca di ponsel berukuran kecil, dan mendukung huruf Indonesia sehari-hari.
- Font disimpan sendiri di `web/fonts/`, bukan dari Google Fonts, karena CSP situs ini ketat dan tidak boleh memuat font dari domain lain. Lisensi SIL OFL ada di folder yang sama.
- `h3` memakai sans 600, bukan serif. Serif hanya untuk judul bagian.

## Skala dan jarak

Diambil dari `web/css/dash.css` (dashboard) dan skala publik:

- Teks: delapan langkah **11, 12, 13, 14, 16, 20, 24, 32 px**. 11 untuk label mikro, 12 keterangan dan header tabel, 13 label dan chip, 14 teks utama, 16 sub-judul panel dan isian, 20 ke atas untuk judul (`clamp` untuk judul halaman). Tidak ada setengah langkah seperti 13.5 px; `scripts/check-ui.mjs` menolak ukuran di luar daftar ini.
- Jarak: kelipatan 4 px.
- Radius: **enam nilai, tidak lebih**. Pil 999 px (tombol dan chip publik). Panel dan dialog 24 px. Kartu, gambar, dan item daftar 16 px. Kolom isian 14 px. Kontrol dashboard 12 px. Kontrol kecil 10 px.
- Di bawah 10 px hanya untuk detail mikro: swatch legenda, batang grafik, kode inline. Satu pengecualian yang disengaja: bingkai ponsel contoh di `/mitra/` 36 px, karena itu gambar perangkat, bukan permukaan UI.
- Nilai 18, 20, 22, 26, 28, dan 32 sudah dihapus dan dipetakan ke 16 atau 24. Jangan menambah nilai baru; kalau butuh, ubah daftar ini dulu.
- Lebar isi publik: `--max 1240px`, gutter `clamp(16px, 4vw, 56px)`.
- Kurva gerak: `cubic-bezier(.22, .8, .2, 1)`.

Dua bahasa bentuk itu disengaja. Halaman publik dipakai calon penyewa di ponsel, jadi tombolnya besar dan berbentuk pil. Dashboard dipakai kerja data berjam-jam, jadi kontrolnya lebih rapat dan bersudut.

## Motif identitas

Satu motif yang diulang, bukan hiasan acak: **pita ulos**.

- Pita gelap (`--ink`) dengan teks serif berjalan lambat (48 detik per putaran), penanda belah ketupat merah, dan rumbai di tepi bawah.
- Warnanya sama dengan judul dan tombol utama, jadi pita ini terasa bagian dari halaman, bukan tempelan.
- Ini satu-satunya elemen dekoratif yang bergerak sendiri. Selain ini, gerak hanya dipakai untuk memandu perhatian.

Motif yang benar-benar digambar di CSS hanya pita ulos. Istilah gorga dipakai sebagai nama warna tinta, bukan pola ukir yang digambar ulang di halaman.

## Gerak

MOTION 2. Gerak dipakai untuk memandu, bukan menghibur:

- Reveal saat bagian masuk layar (GSAP ScrollTrigger, hanya di layar lebar).
- Logo hero bergerak sedikit saat halaman digulir (`yPercent` 10, `scale` .94).
- Gulir halus lewat Lenis.
- Kata di judul berganti sendiri di antara `tenang`, `bersih`, `aman`, `dekat`, dengan lebar kotak mengikuti kata aktif supaya titik di belakangnya tetap rapat.
- Semua gerak berhenti di `@media (prefers-reduced-motion: reduce)`, termasuk pita ulos.
- GSAP dan Lenis dimuat secara opsional. Kalau gagal dimuat, halaman tetap berfungsi tanpa animasi dan tanpa gulir halus.

Jangan menambah parallax berat, animasi masuk untuk setiap kartu, atau gerak yang tidak bisa dimatikan.

## Aturan yang tidak boleh dilanggar

- Fokus keyboard selalu terlihat: `outline: 3px solid var(--red)` dengan `offset` 3 px. Jangan pernah `outline: none` tanpa pengganti.
- Ada tautan lewati ke konten (`.skip`) di atas halaman.
- Kontras teks memenuhi WCAG AA pada latar krem dan gading. Teks sekunder memakai `--ijuk`, bukan abu-abu pucat. Angka yang diukur: tinta di krem 15,19:1, tinta di gading 17,03:1, ijuk di krem 6,75:1, ijuk di gading 7,57:1, gading di merah 8,77:1, krem di tinta 15,19:1. Semua di atas 4,5:1.
- Satu aksen merah per layar. Merah bukan warna hiasan.
- Harga selalu ditampilkan sebagai angka nyata per periode. Tidak ada angka hiasan, tidak ada testimoni atau statistik karangan.
- Gambar yang belum ada ditandai jujur sebagai bingkai kosong (`.ph`), bukan diganti foto stok.

## Suara copy

Bahasa Indonesia, kalimat pendek, menyebut benda dan angka nyata. Menyapa dengan "Horas" di pesan WhatsApp.

Contoh yang sudah dipakai dan menjadi acuan nada:

- "Pulang ke kamar yang tenang."
- "Dua rumah, satu pengelola."
- "Kamar yang Anda mau penuh?"
- "Lihat kamar & harga", "Tanya lewat WhatsApp", "Buka daftar tempat".

Yang dihindari: kata seperti "solusi", "terpercaya", "modern dan canggih", "harga terjangkau" tanpa angka. Sebut nominal dan periode, atau tidak usah sama sekali.

## Catatan teknis

- Tanpa build. HTML, CSS, dan JS statis di `web/`, diunggah apa adanya ke Cloudflare Pages.
- CSP ketat: tanpa skrip sebaris, tanpa gaya dari domain lain, font lokal.
- Tema: situs publik memakai latar terang hangat sebagai identitas, bukan pilihan "terlihat teknologi". Dashboard juga terang, karena dipakai di siang hari untuk membaca tabel.
- Kontrol dashboard 40 px dan 34 px untuk kontrol sekunder, di bawah pedoman 44 px milik antislop R-03 meski masih lolos WCAG 2.2 AA (24 px). Kalau target sentuh dashboard ingin dinaikkan, ubah `--ctl` dan `--ctl-sm` di `web/css/dash.css`.
