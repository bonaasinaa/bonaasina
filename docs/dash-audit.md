# Audit dashboard, catatan putaran

Tiga permukaan di balik login (`/admin/`, `/pemilik/`, `/penghuni/`) diukur sebelum dan
sesudah satu perbaikan. Akun uji dibuat di produksi lalu dihapus lagi; tidak ada akun
yang tertinggal.

## Cara ukur

- Sesi didapat lewat API (`POST /admin/login`, `POST /masuk`), lalu kunci localStorage
  aplikasi diisi dan halaman dimuat ulang. Tidak ada kata sandi yang diketik ke form.
- Pengumpul yang sama dengan audit publik (`scripts/audit-ui.js` dari skill proyek),
  18 rute (14 admin, 4 pemilik, 1 penghuni) dikali dua lebar, 1440 dan 390.
- Tabel diukur terpisah: sel terakhir dibandingkan dengan tepi pembungkusnya, karena
  `scrollWidth` tidak menangkap kolom aksi yang tertinggal di luar layar.
- Data uji memakai kos `nonaktif` (`kos_audit`) sehingga tidak muncul di `api/public`.

## Temuan dan perbaikan

| Temuan | Bukti sebelum | Perbaikan |
| --- | --- | --- |
| Teks redup gagal kontras AA | `--mute #8C7769` = 4,24:1 di putih, 3,70:1 di kanvas, dipakai di header tabel, `.sub`, `.hint`, `.stat__sub`, `.kv dt`, `.empty`. 329 kejadian di 40 pengukuran | `--mute` digelapkan ke `#7B685C` = 5,28:1 di putih, 4,61:1 di kanvas |
| Tombol grup sidebar terlalu pendek | `button.side__group` 192x17 px, 84 kejadian, di bawah batas 24 px WCAG 2.5.8 | `min-height: 24px` pada `.side__group` dan `button.side__group` |

## Angka

| Ukuran | Sebelum | Sesudah |
| --- | --- | --- |
| Elemen keluar viewport | 0 | 0 |
| Teks terpotong | 0 | 0 |
| Kontras gagal, rasio bukan 1 | 329 | 0 |
| Kontras rasio 1 (lapisan, positif palsu) | 22 | 26 |
| Target di bawah 24 px | 100 | 41 |
| Tabel dengan sel terakhir di luar pembungkus | 0 | 0 |

Sisa 41 target di bawah 24 px sudah diperiksa satu per satu: 39 tautan sebaris di dalam
kalimat atau sel tabel (dikecualikan aturan ukuran target) dan 2 input 1x1 yang memang
disembunyikan untuk pembaca layar. Tidak ada aksi berdiri sendiri yang masih kecil.

## Yang belum diukur

- Interaksi tulis (menyimpan, mengunggah, menghapus) hanya dilihat dari tampilan, tidak
  dijalankan, supaya data uji tidak bercampur dengan data asli.
- Mode gelap tidak ada di dashboard ini, jadi tidak ada yang perlu diuji di sana.
- Pembaca layar dan perangkat asli belum diuji.
