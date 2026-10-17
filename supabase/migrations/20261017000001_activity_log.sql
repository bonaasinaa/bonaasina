-- Log aktivitas: siapa melakukan apa, kapan, dari mana.
-- Ditulis hanya oleh Edge Function "api" (RLS aktif tanpa policy, sama seperti tabel lain).
-- Log lebih tua dari 180 hari dihapus otomatis oleh fungsi api.

create table public.activity_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_type text not null check (actor_type in ('admin', 'penghuni', 'publik')),
  actor text not null default '-',
  action text not null,
  summary text not null default '',
  target text,
  ok boolean not null default true,
  ip text default '',
  user_agent text default '',
  meta jsonb
);
create index activity_log_created_idx on public.activity_log (created_at desc);
create index activity_log_type_idx on public.activity_log (actor_type, id desc);
create index activity_log_failed_idx on public.activity_log (id desc) where not ok;
create index activity_log_dedupe_idx on public.activity_log (action, actor, created_at desc);

alter table public.activity_log enable row level security;
revoke all on public.activity_log from anon, authenticated;
