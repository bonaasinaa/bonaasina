#!/usr/bin/env node
// Membandingkan angka di halaman statis /kos/<slug>/ dengan data API: harga, jumlah kamar, kamar kosong.
// Keluar dengan kode 1 bila ada yang berbeda, supaya data basi ketahuan sebelum jadi janji palsu.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const API = process.env.BONAASINA_API || 'https://ncjecdnbrtsshqbxvddb.supabase.co/functions/v1/api/public';
const WEB = join(fileURLToPath(new URL('..', import.meta.url)), 'web');

const rupiah = (n) => 'Rp' + Number(n).toLocaleString('id-ID');

function hargaDari(rooms) {
  const nilai = [...new Set(rooms.flatMap((r) => [r.priceMonthly, r.priceYearly]).filter(Boolean))];
  return nilai.sort((a, b) => a - b).map(rupiah).join(' - ');
}

function bacaHalaman(berkas) {
  const html = readFileSync(berkas, 'utf8');
  const ambil = (pola) => (html.match(pola) || [])[1];
  return {
    harga: ambil(/"priceRange":\s*"([^"]+)"/),
    kamar: Number(ambil(/"numberOfRooms":\s*(\d+)/)),
    kosong: Number(ambil(/(\d+) kamar kosong dari \d+ kamar/)),
  };
}

async function main() {
  const res = await fetch(API);
  if (!res.ok) {
    console.error(`API menolak: HTTP ${res.status}`);
    process.exit(2);
  }
  const data = await res.json();
  const rooms = data.rooms || [];
  const beda = [];

  for (const p of data.properties || []) {
    const berkas = join(WEB, 'kos', p.slug, 'index.html');
    if (!existsSync(berkas)) continue;

    const milik = rooms.filter((r) => r.propertyId === p.slug);
    const halaman = bacaHalaman(berkas);
    const harap = {
      harga: hargaDari(milik),
      kamar: milik.length,
      kosong: milik.filter((r) => r.status === 'kosong').length,
    };

    for (const kunci of ['harga', 'kamar', 'kosong']) {
      if (halaman[kunci] !== harap[kunci]) {
        beda.push({ slug: p.slug, medan: kunci, halaman: halaman[kunci], api: harap[kunci] });
      }
    }
    const tanda = beda.some((b) => b.slug === p.slug) ? 'BEDA' : 'cocok';
    console.log(`${p.slug.padEnd(8)} ${tanda.padEnd(6)} harga=${harap.harga} kamar=${harap.kamar} kosong=${harap.kosong}`);
  }

  if (beda.length) {
    console.log('\nData di halaman sudah tidak cocok dengan API:');
    for (const b of beda) console.log(`  ${b.slug}.${b.medan}: halaman=${b.halaman} api=${b.api}`);
    console.log('\nPerbaiki halaman (atau minta bot memperbaruinya) lalu jalankan ulang.');
    process.exit(1);
  }

  console.log('\nSemua halaman per kos cocok dengan data API.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(2);
});
