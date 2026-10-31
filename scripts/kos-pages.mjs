#!/usr/bin/env node
// Render ulang halaman /kos/<slug>/ dari data API publik, atau cek drift dengan --check.
// Pakai: node scripts/kos-pages.mjs [--check] [--api <url|berkas>] [--summary <berkas.md>]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEMPLATE = join(ROOT, 'scripts/templates/kos-page.html');
const SUMBER = 'https://ncjecdnbrtsshqbxvddb.supabase.co/functions/v1/api/public';
const arg = (nama, cadangan = '') => {
  const i = process.argv.indexOf(nama);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : cadangan;
};
const CHECK = process.argv.includes('--check');
const API = arg('--api', SUMBER);
const SUMMARY = arg('--summary');
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const FOTO_LABEL = ['Tampak depan', 'Bagian dalam', 'Area bersama'];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rupiah = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
const tanggal = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
// Singkatan (CCTV) dan kata berkapital di tengah (WiFi) dibiarkan; kata lain jadi huruf kecil.
const kunciKata = (w) => /^[A-Z]{2,}$/.test(w) || /^[A-Z][a-z]+[A-Z]/.test(w);
const kalimat = (s) => String(s ?? '').split(' ').filter(Boolean)
  .map((w, i) => (i === 0 || kunciKata(w) ? w : w.toLowerCase())).join(' ');
// Rentang hanya dari harga yang benar-benar ada; 0 berarti "tidak diisi", bukan gratis.
const daftarHarga = (rooms) => {
  const bulanan = rooms.map((r) => Number(r.priceMonthly) || 0).filter((n) => n > 0);
  const tahunan = rooms.map((r) => Number(r.priceYearly) || 0).filter((n) => n > 0);
  const harian = rooms.map((r) => Number(r.priceDaily) || 0).filter((n) => n > 0);
  return {
    minBulan: bulanan.length ? Math.min(...bulanan) : 0,
    maxTahun: tahunan.length ? Math.max(...tahunan) : 0,
    minHarian: harian.length ? Math.min(...harian) : 0,
  };
};
// Satu frasa harga untuk teks: bulanan dulu, lalu tahunan, lalu harian.
const frasaHarga = (angka) => {
  if (angka.minBulan) {
    return `${rupiah(angka.minBulan)} per bulan${angka.maxTahun ? ` atau ${rupiah(angka.maxTahun)} per tahun` : ''}`;
  }
  if (angka.maxTahun) return `${rupiah(angka.maxTahun)} per tahun`;
  if (angka.minHarian) return `${rupiah(angka.minHarian)} per hari`;
  return 'belum ada harganya';
};
const frasaSekitar = (p) => {
  const n = (p.nearby || [])[0] || '';
  if (!n) return 'pusat kota';
  return /^[A-Z]{2,}$/.test(n) ? `Kampus ${n}` : n;
};
// Urutan harga: bulanan → tahunan → harian. Jangan pernah menayangkan Rp0.
const hargaPerKamar = (r) => {
  const pilihan = [
    { nilai: Number(r.priceMonthly) || 0, label: 'per bulan' },
    { nilai: Number(r.priceYearly) || 0, label: 'per tahun' },
    { nilai: Number(r.priceDaily) || 0, label: 'per hari' },
  ];
  const utama = pilihan.find((p) => p.nilai > 0);
  if (!utama) return '<span class="room__amount">Hubungi pemilik</span>';
  const tahun = pilihan[1].nilai > 0 && utama.label !== 'per tahun'
    ? `<span class="room__per">${rupiah(pilihan[1].nilai)} per tahun</span>` : '';
  return `<span class="room__amount">${rupiah(utama.nilai)}</span><span class="room__per">${utama.label}</span>${tahun}`;
};

function kartuKamar(r, slug) {
  const kosong = String(r.status || '').toLowerCase() === 'kosong';
  const meta = [r.sizeM2, r.floor].filter(Boolean).map(esc).join(', ');
  const fas = (r.facilities || []).map(kalimat).map(esc).join(', ');
  const note = r.note ? `<span class="room__note">${esc(r.note)}</span>` : '';
  const status = kosong
    ? '<span class="status status--kosong">Kosong</span>'
    : '<span class="status status--terisi">Terisi</span>';
  const aksi = kosong
    ? `<a class="btn btn--red btn--sm" href="/kos/?k=${esc(slug)}#pesan">Pesan kamar ini</a>`
    : '<span class="room__per">Terisi</span>';
  return [
    `            <li class="room${kosong ? '' : ' is-unavailable'}">`,
    `              <div class="room__code">${esc(r.code)}</div>`,
    `              <div class="room__info"><div class="room__type">${esc(kalimat(r.type))}</div><div class="room__meta">${meta}</div>${status}</div>`,
    `              <div class="room__fac">${fas}${note}</div>`,
    `              <div class="room__price">${hargaPerKamar(r)}</div>`,
    `              <div class="room__actions">${aksi}</div>`,
    '            </li>',
  ].join('\n');
}

function jsonLd(p, rooms, site, angka) {
  const pos = String(p.address || '').match(/(\d{5})/);
  const bad = {
    '@context': 'https://schema.org',
    '@type': 'LodgingBusiness',
    name: p.name,
    description: p.description,
    url: `https://bonaasina.my.id/kos/${p.slug}/`,
    image: (p.photos || []).slice(0, 5),
    address: {
      '@type': 'PostalAddress',
      streetAddress: p.address,
      addressLocality: (p.city || '').split(',')[1]?.trim() || p.city,
      addressRegion: 'Sumatera Utara',
      postalCode: pos ? pos[1] : '',
      addressCountry: 'ID',
    },
    geo: { '@type': 'GeoCoordinates', latitude: Number((p.mapsQuery || '').split(',')[0]), longitude: Number((p.mapsQuery || '').split(',')[1]) },
    telephone: site.whatsappNormalized ? '+' + site.whatsappNormalized : undefined,
    priceRange: angka.minBulan && angka.maxTahun
      ? `${rupiah(angka.minBulan)} - ${rupiah(angka.maxTahun)}`
      : frasaHarga(angka),
    numberOfRooms: rooms.length,
    amenityFeature: (p.facilities || []).map((f) => ({ '@type': 'LocationFeatureSpecification', name: kalimat(f), value: true })),
  };
  return JSON.stringify(bad, null, 2).split('\n').map((l) => '  ' + l).join('\n');
}

function render(p, semuaRooms, site, tpl) {
  const rooms = semuaRooms.filter((r) => r.propertyId === p.id || r.propertyId === p.slug)
    .sort((a, b) => {
      const ka = String(a.status).toLowerCase() === 'kosong' ? 0 : 1;
      const kb = String(b.status).toLowerCase() === 'kosong' ? 0 : 1;
      return ka - kb || String(a.code).localeCompare(String(b.code), 'id');
    });
  const kosong = rooms.filter((r) => String(r.status).toLowerCase() === 'kosong').length;
  const angka = daftarHarga(rooms);
  const kecamatan = (p.city || '').split(',')[1]?.trim() || p.city || '';
  const near = frasaSekitar(p);
  const harga = frasaHarga(angka);
  const tagline = String(p.tagline || '').trim();
  const intro = `${tagline}${/[.!?]$/.test(tagline) ? '' : '.'} Kos ${String(p.gender || '').toLowerCase()} di ${p.city || ''}, dekat ${near}.`;
  const waText = `Horas, saya melihat ${p.name} di Bonaasina. Apakah masih ada kamar kosong?`;
  const isian = {
    slug: p.slug,
    nameKap: p.name,
    genderKap: p.gender || '',
    genderLower: String(p.gender || '').toLowerCase(),
    kecamatan,
    city: p.city || '',
    metaDesc: `${p.name} di ${p.city || ''}: kamar ${harga}, dekat ${near}. Lihat kamar kosong, fasilitas, dan alamatnya.`,
    ogDesc: `Kamar ${angka.minBulan ? `${rupiah(angka.minBulan)} per bulan` : frasaHarga(angka)}, dekat ${near}. ${kosong} kamar kosong dari ${rooms.length} kamar.`,
    foto0: (p.photos || [])[0] || p.logo || '/assets/img/logo-bonaasina.webp',
    intro,
    deskripsi: p.description || '',
    kosong,
    checked: tanggal(p.checkedAt),
    ringkasKamar: `${kosong} dari ${rooms.length} kamar kosong. Harga ${harga}.`,
    periodTags: (p.periods || []).map((x) => `          <span>${esc(kalimat(x).replace(/^./, (c) => c.toUpperCase()))}</span>`).join('\n'),
    galeri: ((p.photos || []).length ? p.photos : [(p.photos || [])[0] || p.logo].filter(Boolean)).map((src, i) => `          <div class="gallery__static"><img src="${esc(src)}" alt="${esc(FOTO_LABEL[i] || 'Foto ' + (i + 1))} ${esc(p.name)}" loading="${i === 0 ? 'eager' : 'lazy'}"></div>`).join('\n'),
    kamar: rooms.map((r) => kartuKamar(r, p.slug)).join('\n'),
    fasilitas: (p.facilities || []).map((f) => `              <li>${esc(kalimat(f))}</li>`).join('\n'),
    sekitar: (p.nearby || []).map((f) => `              <li>${esc(f)}</li>`).join('\n'),
    aturan: p.rules || 'Belum ada datanya. Tanyakan langsung ke pengelola lewat chat atau WhatsApp.',
    alamat: p.address || '',
    mapsQuery: encodeURIComponent(p.mapsQuery || ''),
    minBooking: rupiah(p.minBooking),
    visitHours: p.visitHours || 'Jam kerja pengelola',
    waHref: `https://wa.me/${site.whatsappNormalized || ''}?text=${encodeURIComponent(waText)}`,
    jsonld: jsonLd(p, rooms, site, angka),
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in isian ? String(isian[k]) : `{{${k}}}`));
}

async function ambilData() {
  if (/^https?:\/\//.test(API)) {
    const res = await fetch(API, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}`);
    return await res.json();
  }
  return JSON.parse(readFileSync(API, 'utf8'));
}

function bacaHalamanKamar(html) {
  const hasil = new Map();
  const blok = html.split('<li class="room').slice(1);
  for (const b of blok) {
    const kode = (b.match(/room__code">([^<]+)</) || [])[1];
    if (!kode) continue;
    hasil.set(kode, {
      harga: [...b.matchAll(/room__amount">([^<]+)</g)].map((m) => m[1]).join(' / '),
      status: /status--kosong/.test(b) ? 'kosong' : 'terisi',
    });
  }
  return hasil;
}

function barisDiff(lama, baru, batas = 40) {
  const a = lama.split('\n');
  const b = baru.split('\n');
  const keluar = [];
  let beda = 0;
  let tercetak = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    beda++;
    if (keluar.length >= batas) continue;
    tercetak++;
    if (a[i] !== undefined) keluar.push(`- ${a[i]}`);
    if (b[i] !== undefined) keluar.push(`+ ${b[i]}`);
  }
  if (beda > tercetak) keluar.push(`… ${beda - tercetak} baris lain ikut berubah`);
  return keluar.join('\n');
}

function ringkas(slug, lamaHtml, baruHtml) {
  const lama = bacaHalamanKamar(lamaHtml);
  const baru = bacaHalamanKamar(baruHtml);
  const baris = [`### /kos/${slug}/`, ''];
  const kosongLama = [...lama.values()].filter((r) => r.status === 'kosong').length;
  const kosongBaru = [...baru.values()].filter((r) => r.status === 'kosong').length;
  baris.push(`- kamar: ${lama.size} → ${baru.size}`);
  baris.push(`- kamar kosong: ${kosongLama} → ${kosongBaru}`);
  const beda = [];
  for (const [kode, isi] of baru) {
    const lawas = lama.get(kode);
    if (!lawas) { beda.push(`| ${kode} | (belum ada) | ${isi.harga} |`); continue; }
    if (lawas.harga !== isi.harga || lawas.status !== isi.status) {
      beda.push(`| ${kode} | ${lawas.harga} (${lawas.status}) | ${isi.harga} (${isi.status}) |`);
    }
  }
  for (const kode of lama.keys()) if (!baru.has(kode)) beda.push(`| ${kode} | ${lama.get(kode).harga} | (dihapus) |`);
  if (beda.length) baris.push('', '| kamar | di repo | data API |', '| --- | --- | --- |', ...beda);
  return baris.join('\n');
}

const data = await ambilData();
if (!Array.isArray(data?.properties) || !data.properties.length) throw new Error('data properti kosong dari ' + API);
const tpl = readFileSync(TEMPLATE, 'utf8');
const laporan = [];
let drift = 0;

for (const p of data.properties) {
  const site = { ...(data.site || {}), whatsappNormalized: data.whatsappNormalized || data.site?.whatsappNormalized };
  const html = render(p, data.rooms || [], site, tpl).replace(/\r\n/g, '\n');
  const tujuan = join(ROOT, 'web', 'kos', p.slug, 'index.html');
  const sisaToken = html.match(/\{\{\w+\}\}/);
  if (sisaToken) throw new Error(`token belum terisi di ${p.slug}: ${sisaToken[0]}`);

  if (!CHECK) {
    mkdirSync(dirname(tujuan), { recursive: true });
    writeFileSync(tujuan, html, 'utf8');
    console.log(`tulis web/kos/${p.slug}/index.html (${html.split('\n').length} baris)`);
    continue;
  }
  const lama = existsSync(tujuan) ? readFileSync(tujuan, 'utf8').replace(/\r\n/g, '\n') : '';
  if (lama === html) {
    console.log(`sama   web/kos/${p.slug}/index.html`);
    continue;
  }
  drift++;
  console.log(`BEDA   web/kos/${p.slug}/index.html`);
  laporan.push(ringkas(p.slug, lama, html));
  const d = barisDiff(lama, html);
  if (d) laporan.push('', '```diff', d, '```');
}

if (CHECK) {
  if (SUMMARY) {
    const kaki = '\n\nJalankan `node scripts/kos-pages.mjs` untuk memperbarui halaman, lalu merge PR-nya agar harga baru tayang.\n';
    const isi = drift
      ? `Drift terdeteksi: ${drift} halaman /kos/<slug>/ tidak sama dengan data API publik (${API}).\n\n` + laporan.join('\n') + kaki
      : 'Tidak ada drift.\n';
    mkdirSync(dirname(SUMMARY), { recursive: true });
    writeFileSync(SUMMARY, isi, 'utf8');
  }
  if (drift) {
    console.log(`\n${drift} halaman beda dari data API. Jalankan tanpa --check untuk memperbarui.`);
    process.exitCode = 1;
  } else {
    console.log('\nSemua halaman /kos/ sesuai data API.');
  }
}
