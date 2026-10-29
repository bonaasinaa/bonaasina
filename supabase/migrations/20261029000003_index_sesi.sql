-- Indeks untuk pembersihan sesi kedaluwarsa. Tanpa ini setiap pembersihan membaca seluruh tabel sesi
-- (temuan Heal: "Clearing out expired sign-ins reads every saved session, and grows with use").

create index if not exists tenant_sessions_expires_idx on public.tenant_sessions (expires_at);
create index if not exists owner_sessions_expires_idx on public.owner_sessions (expires_at);
create index if not exists lead_sessions_expires_idx on public.lead_sessions (expires_at);

analyze public.tenant_sessions;
analyze public.owner_sessions;
analyze public.lead_sessions;
