-- Biaya tambahan bila kamar ditempati berdua bisa dicatat per bulan atau per tahun.
-- Nilai lama tetap berarti per bulan.
alter table public.rooms
  add column if not exists extra_person_period text not null default 'bulanan'
  check (extra_person_period in ('bulanan', 'tahunan'));
comment on column public.rooms.extra_person_fee is 'Tambahan bila berdua, per extra_person_period (bulanan/tahunan)';

-- Kos Asina (Rp6.000.000) dan Kos Bona (Rp3.500.000): tambahan berdua yang diisi adalah per tahun.
update public.rooms set extra_person_period = 'tahunan'
where property_id in ('asina', 'bona') and extra_person_fee > 0;
