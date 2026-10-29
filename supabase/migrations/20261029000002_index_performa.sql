-- Indeks untuk query yang dipakai paling sering oleh dashboard (temuan Heal: "reads every announcement
-- of every kos", "notifications beyond the newest 60", chat per reservasi).
--
-- Tanpa indeks ini Postgres memindai tabel lalu mengurutkan sebelum LIMIT, sehingga biayanya tumbuh
-- mengikuti jumlah baris, bukan jumlah baris yang ditampilkan.

create index if not exists announcements_created_idx on public.announcements (created_at desc);
create index if not exists announcements_property_created_idx on public.announcements (property_id, created_at desc);
create index if not exists announcement_reads_tenant_idx on public.announcement_reads (tenant_id, announcement_id);

create index if not exists notifications_recipient_idx on public.notifications (recipient_type, recipient_id, id desc);
create index if not exists notifications_unread_idx on public.notifications (recipient_type, recipient_id) where read_at is null;

create index if not exists messages_lead_idx on public.messages (lead_id, id);
create index if not exists leads_property_created_idx on public.leads (property_id, created_at desc);
create index if not exists invoices_tenant_period_idx on public.invoices (tenant_id, period_start);
create index if not exists sessions_token_idx on public.tenant_sessions (token_hash);

analyze public.announcements;
analyze public.announcement_reads;
analyze public.notifications;
analyze public.messages;
