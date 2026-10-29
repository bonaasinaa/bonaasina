-- Bonaasina, notifikasi email lewat Resend: kolom email opsional untuk setiap orang yang perlu dikabari, dan catatan
-- email terkirim yang sekaligus jadi kunci idempoten supaya satu kejadian tidak mengirim email dua kali.
alter table public.tenants add column if not exists email text not null default '';
alter table public.leads add column if not exists email text not null default '';
alter table public.surveys add column if not exists email text not null default '';
alter table public.waitlist add column if not exists email text not null default '';
alter table public.partner_applications add column if not exists email text not null default '';

create table if not exists public.email_log (
  id bigint generated always as identity primary key,
  dedupe_key text unique,                       -- mis. "invoice.new:inv_xxx"; kosong = boleh berulang
  kind text not null default 'info',
  to_email text not null,
  subject text not null,
  status text not null default 'dikirim' check (status in ('dikirim', 'gagal')),
  resend_id text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists email_log_created_idx on public.email_log (created_at desc);
alter table public.email_log enable row level security;
revoke all on public.email_log from anon, authenticated;
