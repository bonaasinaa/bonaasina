/* Bonaasina — cek keaslian kartu, kuitansi, dan bukti booking (dipindah dari skrip inline supaya CSP bisa ketat). */
(() => {
  const out = document.getElementById('out');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const tgl = (s) => { if (!s) return '-'; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return `${d} ${BULAN[m - 1]} ${y}`; };
  const rp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const logo = '<img class="logo" src="/assets/img/logo-bonaasina.webp" alt="Bonaasina" width="220" height="194">';
  const code = new URLSearchParams(location.search).get('k') || '';
  const API = (window.BONA_CONFIG?.apiBase || '/api').replace(/\/$/, '');
  const fail = (msg) => { out.innerHTML = `${logo}<span class="verify__badge no">Tidak terdaftar</span><h1>Kode tidak dikenal</h1><p class="muted">${esc(msg)}</p><a class="btn btn--ghost" href="/">Ke website Bonaasina</a>`; };
  if (!/^[a-z0-9]{8,16}$/i.test(code)) return fail('Pindai ulang QR pada kartu, kuitansi, atau bukti booking.');
  fetch(`${API}/public/verify/${encodeURIComponent(code.toLowerCase())}`).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return fail(d.error || 'Kartu atau kuitansi ini tidak terdaftar di Bonaasina.');
    const badge = d.valid ? '<span class="verify__badge ok">✓ Terdaftar & berlaku</span>' : '<span class="verify__badge no">Tidak berlaku lagi</span>';
    if (d.type === 'kartu') {
      out.innerHTML = `${logo}${badge}<h1>${esc(d.name)}</h1>${d.photoUrl ? `<div class="verify__photo"><img src="${esc(d.photoUrl)}" alt="Foto ${esc(d.name)}"></div>` : ''}
        <dl class="kv"><dt>Status</dt><dd>${d.valid ? 'Penghuni aktif' : 'Sudah tidak tinggal di sini'}</dd><dt>Kos</dt><dd>${esc(d.propertyName)}</dd><dt>Kamar</dt><dd>${esc(d.roomCode)}</dd><dt>Sejak</dt><dd>${tgl(d.since)}</dd>${d.until ? `<dt>${d.valid ? 'Kontrak s.d.' : 'Keluar'}</dt><dd>${tgl(d.until)}</dd>` : ''}</dl>
        <p class="hint">Data diambil langsung dari sistem pengelola Bonaasina saat halaman ini dibuka.</p>`;
    } else if (d.type === 'booking') {
      out.innerHTML = `${logo}${badge}<h1>Bukti booking ${esc(d.invoiceNo)}</h1>
        <dl class="kv"><dt>Atas nama</dt><dd>${esc(d.name)}</dd><dt>Kos</dt><dd>${esc(d.propertyName)}</dd><dt>Kamar</dt><dd>${esc(d.roomCode || '-')}</dd><dt>Sewa</dt><dd>${esc(d.periodLabel)}</dd><dt>DP dibayar</dt><dd>${rp(d.amount)}</dd><dt>Disetujui</dt><dd>${tgl(d.approvedAt)}</dd></dl>
        <p class="hint">${d.valid ? 'Booking ini tercatat berhasil dan disetujui admin Bonaasina.' : d.refunded ? 'Booking ini sudah dibatalkan dan DP dikembalikan.' : 'Booking ini tidak berlaku lagi.'}</p>`;
    } else {
      out.innerHTML = `${logo}${badge}<h1>Kuitansi ${esc(d.receiptNo)}</h1>
        <dl class="kv"><dt>Diterima dari</dt><dd>${esc(d.name)}</dd><dt>Kamar</dt><dd>${esc(d.roomCode)}</dd><dt>Untuk</dt><dd>Sewa ${esc(d.periodLabel)}</dd><dt>Jumlah</dt><dd>${rp(d.amount)}</dd><dt>Tanggal bayar</dt><dd>${tgl(d.paidAt)}</dd></dl>
        <p class="hint">${d.valid ? 'Pembayaran ini tercatat lunas di sistem pengelola.' : 'Status lunas kuitansi ini sudah dibatalkan pengelola.'}</p>`;
    }
  }).catch(() => fail('Tidak bisa terhubung. Periksa koneksi internet lalu coba lagi.'));
})();
