-- Bonaasina, pendaftaran calon mitra Kos Sekitar dari /mitra/: formulir singkat, ditinjau admin, lalu akun pemilik
-- dan kos (draf) dibuat otomatis dan info masuk dikirim lewat WhatsApp. Info kos & kamar diisi sendiri oleh pemilik.
create table public.partner_applications (
  id text primary key default ('mtr_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null,                       -- nama pemilik
  phone text not null,                      -- nomor WhatsApp
  kos_name text not null,
  city text not null default '',
  address text not null default '',
  gender text not null default 'Campur' check (gender in ('Putra', 'Putri', 'Campur', 'Pasutri')),
  room_count smallint check (room_count between 1 and 500),
  periods text[] not null default '{bulanan}',
  price_from integer check (price_from >= 0),
  note text not null default '',
  status text not null default 'baru' check (status in ('baru', 'disetujui', 'ditolak')),
  admin_note text not null default '',
  owner_id text references public.owners(id) on delete set null,
  property_id text references public.properties(id) on delete set null,
  decided_at timestamptz,
  ip text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index partner_applications_status_idx on public.partner_applications (status, created_at desc);
create index partner_applications_phone_idx on public.partner_applications (phone, created_at);
create index partner_applications_ip_idx on public.partner_applications (ip, created_at);
create index partner_applications_owner_idx on public.partner_applications (owner_id);
create index partner_applications_property_idx on public.partner_applications (property_id);
create trigger partner_applications_touch before update on public.partner_applications for each row execute function public.touch_updated_at();
alter table public.partner_applications enable row level security;
revoke all on public.partner_applications from anon, authenticated;
