-- Bonaasina — Live chat di website (alternatif WhatsApp) + kotak masuk di admin.
-- Pengunjung tidak perlu akun: browser menyimpan token acak, server hanya menyimpan hash SHA-256-nya.
-- Semua akses lewat edge function `api` (RLS aktif tanpa policy, tanpa akses langsung dari browser).
-- Pengaturan (aktif/tampil, jam layanan, sapaan, bot & kamus tanya-jawab) disimpan di settings.data.liveChat.

create table public.chat_threads (
  id text primary key default ('lc_' || replace(gen_random_uuid()::text, '-', '')),
  visitor_hash text not null unique,             -- sha256 token pengunjung
  name text not null,
  contact text not null default '',              -- WhatsApp/email opsional untuk dikabari
  page text not null default '',                 -- halaman saat chat dimulai
  status text not null default 'terbuka' check (status in ('terbuka', 'selesai')),
  last_message_at timestamptz not null default now(),
  last_sender text not null default 'pengunjung' check (last_sender in ('pengunjung', 'admin', 'bot', 'sistem')),
  last_admin_at timestamptz,                      -- balasan admin terakhir (bot diam bila admin baru saja membalas)
  last_preview text not null default '',
  admin_read_id bigint not null default 0,       -- id pesan terakhir yang sudah dibaca admin
  visitor_read_id bigint not null default 0,     -- id pesan terakhir yang sudah dibaca pengunjung
  unread_admin integer not null default 0,
  unread_visitor integer not null default 0,
  admin_note text not null default '',
  ip text not null default '',
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chat_threads_list_idx on public.chat_threads (status, last_message_at desc);
create index chat_threads_unread_idx on public.chat_threads (unread_admin) where unread_admin > 0;
create index chat_threads_ip_idx on public.chat_threads (ip, created_at);
create trigger chat_threads_touch before update on public.chat_threads for each row execute function public.touch_updated_at();

create table public.chat_messages (
  id bigint generated always as identity primary key,
  thread_id text not null references public.chat_threads(id) on delete cascade,
  sender text not null check (sender in ('pengunjung', 'admin', 'bot', 'sistem')),
  body text not null check (char_length(body) between 1 and 2000),
  options jsonb,                                  -- pilihan topik dari bot: [{id, label}]
  admin_email text,
  created_at timestamptz not null default now()
);
create index chat_messages_thread_idx on public.chat_messages (thread_id, id);

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.chat_threads, public.chat_messages from anon, authenticated;
