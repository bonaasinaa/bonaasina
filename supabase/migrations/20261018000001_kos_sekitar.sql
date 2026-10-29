-- Bonaasina, Kos Sekitar: kos mitra, reservasi dengan konfirmasi pemilik, akun pemilik & customer, chat, notifikasi,
-- fee booking, refund, periode harian/bulanan/semesteran/tahunan, 2 penghuni per kamar. Semua tambahan, data lama utuh; RLS aktif tanpa policy.

-- Periode sewa ------------------------------------------------------------------------
alter table public.tenants drop constraint tenants_rent_cycle_check;
alter table public.tenants add constraint tenants_rent_cycle_check check (rent_cycle in ('harian', 'bulanan', 'semesteran', 'tahunan'));
alter table public.invoices drop constraint invoices_cycle_check;
alter table public.invoices add constraint invoices_cycle_check check (cycle in ('harian', 'bulanan', 'semesteran', 'tahunan', 'manual'));
alter table public.contracts drop constraint contracts_rent_cycle_check;
alter table public.contracts add constraint contracts_rent_cycle_check check (rent_cycle in ('harian', 'bulanan', 'semesteran', 'tahunan'));

-- Log aktivitas: pemilik kos mitra & customer ikut tercatat ------------------------------
alter table public.activity_log drop constraint activity_log_actor_type_check;
alter table public.activity_log add constraint activity_log_actor_type_check check (actor_type in ('admin', 'penghuni', 'publik', 'pemilik', 'customer'));

-- Akun pemilik kos mitra ------------------------------------------------------------------
create table public.owners (
  id text primary key default ('own_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null,
  phone text not null default '',
  email text not null default '',
  username text not null,
  password_hash text,
  must_change boolean not null default true,       -- wajib ganti kata sandi bawaan saat pertama masuk
  status text not null default 'aktif' check (status in ('aktif', 'nonaktif')),
  note text not null default '',
  password_set_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index owners_username_uniq on public.owners (lower(username));

create table public.owner_sessions (
  token_hash text primary key,
  owner_id text not null references public.owners(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);
create index owner_sessions_owner_idx on public.owner_sessions (owner_id);

-- Kos: milik sendiri atau mitra, periode yang dibuka, kontak, rekening, fee -----------------
alter table public.properties
  add column owner_id text references public.owners(id) on delete set null,
  add column kind text not null default 'sendiri' check (kind in ('sendiri', 'mitra')),
  add column status text not null default 'aktif' check (status in ('draf', 'menunggu', 'aktif', 'nonaktif')),
  add column periods text[] not null default '{bulanan,tahunan}',
  add column city text not null default '',
  add column whatsapp text not null default '',
  add column bank_info text not null default '',
  add column chat_enabled boolean not null default true,
  add column wa_enabled boolean not null default true,
  add column min_booking integer not null default 0 check (min_booking >= 0),
  add column booking_policy text not null default '',
  add column visit_hours text not null default '',
  add column fee_type text check (fee_type in ('persen', 'nominal')),          -- kosong = ikut fee bawaan
  add column fee_value numeric(12, 2) check (fee_value >= 0),
  add column review_note text not null default '',
  add column submitted_at timestamptz,
  add column checked_at timestamptz;                                          -- terakhir pemilik memastikan status kamar benar
alter table public.properties add constraint properties_periods_check
  check (cardinality(periods) >= 1 and periods <@ array['harian', 'bulanan', 'semesteran', 'tahunan']::text[]);
create index properties_owner_idx on public.properties (owner_id);
create index properties_kind_status_idx on public.properties (kind, status);

-- Kamar: harga per periode & kapasitas (1–2 orang) -----------------------------------------
alter table public.rooms
  add column price_daily integer not null default 0 check (price_daily >= 0),
  add column price_semester integer not null default 0 check (price_semester >= 0),
  add column capacity smallint not null default 1 check (capacity between 1 and 2),
  add column extra_person_fee integer not null default 0 check (extra_person_fee >= 0);  -- tambahan per bulan bila berdua

-- Reservasi (leads) + akun customer --------------------------------------------------------
create table public.leads (
  id text primary key default ('ld_' || replace(gen_random_uuid()::text, '-', '')),
  code text not null unique,                       -- 5 angka, dipakai di username (mis. bona13323)
  property_id text not null references public.properties(id) on delete restrict,
  room_id text references public.rooms(id) on delete set null,
  name text not null,
  phone text not null,
  occupation text not null default '',
  people smallint not null default 1 check (people between 1 and 2),
  period text not null check (period in ('harian', 'bulanan', 'semesteran', 'tahunan')),
  duration smallint not null default 1 check (duration between 1 and 365),
  move_date date,
  note text not null default '',
  -- alur: baru → menunggu_dp → dp_dikirim → dp_diterima → berhasil; cabang: ditolak, batal, kedaluwarsa
  status text not null default 'baru' check (status in ('baru', 'menunggu_dp', 'dp_dikirim', 'dp_diterima', 'berhasil', 'ditolak', 'batal', 'kedaluwarsa')),
  responded_at timestamptz,
  reject_reason text not null default '',
  cancel_reason text not null default '',
  cancelled_by text check (cancelled_by in ('customer', 'pemilik', 'admin', 'sistem')),
  -- kunjungan (survei) ke kos
  visit_status text check (visit_status in ('diminta', 'dijadwalkan', 'selesai', 'batal')),
  visit_date date,
  visit_time text not null default '',
  visit_note text not null default '',
  -- penawaran pemilik
  price_total integer check (price_total >= 0),
  dp_amount integer check (dp_amount >= 0),
  dp_deadline timestamptz,
  owner_message text not null default '',
  confirmed_at timestamptz,
  -- bukti DP dari customer (transfer langsung ke rekening pemilik)
  dp_proof_path text,
  dp_uploaded_at timestamptz,
  dp_reject_note text not null default '',
  dp_confirmed_at timestamptz,
  -- fee Bonaasina (dibayar pemilik setelah DP masuk)
  fee_type text check (fee_type in ('persen', 'nominal')),
  fee_value numeric(12, 2),
  fee_amount integer not null default 0 check (fee_amount >= 0),
  fee_status text check (fee_status in ('belum', 'dikirim', 'diterima', 'ditolak', 'bebas', 'dikembalikan')),
  fee_due date,
  fee_proof_path text,
  fee_uploaded_at timestamptz,
  fee_note text not null default '',
  fee_paid_at timestamptz,
  -- persetujuan admin & bukti transaksi
  approved_at timestamptz,
  approved_by text,
  invoice_no text unique,
  invoice_code text unique,
  fee_invoice_no text unique,
  -- refund
  refund_status text check (refund_status in ('diminta', 'ditolak', 'dikirim', 'selesai', 'dilaporkan')),
  refund_reason text not null default '',
  refund_account text not null default '',
  refund_amount integer check (refund_amount >= 0),
  refund_note text not null default '',
  refund_proof_path text,
  refund_requested_at timestamptz,
  refund_sent_at timestamptz,
  refund_done_at timestamptz,
  -- akun customer
  username text not null,
  password_hash text not null,
  -- kata sandi bawaan disimpan hanya sampai customer menggantinya, supaya pemilik bisa mengirim ulang
  -- akses lewat WhatsApp tanpa mengubah kata sandi yang sudah diterima customer. Dikosongkan saat diganti.
  default_password text,
  must_change boolean not null default true,
  login_enabled boolean not null default true,
  password_set_at timestamptz,
  last_login_at timestamptz,
  -- pesan yang sudah dibaca tiap pihak (id pesan terakhir)
  owner_read_msg bigint not null default 0,
  customer_read_msg bigint not null default 0,
  tenant_id text,                                   -- bila sudah dijadikan penghuni (kos sendiri)
  ip text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index leads_username_uniq on public.leads (lower(username));
create index leads_property_status_idx on public.leads (property_id, status);
create index leads_room_idx on public.leads (room_id);
create index leads_status_idx on public.leads (status, created_at desc);
create index leads_phone_created_idx on public.leads (phone, created_at);
create index leads_ip_created_idx on public.leads (ip, created_at);

create table public.lead_sessions (
  token_hash text primary key,
  lead_id text not null references public.leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);
create index lead_sessions_lead_idx on public.lead_sessions (lead_id);

-- Penghuni: orang kedua di kamar yang sama & asal reservasi ----------------------------------
alter table public.tenants
  add column co_name text not null default '',
  add column co_phone text not null default '',
  add column co_relation text not null default '',
  add column co_occupation text not null default '',
  add column lead_id text references public.leads(id) on delete set null;
alter table public.leads add constraint leads_tenant_fk foreign key (tenant_id) references public.tenants(id) on delete set null;
create index tenants_lead_idx on public.tenants (lead_id);
create index leads_tenant_idx on public.leads (tenant_id);

-- Chat per reservasi ----------------------------------------------------------------------
create table public.messages (
  id bigint generated always as identity primary key,
  lead_id text not null references public.leads(id) on delete cascade,
  sender text not null check (sender in ('customer', 'pemilik', 'admin', 'sistem')),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index messages_lead_idx on public.messages (lead_id, id);

-- Notifikasi di dashboard -----------------------------------------------------------------
create table public.notifications (
  id bigint generated always as identity primary key,
  recipient_type text not null check (recipient_type in ('admin', 'pemilik', 'customer')),
  recipient_id text,                                -- id pemilik / id reservasi; kosong untuk admin
  lead_id text references public.leads(id) on delete cascade,
  kind text not null default 'info',
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_type, recipient_id, id desc);
create index notifications_unread_idx on public.notifications (recipient_type, recipient_id) where read_at is null;
create index notifications_lead_idx on public.notifications (lead_id);

-- Nomor dokumen: bukti booking & invoice fee ---------------------------------------------------
create sequence public.booking_seq;
create sequence public.fee_seq;
create or replace function public.next_doc_no(kind text) returns text
language plpgsql security definer set search_path = '' as $$
declare n bigint; y text := to_char(now() at time zone 'Asia/Jakarta', 'YYYY');
begin
  if kind = 'kontrak' then n := nextval('public.contract_seq'); return 'BNS/KTR/' || y || '/' || lpad(n::text, 4, '0');
  elsif kind = 'kuitansi' then n := nextval('public.receipt_seq'); return 'BNS/KW/' || y || '/' || lpad(n::text, 4, '0');
  elsif kind = 'booking' then n := nextval('public.booking_seq'); return 'BNS/BK/' || y || '/' || lpad(n::text, 4, '0');
  elsif kind = 'fee' then n := nextval('public.fee_seq'); return 'BNS/FEE/' || y || '/' || lpad(n::text, 4, '0');
  end if;
  raise exception 'jenis dokumen tidak dikenal: %', kind;
end $$;
revoke all on function public.next_doc_no(text) from public, anon, authenticated;
grant execute on function public.next_doc_no(text) to service_role;

-- Trigger updated_at -----------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['owners', 'leads'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- RLS: aktif tanpa policy --------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['owners', 'owner_sessions', 'leads', 'lead_sessions', 'messages', 'notifications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.booking_seq, public.fee_seq from anon, authenticated;

-- Kos Asina & Bona: semua periode yang sudah ada tetap dibuka, ketersediaan dianggap baru dicek.
update public.properties set checked_at = now() where kind = 'sendiri';
