-- Perbaikan temuan Heal: bucket "private" hanya mengizinkan foto (image/jpeg, image/png, image/webp), padahal isinya
-- juga PDF kontrak & bukti booking. Unggahan application/pdf ditolak (415), jadi penghuni selalu gagal menyimpan kontrak.

update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
       file_size_limit = 10485760
 where id = 'private';

-- Lama berkas kontrak ikut dibatasi 10 MB (PDF kontrak biasanya < 1 MB).

-- Tagihan sewa yang sengaja dihapus admin tidak boleh dibuat ulang oleh generateInvoices().
-- Satu baris = satu periode (penghuni + awal periode) yang sudah diputuskan untuk tidak ditagih.
create table if not exists public.invoice_skips (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  period_start date not null,
  reason text not null default 'dihapus admin',
  created_at timestamptz not null default now(),
  unique (tenant_id, period_start)
);

alter table public.invoice_skips enable row level security;
revoke all on public.invoice_skips from anon, authenticated;

create index if not exists invoice_skips_tenant_idx on public.invoice_skips (tenant_id);
