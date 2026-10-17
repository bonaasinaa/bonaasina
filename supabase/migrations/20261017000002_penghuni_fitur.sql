-- Bonaasina — fitur penghuni: akun login, kontrak digital, kondisi kamar, daftar tunggu,
-- kuitansi, pengumuman, piket, ID card.
-- Sama seperti tabel lain: RLS aktif tanpa policy, hanya Edge Function "api" (kunci rahasia) yang mengakses.

-- Akun login & kartu penghuni ---------------------------------------------------
alter table public.tenants
  add column username text,
  add column password_hash text,
  add column login_enabled boolean not null default false,
  add column password_set_at timestamptz,
  add column last_login_at timestamptz,
  add column photo_path text,
  add column card_code text;
create unique index tenants_username_uniq on public.tenants (lower(username)) where username is not null;
create unique index tenants_card_code_uniq on public.tenants (card_code) where card_code is not null;

create table public.tenant_sessions (
  token_hash text primary key,
  tenant_id text not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);
create index tenant_sessions_tenant_idx on public.tenant_sessions (tenant_id);

-- Nomor dokumen berurutan (kontrak & kuitansi) ----------------------------------
create sequence public.contract_seq;
create sequence public.receipt_seq;
create or replace function public.next_doc_no(kind text) returns text
language plpgsql security definer set search_path = '' as $$
declare n bigint; y text := to_char(now() at time zone 'Asia/Jakarta', 'YYYY');
begin
  if kind = 'kontrak' then n := nextval('public.contract_seq'); return 'BNS/KTR/' || y || '/' || lpad(n::text, 4, '0');
  elsif kind = 'kuitansi' then n := nextval('public.receipt_seq'); return 'BNS/KW/' || y || '/' || lpad(n::text, 4, '0');
  end if;
  raise exception 'jenis dokumen tidak dikenal: %', kind;
end $$;
revoke all on function public.next_doc_no(text) from public, anon, authenticated;
grant execute on function public.next_doc_no(text) to service_role;

-- Kuitansi: nomor diberikan saat admin memverifikasi pembayaran ------------------
alter table public.invoices
  add column receipt_no text,
  add column receipt_code text,            -- kode acak untuk QR cek keaslian kuitansi
  add column receipt_issued_at timestamptz;
create unique index invoices_receipt_no_uniq on public.invoices (receipt_no) where receipt_no is not null;
create unique index invoices_receipt_code_uniq on public.invoices (receipt_code) where receipt_code is not null;

-- Kontrak sewa digital ------------------------------------------------------------
create table public.contracts (
  id text primary key default ('ctr_' || replace(gen_random_uuid()::text, '-', '')),
  number text not null unique,
  tenant_id text not null references public.tenants(id) on delete cascade,
  room_id text references public.rooms(id) on delete set null,
  property_id text references public.properties(id) on delete set null,
  start_date date not null,
  end_date date not null check (end_date > start_date),
  rent_amount integer not null check (rent_amount >= 0),
  rent_cycle text not null check (rent_cycle in ('bulanan', 'tahunan')),
  deposit integer not null default 0 check (deposit >= 0),
  body text not null,                      -- isi kontrak yang sudah diisi (salinan tetap, tidak ikut berubah bila templat diubah)
  status text not null default 'menunggu' check (status in ('menunggu', 'disetujui', 'dibatalkan')),
  accepted_at timestamptz,
  accepted_name text,
  accepted_ip text,
  accepted_device text,
  pdf_path text,                           -- PDF yang disimpan saat disetujui
  decision text check (decision in ('perpanjang', 'berhenti')),
  decision_note text,
  decision_at timestamptz,
  decision_handled_at timestamptz,
  renewed_from text references public.contracts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contracts_tenant_idx on public.contracts (tenant_id);
create index contracts_room_idx on public.contracts (room_id);
create index contracts_property_idx on public.contracts (property_id);
create index contracts_status_end_idx on public.contracts (status, end_date);
create index contracts_renewed_from_idx on public.contracts (renewed_from);

-- Kondisi kamar saat masuk & keluar ----------------------------------------------------
-- items: [{ name, condition: baik|kurang|rusak|tidak_ada, note, photos: [path] }]
create table public.room_inspections (
  id text primary key default ('ins_' || replace(gen_random_uuid()::text, '-', '')),
  tenant_id text not null references public.tenants(id) on delete cascade,
  room_id text references public.rooms(id) on delete set null,
  kind text not null check (kind in ('masuk', 'keluar')),
  date date not null,
  items jsonb not null default '[]'::jsonb,
  note text default '',
  deposit_deduction integer not null default 0 check (deposit_deduction >= 0),
  deduction_note text default '',
  tenant_ack_at timestamptz,
  tenant_note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, kind)
);
create index room_inspections_room_idx on public.room_inspections (room_id);

-- Daftar tunggu -----------------------------------------------------------------------
create table public.waitlist (
  id text primary key default ('wl_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null,
  phone text not null,
  property_id text references public.properties(id) on delete set null,
  room_pref text default '',
  budget integer,
  move_date date,
  note text default '',
  status text not null default 'menunggu' check (status in ('menunggu', 'perlu_dikabari', 'dikabari', 'selesai', 'batal')),
  matched_room_id text references public.rooms(id) on delete set null,
  matched_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index waitlist_status_idx on public.waitlist (status, created_at);
create index waitlist_property_idx on public.waitlist (property_id);
create index waitlist_room_idx on public.waitlist (matched_room_id);
create index waitlist_phone_created_idx on public.waitlist (phone, created_at);

-- Papan pengumuman -------------------------------------------------------------------
create table public.announcements (
  id text primary key default ('ann_' || replace(gen_random_uuid()::text, '-', '')),
  title text not null,
  body text not null default '',
  priority text not null default 'biasa' check (priority in ('biasa', 'penting')),
  property_id text references public.properties(id) on delete cascade,   -- kosong = semua kos
  pinned boolean not null default false,
  expires_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index announcements_property_idx on public.announcements (property_id);
create table public.announcement_reads (
  announcement_id text not null references public.announcements(id) on delete cascade,
  tenant_id text not null references public.tenants(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, tenant_id)
);
create index announcement_reads_tenant_idx on public.announcement_reads (tenant_id);

-- Jadwal piket ---------------------------------------------------------------------------
create table public.chore_tasks (
  id text primary key default ('pkt_' || replace(gen_random_uuid()::text, '-', '')),
  property_id text not null references public.properties(id) on delete cascade,
  name text not null,
  description text default '',
  frequency text not null default 'mingguan' check (frequency in ('harian', 'mingguan', 'dua_mingguan', 'bulanan')),
  mode text not null default 'bergilir' check (mode in ('bergilir', 'bersama')),
  people_per_turn smallint not null default 1 check (people_per_turn between 1 and 20),
  start_date date not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chore_tasks_property_idx on public.chore_tasks (property_id);
create table public.chore_reports (
  id text primary key default ('pkr_' || replace(gen_random_uuid()::text, '-', '')),
  task_id text not null references public.chore_tasks(id) on delete cascade,
  due_date date not null,
  tenant_id text references public.tenants(id) on delete set null,   -- yang mengirim laporan
  assigned text[] not null default '{}',                              -- nama yang bertugas saat itu
  photos text[] not null default '{}',
  note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, due_date)
);
create index chore_reports_tenant_idx on public.chore_reports (tenant_id);

-- Trigger updated_at -------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['contracts','room_inspections','waitlist','announcements','chore_tasks','chore_reports'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- RLS: aktif tanpa policy -------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['tenant_sessions','contracts','room_inspections','waitlist','announcements','announcement_reads','chore_tasks','chore_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.contract_seq, public.receipt_seq from anon, authenticated;
