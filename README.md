# Bonaasina — Kos Asina & Kos Bona

Website untuk calon penyewa, admin untuk pemilik, dan portal untuk penghuni.

| Bagian | Alamat | Untuk siapa |
| --- | --- | --- |
| Website | `/` | Calon penyewa: kamar kosong, harga bulanan/tahunan, fasilitas, lokasi, aturan, survei |
| Admin | `/admin/` | Pemilik: kamar, penghuni, tagihan, bukti bayar, kerusakan, survei, laporan |
| Portal penghuni | `/portal/#…` | Penghuni: lihat tagihan, unggah bukti bayar, lapor kerusakan |

## Arsitektur

```
Cloudflare Pages  ──  folder web/  (HTML/CSS/JS statis, tanpa build)
        │  fetch
        ▼
Supabase Edge Function "api"  ──  supabase/functions/api/index.ts
        │  kunci rahasia (hanya di server)
        ▼
Supabase Postgres (RLS aktif, tanpa akses langsung dari browser)
Supabase Storage: photos (publik) · private (bukti bayar & foto kerusakan)
Supabase Auth: login admin
```

- Browser **tidak pernah** membaca tabel langsung. Semua lewat fungsi `api`, yang memeriksa siapa pemanggilnya.
- **Admin** masuk dengan email + kata sandi (Supabase Auth). Email harus terdaftar di tabel `admins`.
- **Penghuni** tidak perlu akun. Pemilik membuat link portal pribadi (`/portal/#token`) dari menu Penghuni lalu mengirimnya lewat WhatsApp. Token hanya disimpan dalam bentuk hash; membuat link baru mematikan link lama; link mati otomatis saat penghuni dicatat keluar.
- Bukti bayar & foto kerusakan disimpan privat dan hanya bisa dilihat admin lewat tautan sementara (5 menit).

## Deploy

### 1. Supabase
1. Buat proyek **bonaasina** (region Singapore `ap-southeast-1`).
2. Jalankan `supabase/migrations/20261016000001_init.sql`, lalu `supabase/seed.sql`.
3. Deploy fungsi `supabase/functions/api` dengan **verify JWT dimatikan** (fungsi memeriksa login sendiri).
4. Buat kode penyiapan admin sekali pakai (berlaku 24 jam), lalu buka `/admin/` → *Pertama kali masuk* untuk membuat kata sandi:
   ```sql
   insert into public.setup_codes (email, code_hash, expires_at)
   values ('bonaasinaa@gmail.com', encode(extensions.digest('KODE-RAHASIA-ANDA', 'sha256'), 'hex'), now() + interval '24 hours')
   on conflict (email) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at;
   ```
   Cara yang sama dipakai bila lupa kata sandi.

### 2. Alamat API
Isi `web/js/config.js` dengan alamat fungsi: `https://<project-ref>.supabase.co/functions/v1/api`. Proyek saat ini: `ncjecdnbrtsshqbxvddb` (organisasi bonaasinaa, region Sydney).

### 3. Cloudflare Pages
Workers & Pages → Create → Pages → *Connect to Git* → pilih repo **bonaasina** →
- Framework preset: **None**
- Build command: *(kosong)*
- Build output directory: **web**

Setiap `git push` ke `main` otomatis tayang. Setelah mengubah file JS/CSS, naikkan nilai `?v=` di tag `<script>`/`<link>` HTML supaya browser tidak memakai versi lama (zona Cloudflare menyimpan cache browser 4 jam). `web/_headers` mengatur header keamanan dan cache; `web/404.html` dipakai untuk halaman tidak ditemukan.

### 4. Cek
```bash
node scripts/api-check.mjs https://<project-ref>.supabase.co/functions/v1/api
```

## Pengembangan lokal (opsional)
Butuh [Supabase CLI](https://supabase.com/docs/guides/local-development) dan Docker:
```bash
supabase start                  # Postgres + Auth + Storage lokal, migrasi & seed otomatis
supabase functions serve api    # API di http://127.0.0.1:54321/functions/v1/api
```
Lalu arahkan `web/js/config.js` ke alamat lokal itu dan buka folder `web/` dengan server statis apa pun.

## Data awal
`seed.sql` berisi 2 kos dan 14 kamar **contoh** (8 Asina, 6 Bona), nomor WA, dan rekening contoh. Admin menampilkan pengingat sampai pemilik menekan *Sudah saya perbarui*.

## Desain
- Warna dari logo: krem `#F7EDE3`, merah ulos `#8E1B1B`, hitam gorga `#24160F`.
- Huruf: Libre Caslon Display (judul) + Plus Jakarta Sans (teks), disimpan di `web/fonts` (lisensi OFL).
- Pola dari melius.com: judul dengan kata berganti, marquee, showcase bertab, toggle harga, FAQ akordeon. Elemen khas: pita ulos bertenun.
- Animasi berhenti bila perangkat meminta "kurangi gerakan". GSAP & Lenis disimpan di `web/vendor`.

## Catatan pajak
Penghasilan kos dikecualikan dari PPh final 10% sewa bangunan (PP 34/2017 Pasal 2 ayat 3) dan diperlakukan sebagai penghasilan usaha. Pajak daerah (PBJT) bergantung Perda setempat. Pastikan ke KPP/konsultan.

## Analitik & log aktivitas
- **Google Analytics 4**: ID di `web/js/config.js` (`ga4Id`). `web/js/analytics.js` mengirim page view dengan alamat bersih (tanpa `#` dan `?`), jadi token portal penghuni tidak pernah terkirim. Admin mengirim page view per menu (`/admin/<menu>`). Event: `generate_lead` (formulir survei terkirim), `contact_whatsapp` (klik tautan WA), `page_not_found`.
- **Log aktivitas** (menu admin *Log aktivitas*, tabel `activity_log`): login/keluar dan percobaan gagal, semua perubahan data oleh admin, unduhan & bukti bayar yang dibuka, akses portal penghuni, dan permintaan survei. Disimpan 180 hari, dihapus otomatis.
