-- Bonaasina — Titip jualan/jasa mahasiswa & info tempat sekitar (warung, toko, laundry, dll).
-- Semua akses lewat edge function `api` (RLS aktif tanpa policy).

-- 1) Titip jualan & jasa: siapa saja mengirim lewat formulir → admin menyetujui → tampil di /titip/.
--    Pembeli menghubungi penjual langsung lewat WhatsApp; tidak ada pembayaran di website.
create table public.listings (
  id text primary key default ('tj_' || replace(gen_random_uuid()::text, '-', '')),
  kind text not null default 'jual' check (kind in ('jual', 'jasa')),
  category text not null default 'Lainnya',
  title text not null,
  description text not null default '',
  price integer check (price >= 0),
  price_note text not null default '',          -- contoh: "per jam", "nego", "mulai dari"
  photos text[] not null default '{}',
  seller_name text not null,
  seller_phone text not null,
  seller_info text not null default '',         -- kampus/jurusan atau kos
  area text not null default '',                -- lokasi ambil/antar
  status text not null default 'baru' check (status in ('baru', 'aktif', 'ditolak', 'selesai')),
  admin_note text not null default '',
  featured boolean not null default false,
  expires_on date,                              -- iklan otomatis berhenti tampil setelah tanggal ini
  approved_at timestamptz,
  ip text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index listings_status_idx on public.listings (status, created_at desc);
create index listings_phone_idx on public.listings (seller_phone, created_at);
create index listings_ip_idx on public.listings (ip, created_at);
create trigger listings_touch before update on public.listings for each row execute function public.touch_updated_at();
alter table public.listings enable row level security;
revoke all on public.listings from anon, authenticated;

-- 2) Tempat sekitar: admin mengisi; pengunjung boleh mengusulkan (status usulan) lalu admin menyetujui.
create table public.places (
  id text primary key default ('tp_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null,
  category text not null default 'lainnya' check (category in ('makan', 'toko', 'laundry', 'fotokopi', 'kesehatan', 'transport', 'ibadah', 'lainnya')),
  description text not null default '',
  address text not null default '',
  maps_query text not null default '',
  whatsapp text not null default '',
  open_hours text not null default '',
  price_note text not null default '',          -- contoh: "Nasi + lauk mulai Rp12.000"
  distance_note text not null default '',       -- contoh: "3 menit jalan kaki dari Kos Asina"
  photo text not null default '',
  status text not null default 'aktif' check (status in ('usulan', 'aktif', 'ditolak', 'tutup')),
  suggested_by text not null default '',        -- nama & WA pengusul (hanya untuk admin)
  admin_note text not null default '',
  sort integer not null default 50,
  ip text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index places_status_idx on public.places (status, category, sort);
create index places_ip_idx on public.places (ip, created_at);
create trigger places_touch before update on public.places for each row execute function public.touch_updated_at();
alter table public.places enable row level security;
revoke all on public.places from anon, authenticated;
