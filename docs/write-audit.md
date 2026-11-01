# Uji tulis dashboard, catatan putaran

Endpoint tulis dijalankan seperti dashboard memanggilnya, hanya pada baris uji
(`kos_audit`, status `nonaktif`) milik akun audit sekali pakai. Setiap pemeriksaan
membandingkan status balasan dengan hasil baca ulang, bukan hanya kode 200.

## Hasil

| Peran | Yang diuji | Hasil |
| --- | --- | --- |
| Pemilik | ubah status kamar, tandai kos sudah dicek, kirim kos untuk ditinjau | 2 lolos, 1 ditolak dengan alasan yang benar |
| Penghuni | lapor kerusakan, tanggapi lewat admin, simpan email | lolos |
| Admin | lapor kerusakan (baca, ubah status, tutup), kamar (tambah, ubah, hapus, baca ulang), tagihan (buat, lunas, batal lunas, hapus) | lolos |
| Validasi | kamar tanpa kode, status laporan ngawur, laporan tanpa judul, tagihan tanpa penyewa | 400 dengan pesan Indonesia, bukan 500 |

24 pemeriksaan, satu cacat nyata.

## Cacat yang ditemukan dan diperbaiki

**Harga kamar negatif atau bukan angka tersimpan sebagai 0 tanpa peringatan.**
Dibuktikan langsung ke API produksi: `POST /admin/rooms` dengan
`priceMonthly: -5000` menjawab 201 dan tersimpan `0`; dengan `"abc"` juga tersimpan
`0`. Akibatnya salah ketik admin berubah menjadi kamar gratis yang tayang di situs,
bukan pesan kesalahan.

Perbaikan: `roomFromBody` memakai `harga()` yang menolak nilai negatif dan bukan
angka dengan 400 (`Harga bulanan tidak boleh negatif atau bukan angka.`), mengikuti
pola `depositDeduction` yang sudah ada. Nilai 0 dan kosong tetap diterima.

Uji: `tests/harga-kamar.flow.ts`. Dijalankan merah dulu (201 untuk harga negatif),
lalu hijau setelah perbaikan. Lima flow test lain tetap lolos.

## Yang bukan cacat

- `POST /pemilik/properties/:id/submit` menjawab 400 "Lengkapi dulu: alamat, minimal
  1 foto, rekening untuk DP" karena kos uji memang tidak punya alamat, foto, dan
  rekening. Itu gerbang validasi yang benar.
- Pemeriksaan "status kamar terbaca" awalnya gagal karena skrip uji mencari
  `properties[].rooms`; `GET /pemilik/me` mengembalikan `rooms` di tingkat atas.
  Yang salah skripnya, bukan aplikasinya.

## Yang tidak diukur

- Unggah berkas (foto kamar, bukti bayar, foto laporan). Endpoint-nya butuh multipart
  dan hasil unggahnya tertinggal di storage, jadi perlu jalur hapus yang belum ada.
- Efek samping surel: perubahan status laporan memicu `mail.send`, tetapi akun uji
  memakai email kosong sehingga tidak ada surat terkirim.
- Jalankan bersamaan (dua admin menyimpan hal yang sama).

## Bersih-bersih

Setelah pengujian: sesi, penghuni, kamar, kos, pemilik, admin, dan 24 baris log
aktivitas dihapus lewat skrip yang sama dengan putaran sebelumnya, berkas kredensial
lokal dihapus, dan `api/public` kembali hanya memuat Kos Asina dan Kos Bona.
