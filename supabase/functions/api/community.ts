// Bonaasina — fitur komunitas sekitar kos:
//   1. Titip jualan & jasa mahasiswa (/titip/). Siapa saja mengirim lewat formulir → admin menyetujui → tampil.
//      Pembeli menghubungi penjual lewat WhatsApp; website tidak memproses pembayaran.
//   2. Info tempat sekitar (/sekitar/): warung makan, toko, laundry, fotokopi, dll. Admin mengisi;
//      pengunjung boleh mengusulkan tempat baru yang masuk ke admin untuk disetujui.
type Row = Record<string, any>;

export function createCommunity(H: Record<string, any>) {
  const { sb, q, one, insert, update, str, num, isDate, pick, toCamel, bad, notFound, HttpError, on, created, readImage, putFile, randomToken, clientInfo, normalizePhone, todayStr, PHOTO_PREFIX, SITE_URL } = H;
  const pages = H.pages as (make: (from: number, to: number) => any) => Promise<Row[]>;

  const LISTING_CATS: Record<string, string[]> = {
    jual: ['Makanan & minuman', 'Pakaian & aksesori', 'Buku & alat tulis', 'Elektronik', 'Perabot kos', 'Kerajinan', 'Lainnya'],
    jasa: ['Les & bimbel', 'Desain & foto', 'Servis & perbaikan', 'Laundry & kebersihan', 'Antar & titip beli', 'Ketik & tugas', 'Lainnya'],
  };
  const PLACE_CATS: Record<string, string> = { makan: 'Warung & makan', toko: 'Toko & kelontong', laundry: 'Laundry', fotokopi: 'Fotokopi & ATK', kesehatan: 'Apotek & kesehatan', transport: 'Bengkel & transport', ibadah: 'Tempat ibadah', lainnya: 'Lainnya' };
  const LISTING_DAYS = 60;
  const TITIP_PREFIX = `${PHOTO_PREFIX}titip/`;

  const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const waUrl = (phone: string, text: string) => `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(text)}`;
  const notifyAdmin = (kind: string, title: string, body = '') =>
    q(sb.from('notifications').insert({ recipient_type: 'admin', recipient_id: null, lead_id: null, kind, title: str(title, 160), body: str(body, 600) }));

  // Batas sederhana untuk unggah foto publik: per instance, per IP.
  const uploadHits = new Map<string, number[]>();
  function allowUpload(ip: string) {
    const now = Date.now(); const list = (uploadHits.get(ip) || []).filter((t) => now - t < 3600e3);
    if (list.length >= 12) return false;
    list.push(now); uploadHits.set(ip, list); return true;
  }

  // ------------------------------------------------------------ TITIP JUALAN & JASA
  const publicListing = (r: Row) => ({
    ...pick(r, ['id', 'kind', 'category', 'title', 'description', 'price', 'priceNote', 'photos', 'sellerInfo', 'area', 'featured', 'approvedAt']),
    sellerName: r.sellerName.split(/\s+/).slice(0, 2).join(' '),
    waUrl: waUrl(r.sellerPhone, `Halo ${r.sellerName}, saya lihat "${r.title}" di Titip Jualan Bonaasina. Apakah masih tersedia?`),
  });
  async function activeListings() {
    const today = todayStr();
    // Masa tayang disaring di server: iklan aktif yang sudah kedaluwarsa tidak lagi memenuhi jendela
    // hasil terbaru sehingga iklan yang benar-benar tayang tetap tampil semua.
    const rows = (await pages((from: number, to: number) => sb.from('listings').select('*')
      .eq('status', 'aktif').or(`expires_on.is.null,expires_on.gte.${today}`)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to)))
      .map((x: Row) => toCamel(x) as Row);
    return rows.filter((r) => !r.expiresOn || r.expiresOn >= today).sort((a, b) => Number(!!b.featured) - Number(!!a.featured));
  }
  on('GET', '/titip', async () => ({ categories: LISTING_CATS, listings: (await activeListings()).map(publicListing) }));

  on('POST', '/titip/foto', async ({ req }: Row) => {
    const { ip } = clientInfo(req);
    if (!allowUpload(ip || 'x')) throw new HttpError(429, 'Terlalu banyak foto diunggah. Coba lagi nanti.');
    const { buf, type, ext } = await readImage(req, 4 * 1024 * 1024);
    const path = `titip/${new Date().getFullYear()}/${Date.now()}-${randomToken(8).replace(/[^a-zA-Z0-9]/g, '')}.${ext}`;
    await putFile('photos', path, buf, type);
    return created({ url: PHOTO_PREFIX + path });
  }, { raw: true });

  function listingFields(b: Row, admin = false) {
    const kind = b.kind === 'jasa' ? 'jasa' : 'jual';
    const out: Row = {
      kind, title: str(b.title, 80), description: str(b.description, 1200),
      category: LISTING_CATS[kind].includes(b.category) ? b.category : 'Lainnya',
      price: b.price === '' || b.price === null || b.price === undefined ? null : num(b.price),
      priceNote: str(b.priceNote, 40), sellerInfo: str(b.sellerInfo, 80), area: str(b.area, 80),
      photos: (() => {
        const list = (Array.isArray(b.photos) ? b.photos : []).filter((u: unknown) => typeof u === 'string' && (u.startsWith(TITIP_PREFIX) || (admin && u.startsWith(PHOTO_PREFIX))));
        if (list.length > 4) throw bad('Maksimal 4 foto per iklan.');
        return list;
      })(),
    };
    if (!out.title) throw bad('Isi nama barang atau jasa.');
    return out;
  }

  on('POST', '/titip', async ({ req, body: b }: Row, log: (e: Row) => void) => {
    if (b.website) return created({ ok: true }); // honeypot
    const sellerName = str(b.sellerName, 80), sellerPhone = str(b.sellerPhone, 20);
    if (!sellerName) throw bad('Isi nama Anda.');
    if (normalizePhone(sellerPhone).length < 10) throw bad('Nomor WhatsApp belum benar. Contoh: 0812 3456 7890.');
    const f = listingFields(b);
    if (f.description.length < 10) throw bad('Ceritakan sedikit tentang barang atau jasa Anda (minimal 10 huruf).');
    const { ip } = clientInfo(req);
    const dayAgo = new Date(Date.now() - 864e5).toISOString(), hourAgo = new Date(Date.now() - 3600e3).toISOString();
    const [byPhone, byIp] = await Promise.all([
      sb.from('listings').select('id', { count: 'exact', head: true }).eq('seller_phone', sellerPhone).gte('created_at', dayAgo),
      sb.from('listings').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', hourAgo),
    ]);
    if ((byPhone.count ?? 0) >= 5 || (ip && (byIp.count ?? 0) >= 8)) throw new HttpError(429, 'Iklan dari nomor ini sudah banyak hari ini. Coba lagi besok, atau hubungi admin lewat WhatsApp.');
    const rec = await insert('listings', { ...f, sellerName, sellerPhone, ip, status: 'baru' });
    // Hitung ulang setelah insert: iklan yang dikirim bersamaan tidak boleh melewati batas.
    const [againPhone, againIp] = await Promise.all([
      sb.from('listings').select('id', { count: 'exact', head: true }).eq('seller_phone', sellerPhone).gte('created_at', dayAgo),
      sb.from('listings').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', hourAgo),
    ]);
    if ((againPhone.count ?? 0) > 5 || (ip && (againIp.count ?? 0) > 8)) {
      await q(sb.from('listings').delete().eq('id', rec.id));
      throw new HttpError(429, 'Iklan dari nomor ini sudah banyak hari ini. Coba lagi besok, atau hubungi admin lewat WhatsApp.');
    }
    await notifyAdmin('titip', `Titip ${f.kind === 'jasa' ? 'jasa' : 'jualan'} baru: ${f.title}`, `${sellerName} (${sellerPhone}). Periksa di menu Titip jualan.`);
    log({ action: 'listing.submit', summary: `Mengirim titip ${f.kind}: ${f.title}`, meta: { name: sellerName } });
    return created({ ok: true, id: rec.id });
  });

  on('GET', '/admin/listings', async ({ url }: Row) => {
    const status = str(url?.searchParams?.get('status'), 20);
    const listings = (await pages((from: number, to: number) => {
      let b = sb.from('listings').select('*');
      if (['baru', 'aktif', 'ditolak', 'selesai'].includes(status)) b = b.eq('status', status);
      return b.order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to);
    })).map((x: Row) => toCamel(x) as Row).map((r: Row) => ({ ...r, waSeller: normalizePhone(r.sellerPhone) }));
    // Angka tiap segmen dihitung terpisah, jadi lencana tidak lagi berbeda dari daftar yang tampil.
    const [jumlahBaru, jumlahAktif] = await Promise.all([
      sb.from('listings').select('id', { count: 'exact', head: true }).eq('status', 'baru'),
      sb.from('listings').select('id', { count: 'exact', head: true }).eq('status', 'aktif'),
    ]);
    return { categories: LISTING_CATS, listings, counts: { baru: jumlahBaru.count ?? 0, aktif: jumlahAktif.count ?? 0 } };
  });
  on('POST', '/admin/listings', async ({ body: b }: Row, log: (e: Row) => void) => {
    const sellerName = str(b.sellerName, 80), sellerPhone = str(b.sellerPhone, 20);
    if (!sellerName) throw bad('Isi nama penjual.');
    if (normalizePhone(sellerPhone).length < 10) throw bad('Nomor WhatsApp penjual belum benar.');
    const r = await insert('listings', { ...listingFields(b, true), sellerName, sellerPhone, featured: !!b.featured, status: 'aktif', approvedAt: new Date().toISOString(),
      expiresOn: isDate(b.expiresOn) ? b.expiresOn : addDays(todayStr(), LISTING_DAYS) });
    log({ action: 'listing.create', summary: `Menambah titip "${r.title}"` });
    return created(r);
  });
  function sellerMessage(r: Row, status: string, note = '') {
    const link = `${SITE_URL}/titip/`;
    if (status === 'aktif') return `Horas ${r.sellerName}, iklan "${r.title}" sudah tampil di Titip Jualan Bonaasina sampai ${r.expiresOn}.\n\nLihat di sini: ${link}\nPembeli akan menghubungi Anda langsung lewat WhatsApp. Kalau barang sudah laku atau ingin diubah, balas pesan ini saja. Terima kasih!`;
    return `Horas ${r.sellerName}, terima kasih sudah mengirim "${r.title}" ke Titip Jualan Bonaasina.\n\nMohon maaf, iklan belum bisa kami tampilkan${note ? `: ${note}` : '.'}\nSilakan kirim ulang di ${link} setelah diperbaiki.`;
  }
  on('PUT', '/admin/listings/:id', async ({ params, body: b }: Row, log: (e: Row) => void) => {
    const cur = await one('listings', str(params.id, 60)); if (!cur) throw notFound('Iklan tidak ditemukan.');
    const patch: Row = {};
    if (b.title !== undefined) Object.assign(patch, listingFields({ ...cur, ...b }, true));
    if (b.sellerName !== undefined) patch.sellerName = str(b.sellerName, 80) || cur.sellerName;
    if (b.sellerPhone !== undefined) {
      const phone = str(b.sellerPhone, 20);
      // Nomor pendek tidak boleh "tersimpan" tanpa perubahan: beri tahu admin.
      if (normalizePhone(phone).length < 10) throw bad('Nomor WhatsApp penjual belum benar. Contoh: 0812 3456 7890.');
      patch.sellerPhone = phone;
    }
    if (b.featured !== undefined) patch.featured = !!b.featured;
    if (b.adminNote !== undefined) patch.adminNote = str(b.adminNote, 300);
    if (b.expiresOn !== undefined) patch.expiresOn = isDate(b.expiresOn) ? b.expiresOn : null;
    if (b.status !== undefined) {
      if (!['baru', 'aktif', 'ditolak', 'selesai'].includes(b.status)) throw bad('Status tidak dikenal.');
      patch.status = b.status;
      if (b.status === 'aktif' && cur.status !== 'aktif') {
        patch.approvedAt = new Date().toISOString();
        if (!patch.expiresOn && (!cur.expiresOn || cur.expiresOn < todayStr())) patch.expiresOn = addDays(todayStr(), LISTING_DAYS);
      }
    }
    const r = await update('listings', cur.id, patch);
    const changed = patch.status && patch.status !== cur.status;
    log({ action: 'listing.update', summary: changed ? `${({ aktif: 'Menampilkan', ditolak: 'Menolak', selesai: 'Menandai selesai', baru: 'Mengembalikan' } as Row)[patch.status]} titip "${r.title}"` : `Mengubah titip "${r.title}"` });
    const wa = changed && ['aktif', 'ditolak'].includes(patch.status) ? waUrl(r.sellerPhone, sellerMessage(r, patch.status, r.adminNote)) : null;
    return { ...r, wa };
  });
  on('DELETE', '/admin/listings/:id', async ({ params }: Row, log: (e: Row) => void) => {
    const cur = await one('listings', str(params.id, 60)); if (!cur) throw notFound('Iklan tidak ditemukan.');
    await q(sb.from('listings').delete().eq('id', cur.id));
    const paths = (cur.photos || []).filter((u: string) => u.startsWith(PHOTO_PREFIX)).map((u: string) => u.slice(PHOTO_PREFIX.length));
    if (paths.length) sb.storage.from('photos').remove(paths).catch(() => {});
    log({ action: 'listing.delete', summary: `Menghapus titip "${cur.title}"` });
    return { ok: true };
  });

  // ------------------------------------------------------------ TEMPAT SEKITAR
  const PLACE_FIELDS = ['id', 'name', 'category', 'description', 'address', 'mapsQuery', 'openHours', 'priceNote', 'distanceNote', 'photo'];
  function placeFields(b: Row) {
    const out: Row = {
      name: str(b.name, 80), category: PLACE_CATS[b.category] ? b.category : 'lainnya', description: str(b.description, 600), address: str(b.address, 200),
      mapsQuery: str(b.mapsQuery, 200), whatsapp: str(b.whatsapp, 20), openHours: str(b.openHours, 80), priceNote: str(b.priceNote, 120), distanceNote: str(b.distanceNote, 80),
    };
    if (!out.name) throw bad('Isi nama tempat.');
    return out;
  }
  on('GET', '/sekitar', async () => {
    const rows = ((await q(sb.from('places').select('*').eq('status', 'aktif').order('sort').order('name'))) as Row[] || []).map((x: Row) => toCamel(x) as Row);
    return {
      categories: PLACE_CATS,
      places: rows.map((r: Row) => ({ ...pick(r, PLACE_FIELDS), waUrl: r.whatsapp && normalizePhone(r.whatsapp).length >= 10 ? `https://wa.me/${normalizePhone(r.whatsapp)}` : null })),
    };
  });
  on('POST', '/sekitar/usul', async ({ req, body: b }: Row, log: (e: Row) => void) => {
    if (b.website) return created({ ok: true });
    const f = placeFields(b);
    const who = str(b.suggestedBy, 120);
    const { ip } = clientInfo(req);
    const hourAgo = new Date(Date.now() - 3600e3).toISOString();
    const { count } = await sb.from('places').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', hourAgo);
    if (ip && (count ?? 0) >= 6) throw new HttpError(429, 'Usulan dari perangkat ini sudah banyak. Coba lagi nanti.');
    await insert('places', { ...f, status: 'usulan', suggestedBy: who, ip });
    await notifyAdmin('tempat', `Usulan tempat sekitar: ${f.name}`, `${PLACE_CATS[f.category]}${who ? `, dari ${who}` : ''}. Periksa di menu Tempat sekitar.`);
    log({ action: 'place.suggest', summary: `Mengusulkan tempat sekitar: ${f.name}` });
    return created({ ok: true });
  });
  on('GET', '/admin/places', async () => ({
    categories: PLACE_CATS,
    places: ((await q(sb.from('places').select('*').order('sort').order('name'))) as Row[] || []).map((x: Row) => toCamel(x) as Row),
  }));
  function adminPlacePatch(b: Row) {
    const p: Row = placeFields(b);
    if (b.photo !== undefined) p.photo = typeof b.photo === 'string' && (b.photo === '' || b.photo.startsWith(PHOTO_PREFIX)) ? b.photo : '';
    if (b.sort !== undefined) p.sort = Math.min(999, num(b.sort));
    if (b.adminNote !== undefined) p.adminNote = str(b.adminNote, 300);
    if (b.status !== undefined) { if (!['usulan', 'aktif', 'ditolak', 'tutup'].includes(b.status)) throw bad('Status tidak dikenal.'); p.status = b.status; }
    return p;
  }
  on('POST', '/admin/places', async ({ body: b }: Row, log: (e: Row) => void) => {
    const r = await insert('places', { status: 'aktif', ...adminPlacePatch(b) });
    log({ action: 'place.create', summary: `Menambah tempat sekitar: ${r.name}` });
    return created(r);
  });
  on('PUT', '/admin/places/:id', async ({ params, body: b }: Row, log: (e: Row) => void) => {
    const cur = await one('places', str(params.id, 60)); if (!cur) throw notFound('Tempat tidak ditemukan.');
    const r = await update('places', cur.id, b.name === undefined ? pick(adminPlacePatch({ ...cur, ...b }), ['status', 'sort', 'adminNote', 'photo']) : adminPlacePatch(b));
    log({ action: 'place.update', summary: b.status && b.status !== cur.status ? `${b.status === 'aktif' ? 'Menampilkan' : b.status === 'ditolak' ? 'Menolak usulan' : 'Mengubah status'} tempat: ${r.name}` : `Mengubah tempat sekitar: ${r.name}` });
    return r;
  });
  on('DELETE', '/admin/places/:id', async ({ params }: Row, log: (e: Row) => void) => {
    const cur = await one('places', str(params.id, 60)); if (!cur) throw notFound('Tempat tidak ditemukan.');
    await q(sb.from('places').delete().eq('id', cur.id));
    log({ action: 'place.delete', summary: `Menghapus tempat sekitar: ${cur.name}` });
    return { ok: true };
  });

  async function counts() {
    const [l, p] = await Promise.all([
      sb.from('listings').select('id', { count: 'exact', head: true }).eq('status', 'baru'),
      sb.from('places').select('id', { count: 'exact', head: true }).eq('status', 'usulan'),
    ]);
    return { listingsNew: l.count ?? 0, placesSuggested: p.count ?? 0 };
  }
  return { counts, LISTING_CATS, PLACE_CATS };
}
