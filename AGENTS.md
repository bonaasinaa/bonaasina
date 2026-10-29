# Panduan kerja agen

Repo ini: **Bonaasina**, situs kos (Kos Asina & Kos Bona) di Sipoholon. HTML/CSS/JS statis di `web/` tanpa build, Supabase Edge Function di `supabase/functions/api/`, uji alur di `tests/`.

## Sebelum mengubah apa pun

- Baca `README.md` untuk peta halaman, alur reservasi, dan perintah uji.
- Sebelum mengubah tampilan, baca `DESIGN.md` untuk arah visual (palet, tipografi, motif, dial).
- Semua teks untuk pengguna memakai Bahasa Indonesia. Jangan menambah teks Inggris kecuali istilah teknis.
- Jangan mengubah skema database atau menjalankan migrasi tanpa persetujuan pemilik.

## Perintah

```bash
node scripts/check-comments.mjs          # periksa komentar
node scripts/check-comments.mjs --strict # sekaligus gagalkan blok komentar > 2 baris
cd tests && deno run -A --config deno.json kos-sekitar.flow.ts
node scripts/api-check.mjs https://<ref>.supabase.co/functions/v1/api
```

<!-- antislop:start -->
## antislop

Untuk pekerjaan copy/teks atau komentar kode, baca `antislop.md` (inti) lalu skill sesuai tugas:

- Copy & teks: `skills/antislop-copywriting/SKILL.md` (versi Indonesia: `skills/antislop-copywriting/references/indonesian.md`)
- Komentar kode: `skills/antislop-code/SKILL.md`

Sebelum mulai, ikuti bagian "Two Usage Modes" di file inti dengan urutan ketat: instruksi sesi lebih dulu, lalu preferensi global, lalu tanya. Instruksi sesi selalu menang. Untuk mode yang sudah ditetapkan, ucapkan `antislop active: <mode> (session override).` atau `antislop active: <mode> (global preference).` sekali sebelum menyampaikan temuan atau mengedit, memakai mode dan sumber yang sebenarnya. Mengiyakan permintaan pengguna tanpa menyebut sumbernya tidak menggantikan pemberitahuan ini.

Hanya pilihan eksplisit antislop selama atau setelah sesi yang menetapkan mode sesi. Permintaan untuk meninjau, mengaudit, atau tidak mengedit file tidak menetapkan mode; baca preferensi global dalam hal itu. Mode skill lain tidak menetapkan mode antislop.

Bila mode belum jelas, tanyakan dan akhiri respons; tunggu jawabannya sebelum meninjau UI, menyusun rencana, atau membuat konsep. Untuk tugas baca saja, taruh pemberitahuan mode hanya di awal jawaban akhir, jangan di pesan proses. Untuk tugas mengedit, umumkan sebelum edit pertama dan hilangkan dari jawaban akhir.

Untuk memperbarui antislop nanti: unduh ulang `antislop.md`, atau jalankan `npx antislop-ai --update` bila dipasang sebagai folder skill. Versi terpasang tercatat di `skills/VERSION`.
<!-- antislop:end -->
