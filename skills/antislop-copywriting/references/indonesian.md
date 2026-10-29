# Indonesian product copy: what actually reads as slop

Apply the core rules in Indonesian, not by translating the English tells word for
word. These are the shapes that show up in Bahasa Indonesia product and landing
copy, with the fix that keeps the register intact.

## Empty vocabulary (counterparts of the R-16 list)

| Slop | Why it is empty | Use instead |
|---|---|---|
| solusi | says nothing about what it does | the thing it does: "aplikasi absensi", "jasa crew event" |
| terbaik, terdepan, terpercaya, nomor satu | unverifiable claim | the evidence, or cut |
| seamless, mulus, tanpa hambatan | claim about ease nobody measured | the step that got shorter |
| satu pintu untuk … | cliché that hides which door | the single thing that is now unified |
| menghadirkan pengalaman … | ceremony | the experience named in one verb |
| siap membantu, kami siap mendukung | nobody asked | the next action, or cut |
| berbagai macam kebutuhan | plural filler | the two or three concrete needs |

## Actorless passive and vague scope

Indonesian product copy hides the actor with "dibahas", "disesuaikan", "akan
ditindaklanjuti". Name who does it, or name the condition.

- "Kebutuhan koordinasi dibahas sesuai lingkup layanan Anda." → "Koordinasi di
  luar lingkup brief dibahas terpisah."
- "Data lain tersimpan lebih dulu." → "Ada data baru dari perangkat lain. Muat
  ulang, isian Anda aman."
- "Anda mendiskusikan pilihan sebelum menyepakati penugasan." → "Pilihan crew
  dibahas sebelum penugasan disepakati." (the reader is not the one who decides
  alone; the passive is honest here, the actor is what was missing)
- "Kenali yang dapat Anda tinjau bersama tim." → "Ini yang bisa Anda tinjau
  sebelum memesan."

## Labels that restate state instead of naming the next action

- "Lengkapi penugasan seluruh talent." → "Tugaskan semua talent dulu, lalu mulai
  event."
- "Tutup pendaftaran terlebih dahulu." → "Tutup pendaftaran dulu."
- "Pembayaran belum dikonfirmasi." → "Pembayaran dari klien belum dikonfirmasi."
  (a payment message must name who pays)
- "Mulai event" as a button is fine; the 
  surrounding sentence must not promise something the system will not do.

## Register

- "Anda" is this user's public register; "kamu" belongs to chat, not the product.
  Do not mix them inside one surface.
- "Silakan", "mohon", and "kami" are normal politeness in Indonesian, not slop.
  The tell is a whole paragraph of it carrying no information.
- "Sedang" for progressive ("sedang memuat") reads more natural than "saat ini
  sedang"; "saat ini" twice in one paragraph is padding.
- "Dulu" softens an instruction in a way "terlebih dahulu" does not; "terlebih
  dahulu" in a UI hint is bureaucratic, "dulu" is spoken.

## Em dash

Indonesian editors do not use the em dash the way English ones do, so replacing
it costs nothing: use a colon to introduce, a comma for a tight aside, or a
full stop. Watch the spaced form ` — ` in headings and taglines.

## Not to flag

- "kandidat terbaik", "tim terbaik": ordinary Indonesian, not a superlative
  claim about the company.
- Uppercase eyebrow labels ("CARA KERJA", "GAMBARAN LAYANAN"): a design choice
  (R-06), not caps-as-emphasis inside prose.
- "Contoh", "ilustrasi", "bukan penawaran": honesty labels that must stay; do not
  delete them for being cautious.

## Data-contract caveat

Indonesian copy often doubles as a matching key: a greeting prefix, an email
subject, a stored notification body. Before rewording such a string, find where
it is compared (`startsWith`, dictionary lookup, test literal) and keep the matcher
tolerant of the old text, or the rewrite breaks historical data and previews.
