-- Data awal Bonaasina: dua kos, kamar CONTOH, dan pengaturan. Kamar, harga, alamat, dan nomor WA masih contoh,
-- ubah lewat halaman admin. Ganti email admin di baris terakhir bila perlu.

insert into public.settings (id, data) values (1, $json${
  "isSample": true,
  "siteName": "Bonaasina",
  "tagline": "Kos Asina & Kos Bona — kamar bersih dengan harga jelas, dikelola langsung oleh pemiliknya.",
  "ownerName": "Pemilik Bonaasina",
  "whatsapp": "081200000000",
  "heroWords": ["tenang", "bersih", "aman", "dekat"],
  "surveyHours": "Setiap hari, 09.00–18.00",
  "depositInfo": "Deposit setara 1 bulan sewa, dikembalikan saat keluar setelah kamar dicek.",
  "paymentMethods": "Transfer bank, QRIS, atau tunai ke pengelola.",
  "paymentInfo": "Bank Contoh 1234567890 a.n. Pemilik Bonaasina",
  "invoiceLeadDays": 7,
  "reminderTemplate": "Horas {nama}, ini pengingat dari {kos}.\n\nTagihan sewa kamar {kamar} untuk periode {periode} sebesar {jumlah} jatuh tempo {jatuh_tempo}.{keterlambatan}\n\nPembayaran bisa ditransfer ke:\n{rekening}\n\nSetelah bayar, unggah bukti transfer di portal penghuni Anda:\n{portal}\n\nTerima kasih.",
  "faq": [
    {"q": "Apakah boleh survei dulu sebelum membayar?", "a": "Boleh, dan kami sarankan. Pilih tanggal di formulir survei, nanti kami konfirmasi lewat WhatsApp."},
    {"q": "Bisa sewa bulanan atau harus tahunan?", "a": "Keduanya bisa. Sewa tahunan dibayar di muka dan harganya lebih hemat dibanding 12 kali bayar bulanan."},
    {"q": "Apakah ada deposit?", "a": "Ada, setara 1 bulan sewa. Deposit dikembalikan saat Anda keluar setelah kamar dicek bersama."},
    {"q": "Kapan jatuh tempo pembayaran?", "a": "Setiap bulan pada tanggal yang sama dengan tanggal Anda mulai menempati kamar. Pengingat dikirim lewat WhatsApp."},
    {"q": "Saya sudah ngekos di sini. Bagaimana cara melihat tagihan?", "a": "Setiap penghuni mendapat link portal pribadi lewat WhatsApp. Di portal itu Anda bisa melihat tagihan, mengunggah bukti bayar, dan melaporkan kerusakan kamar."}
  ]
}$json$::jsonb)
on conflict (id) do nothing;

insert into public.properties (id, slug, sort, name, short_name, logo, gender, tagline, description, address, facilities, rules, nearby) values
('asina', 'asina', 1, 'Kos Asina', 'Asina', '/assets/img/logo-asina.webp', 'Putri',
 'Lebih tenang, cocok untuk yang kuliah atau bekerja.',
 'Kos Asina punya halaman depan yang luas dan jemuran beratap. Kamar menghadap ke kebun, jadi pagi hari terasa sejuk. (Deskripsi contoh — ganti di admin.)',
 'Alamat Kos Asina (isi di admin)',
 array['WiFi','Air bersih 24 jam','Dapur bersama','Jemuran beratap','Parkir motor','CCTV area depan'],
 array['Tamu lawan jenis hanya sampai ruang tamu','Pintu pagar dikunci pukul 22.00','Jaga kebersihan dapur bersama setelah dipakai','Lapor ke pengelola jika ada tamu menginap'],
 array['Pasar — 5 menit','Puskesmas — 7 menit','Jalan lintas — 3 menit']),
('bona', 'bona', 2, 'Kos Bona', 'Bona', '/assets/img/logo-bona.webp', 'Putra',
 'Kamar lebih luas, dekat jalan utama.',
 'Kos Bona berada dekat jalan utama dengan akses mudah ke angkutan umum. Beberapa kamar sudah punya kamar mandi dalam. (Deskripsi contoh — ganti di admin.)',
 'Alamat Kos Bona (isi di admin)',
 array['WiFi','Air bersih 24 jam','Parkir motor luas','Ruang santai','Galon isi ulang'],
 array['Dilarang membawa minuman keras','Jam tenang mulai pukul 22.00','Tamu menginap wajib lapor pengelola','Kendaraan diparkir di area yang disediakan'],
 array['Halte angkutan — 2 menit','Minimarket — 4 menit','Pasar — 8 menit'])
on conflict (id) do nothing;

-- 8 kamar Asina, 6 kamar Bona; setiap kamar ke-3 punya kamar mandi dalam
insert into public.rooms (id, property_id, code, type, size_m2, floor, price_monthly, price_yearly, facilities, note)
select
  'rm_' || lower(p.prefix) || lpad(n::text, 2, '0'),
  p.id,
  p.prefix || '-' || lpad(n::text, 2, '0'),
  case when n % 3 = 0 then 'Kamar mandi dalam' else 'Kamar mandi luar' end,
  case when n % 3 = 0 then '3 × 4 m' else '3 × 3 m' end,
  case when n <= ceil(p.total / 2.0) then 'Lantai 1' else 'Lantai 2' end,
  p.base + case when n % 3 = 0 then 150000 else 0 end,
  round(((p.base + case when n % 3 = 0 then 150000 else 0 end) * 11) / 50000.0) * 50000,
  case when n % 3 = 0 then array['Kasur & bantal','Lemari','Meja belajar','Kamar mandi dalam'] else array['Kasur & bantal','Lemari','Meja belajar'] end,
  case when n % 3 = 0 then 'Listrik token per kamar' else 'Listrik sudah termasuk' end
from (values ('asina','A',8,550000), ('bona','B',6,600000)) as p(id, prefix, total, base),
     generate_series(1, 8) as n
where n <= p.total
on conflict (id) do nothing;

insert into public.admins (email) values ('bonaasinaa@gmail.com') on conflict do nothing;
