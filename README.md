# Bonaasina: Kos Asina & Kos Bona

Website untuk calon penyewa, admin untuk pemilik, dan dashboard untuk penghuni.

| Bagian | Alamat | Untuk siapa |
| --- | --- | --- |
| Website | `/` | Calon penyewa: kamar kosong, harga per periode yang dibuka (harian/bulanan/6 bulanan/tahunan), fasilitas, lokasi, aturan, reservasi, daftar tunggu |
| Kos Sekitar | `/kos-sekitar/`, `/kos/?k=slug` | Calon penyewa: kos mitra di sekitar, detail kos, reservasi |
| Jadi mitra | `/mitra/` | Pemilik kos lain: keuntungan, kalkulator biaya layanan, formulir pendaftaran mitra |
| Reservasi saya | `/akun/` | Customer: status reservasi, bayar DP & unggah bukti, chat pemilik, refund, bukti booking PDF |
| Dashboard pemilik | `/pemilik/` | Pemilik kos mitra: reservasi masuk, konfirmasi & DP, chat, kamar & harga, info kos, fee |
| Admin | `/admin/` | Pemilik Bonaasina: menu Kos Sekitar (reservasi, persetujuan & refund, mitra kos, pemilik kos, fee & aturan, notifikasi), kamar, penghuni & akun login, kontrak, kondisi kamar, tagihan & kuitansi, pengumuman, piket, kerusakan, survei, daftar tunggu, laporan, log |
| Dashboard penghuni | `/penghuni/` | Penghuni: tagihan & kuitansi PDF, kontrak digital, kondisi kamar, piket, pengumuman, lapor kerusakan, kartu penghuni |
| Cek keaslian | `/cek/?k=…` | Siapa saja: memindai QR kartu penghuni/kuitansi |
| Live chat | tombol chat di `/`, `/kos-sekitar/`, `/titip/`, `/sekitar/`, `/mitra/`; admin menu *Live chat* | Calon penyewa: tanya lewat website (bot menjawab dulu, lalu admin) sebagai alternatif WhatsApp |

`/portal/` lama hanya mengalihkan ke `/penghuni/` (link portal lama sudah tidak berlaku).

## Arsitektur

```
Cloudflare Pages  ──  folder web/  (HTML/CSS/JS statis, tanpa build)
        │  fetch
        ▼
Supabase Edge Function "api"  ──  supabase/functions/api/index.ts
        │  kunci rahasia (hanya di server)
        ▼
Supabase Postgres (RLS aktif, tanpa akses langsung dari browser)
Supabase Storage: photos (publik) · private (bukti bayar, foto kerusakan/kondisi/piket/profil, PDF kontrak)
Supabase Auth: login admin
```

- Browser **tidak pernah** membaca tabel langsung. Semua lewat fungsi `api`, yang memeriksa siapa pemanggilnya.
- **Admin** masuk dengan email + kata sandi (Supabase Auth). Email harus terdaftar di tabel `admins`.
- **Penghuni** masuk dengan username + kata sandi yang dibuat admin (menu Penghuni → Buat akun, atau saat menambah penghuni). Kata sandi disimpan sebagai hash bcrypt; sesi berupa token acak di header `X-Tenant-Session` (hash di tabel `tenant_sessions`, berlaku 30 hari, diperpanjang otomatis). Mengganti kata sandi, menonaktifkan akun, atau mencatat penghuni keluar langsung mengakhiri semua sesinya. Halaman login admin juga menerima username penghuni dan mengarahkannya ke `/penghuni/`. Login penghuni dibatasi 10 percobaan gagal per 15 menit per IP.
- **Kontrak digital**: admin membuat kontrak dari templat (Pengaturan → Templat kontrak; tanda `{nama_penghuni}` dsb. diisi otomatis), penghuni menyetujui di dashboard (centang + ketik nama), lalu PDF final disimpan beserta waktu, perangkat, dan IP. 30 hari sebelum berakhir penghuni diminta memilih perpanjang/berhenti; admin melihatnya di Ringkasan & menu Kontrak. Templat bawaan adalah draf umum, **bukan nasihat hukum**, jadi sebaiknya ditinjau sebelum dipakai.
- **Kuitansi PDF** bernomor (`BNS/KW/tahun/urut`) terbit otomatis saat admin menandai tagihan lunas; berisi QR ke `/cek/`. Nomor kontrak `BNS/KTR/tahun/urut`.
- **Daftar tunggu**: calon penyewa mendaftar di website; saat kamar kosong (penghuni keluar atau status kamar diubah ke Kosong) pendaftar otomatis ditandai *Perlu dikabari* dan admin mengabari lewat tombol WhatsApp.
- **Piket**: tugas per kos (harian/mingguan/2 mingguan/bulanan), bergilir N orang per giliran atau bersama; penghuni mengirim foto bukti.
- Bukti bayar & foto kerusakan disimpan privat dan hanya bisa dilihat admin lewat tautan sementara (5 menit).

## Kos Sekitar (kemitraan) & reservasi
Kode: `supabase/functions/api/market.ts`, migrasi `20261018000001_kos_sekitar.sql`, halaman `web/kos-sekitar`, `web/kos`, `web/akun`, `web/pemilik`, komponen bersama `web/js/market-ui.js` & `web/js/booking.js`.

**Alur (sama untuk kos mitra dan Kos Asina/Bona):**
1. Customer mengirim reservasi (kamar opsional, periode, lama, tanggal masuk, 1–2 orang, boleh minta kunjungan). **Belum bayar apa pun.** Akun customer langsung dibuat: username `<namakos><5 angka>` (mis. `bona13323`), kata sandi bawaan acak 10 karakter (mis. `k7mpq-x4rtw`), tidak bisa ditebak dari username; wajib diganti saat pertama masuk (formulir ganti sandi punya kolom username untuk pengelola kata sandi).
2. Pemilik menekan *Kamar tersedia, minta DP*: memilih kamar, total sewa (otomatis harga × lama), DP (≥ minimum booking kos), dan batas bayar. Lalu *Kirim ke WhatsApp*: pesan berisi tautan `/akun/?u=…`, username, dan kata sandi bawaan (kata sandi bawaan disimpan hanya sampai customer menggantinya). Bisa juga *Tidak tersedia*.
3. Customer transfer DP **langsung ke rekening pemilik** dan mengunggah bukti. Lewat batas → otomatis *kedaluwarsa*.
4. Pemilik memastikan DP masuk → kamar jadi *Dipesan*; fee dihitung (persen dari DP atau nominal; per kos atau bawaan). Pemilik transfer fee ke rekening Bonaasina & unggah bukti.
5. Admin memeriksa kedua bukti → *Setujui*: bukti booking `BNS/BK/…` (QR ke `/cek/`) dan invoice fee `BNS/FEE/…` terbit. Kos Bonaasina sendiri: admin = pemilik, tanpa fee, langsung berhasil; tombol *Jadikan penghuni* mengisi data penghuni dari reservasi.
- **Refund** (setelah DP ditransfer): customer meminta (alasan + rekening) atau pemilik membatalkan → pemilik unggah bukti refund → customer konfirmasi diterima. Pemilik bisa menolak dengan alasan (aturan booking kos); customer bisa melaporkan ke admin, admin bisa meminta pemilik memproses atau menutup refund. Bila refund selesai, fee dibatalkan/dikembalikan ke pemilik.
- **Chat** per reservasi (diperbarui tiap 5 detik), bisa dimatikan per kos; tombol WhatsApp juga bisa dinyalakan/dimatikan. **Notifikasi** dashboard untuk admin, pemilik, dan customer.
- **Pendaftaran mitra**: pemilik kos mengisi formulir singkat di `/mitra/` (nama, WhatsApp, nama kos, kota, jumlah kamar, dll.) → masuk ke admin *Pendaftaran mitra* → *Setujui & buat akun* membuat akun pemilik + kos (draf) dan menyiapkan pesan WhatsApp berisi username & kata sandi sementara.
- Info kos & kamar (foto, harga, rekening, aturan) diisi **pemilik sendiri**; dashboard pemilik menampilkan daftar periksa. Setelah lengkap pemilik menekan *Minta ditampilkan di website* → admin menekan *Tampilkan di website*. Admin hanya mengatur status tampil, pemilik, dan fee.
- Semua username (penghuni, pemilik, customer) bisa masuk dari halaman login mana pun lewat `POST /masuk`; diarahkan ke dashboard masing-masing. Dibatasi 10 percobaan gagal per 15 menit per IP **dan** per akun.
- **Tambahan bila berdua** dicatat per bulan atau per tahun (kolom `extra_person_period`); perkiraan harga menghitungnya sesuai lama sewa.
- Pengaturan di admin → *Fee & aturan*: fee bawaan, rekening Bonaasina, batas bayar fee/DP, batas “belum direspons”, templat pesan WhatsApp.

**Uji alur API** (tanpa database sungguhan, klien Supabase palsu di memori):
```bash
cd tests && deno run -A --config deno.json kos-sekitar.flow.ts
```

## Live chat & bot (alternatif WhatsApp)
Kode: `supabase/functions/api/chat.ts` (API), `chatbot.ts` (bot & kamus), migrasi `20261024000003_live_chat.sql`, widget `web/js/livechat.js` + `web/css/livechat.css`, admin menu *Live chat* di `web/admin/admin.js`.

- **Pengunjung** membuka tombol chat di pojok kanan bawah (menggantikan tombol WhatsApp melayang; tautan WhatsApp tetap ada di dalam panel). **Bot sambutan** menyapa dan menawarkan pilihan topik (harga, kamar kosong, fasilitas, lokasi, aturan, survei, booking, pembayaran, bicara dengan admin). Pertanyaan yang ditulis bebas dipahami lewat kata kunci, termasuk singkatan (`brp hrg kmr`) dan salah ketik ringan. Jawaban diisi dari data website (`{harga}`, `{kamar_kosong}`, …), jadi selalu sama dengan halaman. Tanya jawab (FAQ) di Pengaturan ikut dikenali. Selama belum terhubung ke admin, tidak ada yang disimpan.
- **Bicara dengan admin** (atau bot tidak paham): pengunjung menulis nama panggilan (WhatsApp opsional). Server membuat percakapan dan token acak; browser menyimpannya di `localStorage`, server hanya menyimpan hash SHA-256 (header `X-Chat-Session`). Pertanyaan ke bot sebelumnya ikut tercatat (jawabannya dibuat ulang di server, bukan dari browser).
- Setelah terhubung, bot hanya ikut menjawab bila cukup yakin, dan diam selama 30 menit setelah admin membalas. Pembaruan memakai polling ringan (4 detik saat panel terbuka, 25 detik saat tertutup, berhenti saat tab disembunyikan), jadi tidak perlu akses langsung browser ke database dan tetap sesuai CSP.
- **Admin** → *Live chat*: kotak masuk (belum dibaca/terbuka/selesai), balas, tandai selesai, hapus (spam), tombol WhatsApp bila nomor diisi. Lencana menu + judul tab menghitung pesan belum dibaca (diperbarui tiap 20 detik di semua menu) dan muncul pemberitahuan kecil saat ada pesan baru; Ringkasan punya widget *Live chat*. Tab *Pengaturan*: tampilkan tombol, terima pesan, bot aktif, hari & jam layanan (WIB), sapaan, pesan di luar jam layanan. Tab *Kamus bot*: ubah/tambah topik, kata kunci, jawaban, tombol pilihan; *Coba bot* untuk menguji.
- Email ke admin (bila Resend aktif): saat percakapan baru dimulai, dan saat pengunjung menulis lagi setelah semua pesan dibaca (bukan setiap pesan).
- Batas: 5 percakapan baru per IP per jam, 12 pesan pengunjung per menit per percakapan, 60 pertanyaan bot per IP per 10 menit (per instance).

**Uji alur:** `cd tests && deno run -A --config deno.json chat.flow.ts`

## Notifikasi email (Resend)
Kode: `supabase/functions/api/mailer.ts`, migrasi `20261024000002_notifikasi_email.sql`, uji `tests/email.flow.ts`.

- Kolom **email opsional** di reservasi, daftar tunggu, pendaftaran mitra, data penghuni (admin), serta pengaturan akun di dashboard penghuni, pemilik, dan halaman reservasi. Admin menerima email di *Pengaturan → Email notifikasi admin* (kosong = email login admin).
- Yang dikirim: semua notifikasi dashboard Kos Sekitar (reservasi baru, kamar tersedia/ditolak, DP, fee, booking berhasil, refund, kunjungan, chat), tagihan baru, pengingat tagihan, bukti bayar masuk/ditolak, pembayaran lunas + nomor kuitansi, laporan kerusakan & statusnya, kontrak baru/disetujui/keputusan perpanjang, pengumuman, kamar kosong untuk daftar tunggu, survei, pendaftaran mitra, dan pemberitahuan keamanan (kata sandi diganti).
- **Kata sandi tidak pernah dikirim lewat email**; tetap lewat WhatsApp.
- Email dikirim di latar belakang, jadi gagal kirim tidak menggagalkan aksi pengguna. Setiap kiriman dicatat di tabel `email_log` dengan kunci unik (juga dipakai sebagai `Idempotency-Key` Resend) supaya tidak terkirim dua kali.
- Secret fungsi `api`: `RESEND_API_KEY` (wajib; tanpa ini email dilewati), `EMAIL_FROM` (bawaan `Bonaasina <notifikasi@kabar.bonaasina.my.id>`, domainnya harus terverifikasi di Resend), `EMAIL_REPLY_TO` (opsional). Pakai API key **Sending access** yang dibatasi ke domain itu, bukan Full access.

```bash
cd tests && deno run -A --config deno.json email.flow.ts
```

## Deploy

### 1. Supabase
1. Buat proyek **bonaasina** (region Singapore `ap-southeast-1`).
2. Jalankan semua file di `supabase/migrations/` berurutan, lalu `supabase/seed.sql`.
3. Deploy fungsi `supabase/functions/api` (`index.ts` + `docs.ts` + `market.ts`) dengan **verify JWT dimatikan** (fungsi memeriksa login sendiri). Opsional: secret `SITE_URL` (bawaan `https://bonaasina.my.id`) untuk logo PDF & alamat QR, serta secret email (lihat *Notifikasi email*).
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

Setiap `git push` ke `main` otomatis tayang. Setelah mengubah file JS/CSS, naikkan nilai `?v=` di tag `<script>`/`<link>` HTML supaya browser tidak memakai versi lama (zona Cloudflare menyimpan cache browser 4 jam). `web/_headers` mengatur header keamanan (termasuk HSTS dan Content-Security-Policy) dan cache. **Bila menambah layanan luar** (skrip, gambar, peta, atau API dari domain lain), tambahkan domainnya ke CSP di `_headers`, dan jangan menulis `<script>` inline karena akan diblokir; `web/404.html` dipakai untuk halaman tidak ditemukan.

### 4. Cek
```bash
node scripts/api-check.mjs https://<project-ref>.supabase.co/functions/v1/api
```

## Dipasang sebagai aplikasi (PWA)
Situs bisa dipasang ke layar utama Android/iPhone dan dibuka tanpa bilah alamat.

| Berkas | Isi |
| --- | --- |
| `web/manifest.webmanifest` | nama, ikon 192/512 + maskable, `display: standalone`, pintasan Kamar / Reservasi / Kos sekitar |
| `web/sw.js` | service worker: hanya mengurus perpindahan halaman dan halaman offline; aset situs tidak di-cache |
| `web/offline.html` | halaman "Tidak ada koneksi", gayanya ditulis di dalam berkas |
| `web/js/pwa.js` | mendaftarkan service worker setelah halaman selesai dimuat |
| `web/css/pwa.css` | jarak aman status bar saat mode aplikasi, dimuat paling akhir di setiap halaman |
| `web/assets/img/icon-192.png`, `icon-maskable-512.png` | ikon tambahan; ikon 512 memakai `icon-512.png` yang sudah ada |

- Semua halaman memasang `<link rel="manifest">`, meta `apple-mobile-web-app-*`, `viewport-fit=cover`, `css/pwa.css`, dan `js/pwa.js`. **Halaman baru wajib menyalin blok itu**, kalau tidak halaman tersebut tidak ikut terpasang sebagai aplikasi.
- `web/_headers` mengatur `/sw.js` dan `/offline.html` agar tidak di-cache, dan mengirim manifest sebagai `application/manifest+json`.
- Nilai di `css/pwa.css` memakai `env(safe-area-inset-*)` yang bernilai 0 di tab browser biasa, jadi tampilan web tidak berubah; yang terpengaruh hanya aplikasi terpasang.
- Service worker sengaja tidak menyimpan aset, jadi setiap deploy langsung terpakai. `_headers` meminta `no-cache` untuk `/sw.js`, tetapi pengaturan *Browser Cache TTL* zona ini (4 jam) menaikkan `max-age=0` pada JS/CSS menjadi `max-age=14400`; karena itu `js/pwa.js` mendaftar dengan `updateViaCache: 'none'` supaya versi baru `sw.js` tetap diperiksa lewat jaringan. Bila nanti aset ikut di-cache, naikkan `SHELL` di `sw.js` pada setiap perubahan.
- Yang disimpan hanya `offline.html` dan logonya. Bila browser menghapus Cache Storage, halaman itu disimpan ulang otomatis pada navigasi berikutnya yang berhasil; bila cache dan jaringan sama-sama tidak ada, worker menjawab dengan halaman teks sederhana, bukan galat browser.
- Memasang: Android Chrome ⋮ → *Instal aplikasi*; iPhone Safari Bagikan → *Tambahkan ke Layar Utama*.
- Memeriksa lokal: buka `http://127.0.0.1:<port>/` (bukan `file://`), lalu DevTools → Application: Manifest, Service Workers, Cache Storage.

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
- **Google Analytics 4**: ID di `web/js/config.js` (`ga4Id`). `web/js/analytics.js` mengirim page view dengan alamat bersih (tanpa `#` dan `?`), jadi parameter seperti kode `?k=` tidak terkirim. Dashboard penghuni mengirim page view per menu (`/penghuni/<menu>`). Admin mengirim page view per menu (`/admin/<menu>`). Event: `generate_lead` (formulir survei terkirim), `contact_whatsapp` (klik tautan WA), `page_not_found`.
- **Log aktivitas** (menu admin *Log aktivitas*, tabel `activity_log`): login/keluar dan percobaan gagal, semua perubahan data oleh admin, unduhan & bukti bayar yang dibuka, aktivitas penghuni di dashboard (login, bukti bayar, persetujuan kontrak, piket, unduhan), serta permintaan survei & daftar tunggu. Disimpan 180 hari, dihapus otomatis.
