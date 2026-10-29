-- Bonaasina, skema awal (Fase 1 + Fase 2). Semua tabel memakai RLS tanpa policy: hanya Edge Function "api"
-- (kunci rahasia) yang boleh membaca/menulis, browser tidak pernah mengakses tabel secara langsung.

create extension if not exists pgcrypto;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

-- Pengaturan situs (satu baris) ----------------------------------------------
create table public.settings (
  id smallint primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Admin & kode penyiapan kata sandi --------------------------------------------
create table public.admins (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
create table public.setup_codes (
  email text primary key references public.admins(email) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null
);

-- Kos ------------------------------------------------------------------------
create table public.properties (
  id text primary key,
  slug text not null unique,
  name text not null,
  short_name text,
  logo text,
  gender text,
  tagline text default '',
  description text default '',
  address text default '',
  maps_query text default '',
  facilities text[] not null default '{}',
  rules text[] not null default '{}',
  nearby text[] not null default '{}',
  photos text[] not null default '{}',
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Kamar ----------------------------------------------------------------------
create table public.rooms (
  id text primary key default ('rm_' || replace(gen_random_uuid()::text, '-', '')),
  property_id text not null references public.properties(id) on delete restrict,
  code text not null,
  type text default '',
  size_m2 text default '',
  floor text default '',
  price_monthly integer not null default 0 check (price_monthly >= 0),
  price_yearly integer not null default 0 check (price_yearly >= 0),
  facilities text[] not null default '{}',
  photos text[] not null default '{}',
  note text default '',
  status text not null default 'kosong' check (status in ('kosong','terisi','dipesan','perbaikan')),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index rooms_property_code_uniq on public.rooms (property_id, lower(code));

-- Penghuni -------------------------------------------------------------------
create table public.tenants (
  id text primary key default ('tn_' || replace(gen_random_uuid()::text, '-', '')),
  room_id text not null references public.rooms(id) on delete restrict,
  name text not null,
  phone text default '',
  occupation text default '',
  origin text default '',
  emergency_name text default '',
  emergency_phone text default '',
  emergency_relation text default '',
  note text default '',
  rent_cycle text not null default 'bulanan' check (rent_cycle in ('bulanan','tahunan')),
  rent_amount integer not null default 0 check (rent_amount >= 0),
  deposit integer not null default 0 check (deposit >= 0),
  start_date date not null,
  end_date date,
  bill_from date,
  status text not null default 'aktif' check (status in ('aktif','keluar')),
  portal_token_hash text unique,
  portal_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tenants_room_idx on public.tenants (room_id);
-- Satu kamar hanya boleh punya satu penghuni aktif
create unique index tenants_one_active_per_room on public.tenants (room_id) where status = 'aktif';

-- Tagihan --------------------------------------------------------------------
create table public.invoices (
  id text primary key default ('inv_' || replace(gen_random_uuid()::text, '-', '')),
  tenant_id text not null references public.tenants(id) on delete cascade,
  room_id text references public.rooms(id) on delete set null,
  property_id text references public.properties(id) on delete set null,
  period_start date,
  period_label text not null default '',
  cycle text not null default 'bulanan' check (cycle in ('bulanan','tahunan','manual')),
  due_date date not null,
  amount integer not null check (amount >= 0),
  status text not null default 'belum' check (status in ('belum','lunas')),
  paid_at date,
  paid_amount integer,
  method text check (method in ('tunai','transfer','qris','lainnya')),
  note text default '',
  last_reminded_at timestamptz,
  proof_path text,
  proof_status text check (proof_status in ('menunggu','diterima','ditolak')),
  proof_note text,
  proof_uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, period_start)
);
create index invoices_tenant_idx on public.invoices (tenant_id);
create index invoices_status_due_idx on public.invoices (status, due_date);
create index invoices_room_idx on public.invoices (room_id);
create index invoices_property_idx on public.invoices (property_id);

-- Permintaan survei ------------------------------------------------------------
create table public.surveys (
  id text primary key default ('srv_' || replace(gen_random_uuid()::text, '-', '')),
  property_id text not null references public.properties(id) on delete cascade,
  room_id text references public.rooms(id) on delete set null,
  name text not null,
  phone text not null,
  date date not null,
  time text default '',
  occupation text default '',
  duration text default 'belum tahu',
  note text default '',
  status text not null default 'baru' check (status in ('baru','dikonfirmasi','selesai','batal')),
  owner_note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index surveys_property_idx on public.surveys (property_id);
create index surveys_room_idx on public.surveys (room_id);
create index surveys_phone_created_idx on public.surveys (phone, created_at);

-- Pengeluaran ----------------------------------------------------------------
create table public.expenses (
  id text primary key default ('exp_' || replace(gen_random_uuid()::text, '-', '')),
  date date not null,
  amount integer not null check (amount >= 0),
  category text not null default 'Lainnya',
  property_id text references public.properties(id) on delete set null,
  note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_property_idx on public.expenses (property_id);

-- Laporan kerusakan (Fase 2) ---------------------------------------------------
create table public.issues (
  id text primary key default ('iss_' || replace(gen_random_uuid()::text, '-', '')),
  tenant_id text not null references public.tenants(id) on delete cascade,
  room_id text references public.rooms(id) on delete set null,
  property_id text references public.properties(id) on delete set null,
  category text not null default 'Lainnya',
  title text not null,
  description text default '',
  photo_path text,
  status text not null default 'baru' check (status in ('baru','dikerjakan','selesai')),
  owner_note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index issues_tenant_idx on public.issues (tenant_id);
create index issues_room_idx on public.issues (room_id);
create index issues_property_idx on public.issues (property_id);

-- Trigger updated_at ---------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['settings','properties','rooms','tenants','invoices','surveys','expenses','issues'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- RLS: aktif di semua tabel, tanpa policy (akses hanya lewat Edge Function) ---------
do $$ declare t text; begin
  foreach t in array array['settings','admins','setup_codes','properties','rooms','tenants','invoices','surveys','expenses','issues'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Penyimpanan file: bucket photos (foto kos & kamar, publik) dan private (bukti bayar, foto kerusakan),
-- yang kedua hanya bisa dibuka lewat tautan bertanda tangan dari admin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('photos', 'photos', true, 5242880, array['image/jpeg','image/png','image/webp']),
  ('private', 'private', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
