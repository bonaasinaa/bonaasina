/* Bonaasina — komponen bersama Kos Sekitar untuk dashboard admin, pemilik, dan customer:
   label status, linimasa, chat (diperbarui otomatis), daftar notifikasi, dan detail reservasi beserta aksinya. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const tgl = (s) => { if (!s) return '-'; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return `${d} ${BULAN[m - 1]} ${y}`; };
  const FMT = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const waktu = (iso) => (iso ? `${FMT.format(new Date(iso))} WIB` : '-');
  const jam = (iso) => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  function relTime(iso) {
    if (!iso) return '';
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 60) return 'baru saja'; if (s < 3600) return `${Math.floor(s / 60)} menit lalu`; if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} hari lalu`; return tgl(iso);
  }
  function sisa(iso) {
    const ms = Date.parse(iso) - Date.now(); if (!(ms > 0)) return 'sudah lewat';
    const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
    return h >= 24 ? `${Math.floor(h / 24)} hari ${h % 24} jam lagi` : `${h} jam ${m} menit lagi`;
  }

  const STATUS = {
    baru: 'Menunggu konfirmasi', menunggu_dp: 'Menunggu DP', dp_dikirim: 'Bukti DP dikirim', dp_diterima: 'DP diterima',
    berhasil: 'Booking berhasil', ditolak: 'Tidak tersedia', batal: 'Dibatalkan', kedaluwarsa: 'Batas bayar lewat',
  };
  const PERIOD = { harian: 'Harian', bulanan: 'Bulanan', semesteran: '6 bulanan', tahunan: 'Tahunan' };
  const PER = { harian: 'malam', bulanan: 'bulan', semesteran: '6 bulan', tahunan: 'tahun' };
  const FEE = { belum: 'Biaya layanan belum dibayar', dikirim: 'Bukti biaya layanan dikirim', diterima: 'Biaya layanan lunas', ditolak: 'Bukti biaya layanan ditolak', bebas: 'Tanpa biaya layanan', dikembalikan: 'Biaya layanan dikembalikan' };
  const REFUND = { diminta: 'Refund diminta', ditolak: 'Refund ditolak pemilik', dikirim: 'Refund dikirim', selesai: 'Refund selesai', dilaporkan: 'Refund dilaporkan ke admin' };
  const VISIT = { diminta: 'Minta kunjungan', dijadwalkan: 'Kunjungan dijadwalkan', selesai: 'Sudah berkunjung', batal: 'Kunjungan batal' };
  const pill = (l) => `<span class="pill pill--${esc(l.status)}">${esc(STATUS[l.status] || l.status)}</span>`;
  function flags(l) {
    const f = [];
    if (l.refundStatus) f.push(`<span class="pill pill--${esc(l.refundStatus)}">${esc(REFUND[l.refundStatus])}</span>`);
    if (l.visitStatus && l.visitStatus !== 'batal') f.push(`<span class="pill pill--${l.visitStatus === 'diminta' ? 'baru' : 'dijadwalkan'}">${esc(VISIT[l.visitStatus])}${l.visitDate && l.visitStatus !== 'selesai' ? ` ${tgl(l.visitDate)}` : ''}</span>`);
    if (l.feeStatus && l.feeStatus !== 'bebas' && l.propertyKind === 'mitra') f.push(`<span class="pill pill--${esc(l.feeStatus === 'belum' ? 'baru' : l.feeStatus)}">${esc(FEE[l.feeStatus])}</span>`);
    if (l.noResponse) f.push('<span class="pill pill--telat">Belum dibalas pemilik</span>');
    if (l.feeOverdue) f.push('<span class="pill pill--telat">Biaya layanan lewat batas</span>');
    if (l.needsApproval) f.push('<span class="pill pill--menunggu-admin">Perlu persetujuan admin</span>');
    if (l.feeToReturn) f.push('<span class="pill pill--telat">Biaya layanan perlu dikembalikan</span>');
    return f.length ? `<div class="lead-flags">${f.join('')}</div>` : '';
  }

  function timeline(l) {
    const order = ['baru', 'menunggu_dp', 'dp_dikirim', 'dp_diterima', 'berhasil'];
    const nowIdx = order.indexOf(l.status);
    const items = l.timeline.map((t, i) => {
      const cls = t.done ? 'is-done' : (i === nowIdx + 1 && nowIdx >= 0) ? 'is-now' : '';
      return `<li class="${cls}"><span class="tl__dot">${t.done ? '✓' : i + 1}</span><div><strong>${esc(t.label)}</strong>${t.at ? `<small>${waktu(t.at)}</small>` : ''}</div></li>`;
    });
    if (['ditolak', 'batal', 'kedaluwarsa'].includes(l.status)) items.push(`<li class="is-now"><span class="tl__dot">!</span><div><strong>${esc(STATUS[l.status])}</strong><small>${esc(l.rejectReason || l.cancelReason || '')}</small></div></li>`);
    return `<ol class="tl">${items.join('')}</ol>`;
  }

  // Ringkasan isi reservasi (untuk semua peran).
  function infoKv(l, role) {
    const rows = [
      ['Kos', l.propertyName], ['Kamar', l.roomCode ? `${l.roomCode}${l.roomType ? `, ${l.roomType}` : ''}` : 'Belum dipilih'],
      ['Lama sewa', l.periodLabel], ['Mulai', `${tgl(l.moveDate)}${l.endDate ? ` s.d. ${tgl(l.endDate)}` : ''}`], ['Jumlah orang', l.people === 2 ? '2 orang' : '1 orang'],
    ];
    if (role !== 'customer') rows.unshift(['Calon penyewa', `${l.name}${l.occupation ? `, ${l.occupation}` : ''}`], ['WhatsApp', l.phone]);
    if (l.priceTotal != null) rows.push(['Total sewa', rp(l.priceTotal)], ['DP / booking', rp(l.dpAmount)], ['Sisa dibayar ke pemilik', rp(l.remaining)]);
    if (l.visitStatus) rows.push(['Kunjungan', `${VISIT[l.visitStatus]}${l.visitDate ? `, ${tgl(l.visitDate)}${l.visitTime ? ` ${l.visitTime}` : ''}` : ''}`]);
    if (l.note) rows.push(['Catatan customer', l.note]);
    if (l.invoiceNo) rows.push(['Bukti booking', l.invoiceNo]);
    rows.push(['No. reservasi', `#${l.code}`]);
    return `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  }

  // ---------------------------------------------------------------- chat (diperbarui tiap beberapa detik)
  function chat(el, { load, send, me, enabled = true, offText = '', title = 'Chat', who = {} }) {
    const NAMES = { customer: 'Penyewa', pemilik: 'Pemilik', admin: 'Admin Bonaasina', sistem: 'Bonaasina', ...who };
    el.innerHTML = `<div class="chat"><div class="chat__head"><strong>${esc(title)}</strong><span class="chat__live" hidden>Langsung</span></div>
      <div class="chat__list" aria-live="polite"><p class="chat__empty">Memuat pesan…</p></div>
      ${enabled ? `<form class="chat__form"><textarea rows="1" maxlength="1000" placeholder="Tulis pesan…" aria-label="Tulis pesan"></textarea><button class="btn btn--red" type="submit">Kirim</button></form>`
        : `<p class="chat__off">${esc(offText || 'Chat sedang dimatikan.')}</p>`}</div>`;
    const list = $('.chat__list', el); let last = 0; let timer = 0; let stopped = false; let first = true;
    const isMine = (m) => m.sender === me;
    const add = (msgs) => {
      if (!msgs.length) { if (first) list.innerHTML = '<p class="chat__empty">Belum ada pesan. Tanyakan apa saja soal kamar, aturan, atau jadwal kunjungan.</p>'; first = false; return; }
      if (first || list.querySelector('.chat__empty')) list.innerHTML = '';
      first = false;
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      for (const m of msgs) {
        if (m.id <= last) continue; last = m.id;
        const div = document.createElement('div');
        div.className = `msg ${m.sender === 'sistem' ? 'msg--sys' : isMine(m) ? 'msg--me' : 'msg--other'}`;
        div.innerHTML = `${m.sender !== 'sistem' ? `<span class="msg__who">${esc(NAMES[m.sender] || m.sender)}</span>` : ''}${esc(m.body)}<small>${jam(m.createdAt)}, ${tgl(m.createdAt.slice(0, 10))}</small>`;
        list.appendChild(div);
      }
      if (nearBottom || msgs.length) list.scrollTop = list.scrollHeight;
    };
    async function poll() {
      if (stopped) return;
      if (!document.body.contains(el)) { stopped = true; return; }
      try { const out = await load(last); add(out.messages || []); $('.chat__live', el).hidden = false; } catch { $('.chat__live', el).hidden = true; }
      // Lebih jarang saat tab tidak dilihat.
      timer = setTimeout(poll, document.hidden ? 30000 : 5000);
    }
    poll();
    const form = $('.chat__form', el);
    if (form) {
      const ta = $('textarea', form);
      ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer:fine)').matches) { e.preventDefault(); form.requestSubmit(); } });
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); const text = ta.value.trim(); if (!text) return;
        const btn = $('button', form); btn.disabled = true;
        try { const m = await send(text); ta.value = ''; ta.style.height = ''; add([m]); }
        catch (ex) { window.BonaMarket.onError?.(ex); }
        finally { btn.disabled = false; ta.focus(); }
      });
    }
    return { stop() { stopped = true; clearTimeout(timer); }, refresh() { clearTimeout(timer); poll(); } };
  }

  function notifs(items) {
    if (!items.length) return '<p class="empty">Belum ada notifikasi.</p>';
    return `<div class="notifs">${items.map((n) => `<button type="button" data-notif="${n.id}" data-lead="${esc(n.leadId || '')}" class="${n.readAt ? '' : 'is-unread'}"><i></i><div><strong>${esc(n.title)}</strong>${n.body ? `<span>${esc(n.body)}</span>` : ''}<time>${relTime(n.createdAt)}</time></div></button>`).join('')}</div>`;
  }

  // ---------------------------------------------------------------- detail reservasi untuk pemilik & admin
  // ctx: { role, api(method, path, body, raw), base: '/leads/<id>', openDialog, askConfirm, toast, reload(), rooms[], shrink(file), saveBlob, waMe }
  function leadPanel(l, ctx) {
    const a = []; const role = ctx.role; const admin = role === 'admin';
    const mitra = l.propertyKind === 'mitra';
    if (['baru', 'kedaluwarsa', 'ditolak'].includes(l.status)) a.push('<button class="btn btn--green" data-a="confirm">Kamar tersedia, minta DP</button>');
    if (['baru', 'menunggu_dp', 'kedaluwarsa'].includes(l.status)) a.push('<button class="btn btn--ghost" data-a="reject">Tidak tersedia</button>');
    if (l.status === 'menunggu_dp') a.push('<button class="btn btn--green" data-wa="konfirmasi">Kirim ke WhatsApp</button>');
    if (l.status === 'ditolak') a.push('<button class="btn btn--ghost" data-wa="tolak">Kabari lewat WhatsApp</button>');
    if (!['menunggu_dp', 'ditolak'].includes(l.status)) a.push('<button class="btn btn--ghost" data-wa="akun">Kirim info masuk lewat WA</button>');
    if ([...['baru', 'menunggu_dp', 'dp_dikirim', 'dp_diterima', 'berhasil']].includes(l.status)) a.push('<button class="btn btn--ghost" data-a="visit">Atur kunjungan</button>');
    if (['baru', 'menunggu_dp', 'kedaluwarsa'].includes(l.status)) a.push('<button class="btn btn--ghost" data-a="cancel">Batalkan</button>');
    if (['dp_dikirim', 'dp_diterima', 'berhasil'].includes(l.status) && (!l.refundStatus || l.refundStatus === 'ditolak')) a.push('<button class="btn btn--ghost" data-a="cancel-refund">Batalkan &amp; kembalikan DP</button>');
    if (l.status === 'berhasil' || (l.status === 'batal' && l.invoiceNo)) a.push('<button class="btn btn--ghost" data-pdf="booking">Unduh bukti booking</button>');
    if (l.feeInvoiceNo) a.push('<button class="btn btn--ghost" data-pdf="fee">Unduh invoice fee</button>');
    if (ctx.extraActions) a.push(ctx.extraActions(l));

    // Kartu "langkah berikutnya" sesuai status.
    let next = '';
    if (l.status === 'baru') next = `<div class="next next--act"><h3>Pastikan kamar tersedia</h3><p>Penyewa belum membayar apa pun. Cek kamar ${l.roomCode ? esc(l.roomCode) : 'yang cocok'} untuk ${esc(l.periodLabel)} mulai ${tgl(l.moveDate)}, lalu tekan <strong>Kamar tersedia, minta DP</strong> atau <strong>Tidak tersedia</strong>.</p></div>`;
    else if (l.status === 'menunggu_dp') next = `<div class="next next--wait"><h3>Menunggu customer transfer DP</h3><p>DP <strong>${rp(l.dpAmount)}</strong> ke rekening ${mitra ? 'pemilik' : 'kos'}. Batas <span class="countdown">${sisa(l.dpDeadline)}</span> (${waktu(l.dpDeadline)}). Sudah kirim pesan WhatsApp ke penyewa?</p></div>`;
    else if (l.status === 'dp_dikirim') next = `<div class="next next--act"><h3>Periksa bukti DP</h3><p>Cocokkan nominal <strong>${rp(l.dpAmount)}</strong> dengan mutasi rekening sebelum menerima.</p>${l.dpProofUrl ? `<a class="proof-img" href="${esc(l.dpProofUrl)}" target="_blank" rel="noopener"><img src="${esc(l.dpProofUrl)}" alt="Bukti DP"></a>` : ''}<div class="btn-row"><button class="btn btn--green" data-a="dp-ok">DP sudah masuk</button><button class="btn btn--ghost" data-a="dp-no">Belum masuk</button></div></div>`;
    else if (l.status === 'dp_diterima' && mitra) {
      if (admin) {
        next = `<div class="next ${l.feeStatus === 'dikirim' || l.feeStatus === 'bebas' ? 'next--act' : 'next--wait'}"><h3>${l.feeStatus === 'dikirim' ? 'Periksa bukti fee lalu setujui' : l.feeStatus === 'bebas' ? 'Tanpa fee — siap disetujui' : 'Menunggu pemilik membayar fee'}</h3>
          <p>DP ${rp(l.dpAmount)} sudah diterima pemilik ${waktu(l.dpConfirmedAt)}. Fee ${rp(l.feeAmount)} (${esc(l.feeRule)})${l.feeDue ? `, batas ${tgl(l.feeDue)}` : ''}.</p>
          <div class="split2">${l.dpProofUrl ? `<a class="proof-img" href="${esc(l.dpProofUrl)}" target="_blank" rel="noopener" title="Bukti DP penyewa"><img src="${esc(l.dpProofUrl)}" alt="Bukti DP penyewa"></a>` : ''}${l.feeProofUrl ? `<a class="proof-img" href="${esc(l.feeProofUrl)}" target="_blank" rel="noopener" title="Bukti fee pemilik"><img src="${esc(l.feeProofUrl)}" alt="Bukti fee pemilik"></a>` : ''}</div>
          <div class="btn-row"><button class="btn btn--green" data-a="approve">Setujui &amp; terbitkan bukti booking</button>${l.feeStatus === 'dikirim' ? '<button class="btn btn--ghost" data-a="fee-reject">Tolak bukti fee</button>' : ''}</div></div>`;
      } else if (['belum', 'ditolak'].includes(l.feeStatus)) {
        next = `<div class="next next--act"><h3>Transfer biaya layanan Bonaasina</h3>${l.feeStatus === 'ditolak' ? `<p class="err">Bukti sebelumnya ditolak: ${esc(l.feeNote)}</p>` : ''}
          <p>Pesanan ini datang lewat Bonaasina. Transfer biaya layanan <strong>${rp(l.feeAmount)}</strong> (${esc(l.feeRule)})${l.feeDue ? ` paling lambat ${tgl(l.feeDue)}` : ''} ke:</p>
          <div class="bank">${esc(l.bonaBankInfo || 'Rekening Bonaasina belum diatur — tanyakan ke admin.')}</div>
          <label class="btn btn--red">Unggah bukti transfer<input type="file" accept="image/*" data-up="fee-proof" hidden></label></div>`;
      } else next = `<div class="next next--wait"><h3>Menunggu persetujuan admin</h3><p>Bukti sudah terkirim. Admin mengecek lalu menerbitkan bukti booking untuk Anda dan penyewa.</p></div>`;
    } else if (l.status === 'berhasil') next = `<div class="next next--ok"><h3>Booking berhasil</h3><p>Bukti booking ${esc(l.invoiceNo)}. Sisa ${rp(l.remaining)} dibayar penyewa langsung ke pemilik. Ubah status kamar menjadi <strong>Terisi</strong> saat customer masuk.</p></div>`;

    // Refund
    let refund = '';
    if (l.refundStatus) {
      const up = ['diminta', 'dilaporkan'].includes(l.refundStatus);
      refund = `<div class="next ${up ? 'next--act' : l.refundStatus === 'selesai' ? 'next--ok' : 'next--wait'}"><h3>${esc(REFUND[l.refundStatus])}</h3>
        <p>Alasan: ${esc(l.refundReason || '-')}${l.refundNote ? `<br>Catatan: ${esc(l.refundNote)}` : ''}</p>
        <p>Rekening penyewa: <strong>${esc(l.refundAccount || 'belum diisi penyewa')}</strong>. Jumlah: ${rp(l.refundAmount ?? l.dpAmount)}.</p>
        ${l.bookingPolicy ? `<p class="hint">Aturan booking kos: ${esc(l.bookingPolicy)}</p>` : ''}
        ${l.refundProofUrl ? `<a class="proof-img" href="${esc(l.refundProofUrl)}" target="_blank" rel="noopener"><img src="${esc(l.refundProofUrl)}" alt="Bukti refund"></a>` : ''}
        <div class="btn-row">${up ? '<button class="btn btn--red" data-a="refund-proof">Unggah bukti refund</button>' : ''}
          ${l.refundStatus === 'diminta' ? '<button class="btn btn--ghost" data-a="refund-reject">Tolak refund</button>' : ''}
          ${admin && ['ditolak', 'dilaporkan'].includes(l.refundStatus) ? '<button class="btn btn--ghost" data-a="refund-reopen">Minta pemilik memproses</button>' : ''}
          ${admin && l.refundStatus !== 'selesai' ? '<button class="btn btn--ghost" data-a="refund-done">Tutup refund (selesai)</button>' : ''}
          ${admin && l.refundStatus === 'selesai' && ['diterima', 'dikirim'].includes(l.feeStatus) ? '<button class="btn btn--green" data-a="fee-returned">Fee sudah dikembalikan ke pemilik</button>' : ''}</div></div>`;
    }
    const visitReq = l.visitStatus === 'diminta' ? `<div class="next next--act"><h3>Customer minta kunjungan</h3><p>${tgl(l.visitDate)}${l.visitTime ? ` pukul ${esc(l.visitTime)}` : ''}${l.visitNote ? `. ${esc(l.visitNote)}` : ''}</p><div class="btn-row"><button class="btn btn--green" data-a="visit">Konfirmasi jadwal</button></div></div>` : '';
    return `<div class="stack">${next}${refund}${visitReq}
      <div class="panel"><h2>Detail reservasi ${pill(l)}</h2>${flags(l)}${infoKv(l, role)}
        ${admin ? `<p class="hint mt">Pemilik: ${esc(l.ownerName)}${l.ownerPhone ? `, ${esc(l.ownerPhone)}` : ''}. Penyewa ${l.customerHasChanged ? 'sudah masuk ke halaman reservasinya' : 'belum pernah masuk ke halaman reservasinya'}${l.lastLoginAt ? `, terakhir masuk ${relTime(l.lastLoginAt)}` : ''}.</p>` : ''}
        <div class="lead-actions mt">${a.join('')}</div></div>
      <div class="panel"><h2>Perjalanan reservasi</h2>${timeline(l)}</div></div>`;
  }

  function bindLead(el, l, ctx) {
    const { api, base, openDialog, askConfirm, toast, reload } = ctx;
    const mitra = l.propertyKind === 'mitra';
    const act = async (path, body, msg) => { await api('POST', `${base}/${path}`, body); toast(msg); await reload(); };
    const rooms = (ctx.rooms || []).filter((r) => r.propertyId === l.propertyId);
    const priceOf = (r) => Number({ harian: r.priceDaily, bulanan: r.priceMonthly, semesteran: r.priceSemester, tahunan: r.priceYearly }[l.period]) || 0;
    const months = { harian: 0, bulanan: 1, semesteran: 6, tahunan: 12 }[l.period] * l.duration;
    const quote = (r) => (r ? priceOf(r) * l.duration + (l.people === 2 ? (r.extraPersonFee || 0) * months : 0) : 0);
    const upload = (path, label, extra = '') => new Promise((resolve) => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return resolve(false);
        try { await BonaLoader.during(label, async () => api('POST', `${base}/${path}${extra}`, undefined, await ctx.shrink(f))); toast('Bukti terkirim.'); reload(); resolve(true); }
        catch (ex) { toast(ex.message, true); resolve(false); }
      };
      inp.click();
    });
    el.addEventListener('change', async (e) => {
      const up = e.target.closest('[data-up]'); if (!up || !up.files[0]) return;
      try { await BonaLoader.during('Mengunggah bukti…', async () => api('POST', `${base}/${up.dataset.up}`, undefined, await ctx.shrink(up.files[0]))); toast('Bukti terkirim. Admin akan mengecek.'); reload(); }
      catch (ex) { toast(ex.message, true); }
    });
    el.addEventListener('click', async (e) => {
      const w = e.target.closest('[data-wa]');
      if (w) {
        try {
          const out = await api('GET', `${base}/wa?kind=${w.dataset.wa}`);
          openDialog({
            title: 'Kirim lewat WhatsApp',
            body: `<p class="muted">Pesannya sudah lengkap dengan tautan, username, dan kata sandi penyewa. Periksa sebentar, lalu tekan Buka WhatsApp.</p>
              <div class="preview" id="waText">${esc(out.text)}</div>
              <div class="btn-row mt"><a class="btn btn--green" href="${esc(out.url)}" target="_blank" rel="noopener">Buka WhatsApp</a><button type="button" class="btn btn--ghost" id="waCopy">Salin pesan</button></div>`,
            onOpen: (b) => { $('#waCopy', b).onclick = async () => { try { await navigator.clipboard.writeText(out.text); toast('Pesan disalin.'); } catch { toast('Tekan lama pada pesan untuk menyalin.'); } }; },
          });
        } catch (ex) { toast(ex.message, true); }
        return;
      }
      const pdf = e.target.closest('[data-pdf]');
      if (pdf) {
        try { await BonaLoader.during('Menyiapkan PDF…', async () => ctx.saveBlob(await api('GET', `${base}/${pdf.dataset.pdf}.pdf`), `${pdf.dataset.pdf === 'fee' ? 'invoice-fee' : 'bukti-booking'}-${l.code}.pdf`)); }
        catch (ex) { toast(ex.message, true); }
        return;
      }
      const b = e.target.closest('[data-a]'); if (!b) return;
      const k = b.dataset.a;
      if (k === 'confirm') {
        const opts = rooms.map((r) => `<option value="${r.id}" data-q="${quote(r)}" ${r.id === l.roomId ? 'selected' : ''} ${['terisi', 'perbaikan'].includes(r.effectiveStatus || r.status) ? 'disabled' : ''}>${esc(r.code)}${r.type ? `, ${esc(r.type)}` : ''} — ${rp(priceOf(r))}/${PER[l.period]}${(r.effectiveStatus || r.status) !== 'kosong' ? ` (${esc(r.effectiveStatus || r.status)})` : ''}${l.people === 2 && Number(r.capacity) < 2 ? ' — hanya 1 orang' : ''}</option>`).join('');
        const minDp = ctx.minBooking?.(l) || 0;
        openDialog({
          title: `Konfirmasi kamar untuk ${l.name}`, ok: 'Kirim & minta DP', okClass: 'btn--green',
          body: `<p class="muted">${esc(l.periodLabel)} mulai ${tgl(l.moveDate)}${l.people === 2 ? ', 2 orang' : ''}. Setelah ini, penyewa melihat rekening Anda dan bisa membayar DP.</p>
            <div class="fields fields--2 mt">
              <label class="span-all">Kamar<select name="roomId" id="cRoom" required>${opts || '<option value="">Belum ada kamar</option>'}</select></label>
              <label>Total sewa untuk periode ini<input type="number" name="priceTotal" id="cTotal" min="0" step="1000" required><span class="hint">Terisi dari harga kamar × lama sewa.</span></label>
              <label>Booking / DP yang ditransfer<input type="number" name="dpAmount" id="cDp" min="${minDp}" step="1000" value="${Math.max(minDp, 0) || ''}" required><span class="hint">${minDp ? `Minimal ${rp(minDp)} (pengaturan kos).` : 'Sesuai kebijakan kos.'}</span></label>
              <label>Batas waktu bayar DP<select name="dpHours"><option value="6">6 jam</option><option value="12">12 jam</option><option value="24" selected>24 jam</option><option value="48">2 hari</option><option value="72">3 hari</option></select></label>
              <label class="span-all">Pesan untuk penyewa <span class="hint">opsional</span><textarea name="message" rows="2" placeholder="Mis. sisa sewa dibayar saat masuk, bawa KTP."></textarea></label>
            </div>`,
          onOpen: (body) => { const fillQ = () => { const o = $('#cRoom', body).selectedOptions[0]; if (o?.dataset.q) $('#cTotal', body).value = o.dataset.q; }; $('#cRoom', body).onchange = fillQ; fillQ(); },
          onOk: async (d) => { await act('confirm', d, 'Tersimpan. Kirim pesan WhatsApp supaya penyewa segera membayar DP.'); setTimeout(() => document.querySelector('[data-wa="konfirmasi"]')?.click(), 80); },
        });
      }
      if (k === 'reject') openDialog({ title: 'Kamar tidak tersedia', ok: 'Kirim ke penyewa', body: `<label>Alasan (dibaca penyewa)<textarea name="reason" rows="3" required placeholder="Mis. kamar sudah terisi untuk bulan tersebut."></textarea></label>`, onOk: (d) => act('reject', d, 'Penyewa sudah diberi tahu.') });
      if (k === 'cancel') { openDialog({ title: 'Batalkan reservasi', ok: 'Batalkan', body: `<label>Alasan<textarea name="reason" rows="2"></textarea></label>`, onOk: (d) => act('cancel', d, 'Reservasi dibatalkan.') }); }
      if (k === 'cancel-refund') openDialog({ title: 'Batalkan booking & kembalikan DP', ok: 'Batalkan & proses refund', body: `<p class="muted">Penyewa sudah mentransfer DP ${rp(l.dpAmount)}. Membatalkan berarti DP dikembalikan. Penyewa akan diminta menulis rekening untuk pengembalian.</p><label class="mt">Alasan<textarea name="reason" rows="3" required></textarea></label>`, onOk: (d) => act('cancel', d, 'Refund dimulai. Unggah bukti transfer refund setelah mengirim uangnya.') });
      if (k === 'visit') openDialog({
        title: 'Jadwal kunjungan', ok: 'Simpan & beri tahu customer',
        body: `<div class="fields fields--2"><label>Status<select name="visitStatus"><option value="dijadwalkan">Dijadwalkan</option><option value="selesai">Sudah berkunjung</option><option value="batal">Batal</option></select></label>
          <label>Tanggal<input type="date" name="visitDate" value="${esc(l.visitDate || '')}"></label><label>Jam<input name="visitTime" value="${esc(l.visitTime || '')}" placeholder="10.00"></label>
          <label class="span-all">Catatan <span class="hint">opsional</span><input name="visitNote" placeholder="Mis. temui penjaga di pos depan."></label></div>`,
        onOk: (d) => act('visit', d, 'Jadwal kunjungan diperbarui.'),
      });
      if (k === 'dp-ok') { if (await askConfirm('DP sudah masuk?', `Pastikan ${rp(l.dpAmount)} benar-benar sudah masuk ke rekening. Kamar akan ditahan untuk ${l.name}.`, 'Ya, sudah masuk')) act('dp', { accept: true }, mitra ? 'DP diterima. Lanjutkan transfer biaya layanan Bonaasina.' : 'DP diterima. Booking berhasil.'); }
      if (k === 'dp-no') openDialog({ title: 'DP belum masuk', ok: 'Kirim ke penyewa', body: `<label>Keterangan untuk penyewa<input name="note" required placeholder="Mis. nominal kurang Rp50.000 / belum ada di mutasi"></label>`, onOk: (d) => act('dp', { accept: false, note: d.note }, 'Penyewa diminta memeriksa ulang.') });
      if (k === 'approve') openDialog({
        title: 'Setujui transaksi', ok: 'Setujui', okClass: 'btn--green',
        body: `<p>Bukti booking untuk ${esc(l.name)} dan invoice untuk pemilik akan terbit.</p>${['belum', 'ditolak'].includes(l.feeStatus) ? `<label class="mt"><input type="checkbox" name="feeReceived"> Fee ${rp(l.feeAmount)} sudah saya terima dengan cara lain</label>` : ''}`,
        onOk: (d) => act('approve', { feeReceived: d.feeReceived === 'on' }, 'Disetujui. Bukti booking terbit.'),
      });
      if (k === 'fee-reject') openDialog({ title: 'Tolak bukti fee', ok: 'Tolak', body: `<label>Alasan untuk pemilik<input name="note" required></label>`, onOk: (d) => act('fee-reject', d, 'Pemilik diminta mengirim ulang bukti fee.') });
      if (k === 'refund-reject') openDialog({ title: 'Tolak refund', ok: 'Tolak refund', body: `<p class="muted">Penyewa bisa melapor ke admin bila tidak setuju. Sebutkan aturan booking yang berlaku.</p><label class="mt">Alasan<textarea name="reason" rows="3" required></textarea></label>`, onOk: (d) => act('refund-reject', d, 'Refund ditolak.') });
      if (k === 'refund-reopen') openDialog({ title: 'Minta pemilik memproses refund', ok: 'Kirim', body: `<label>Catatan (mis. kembalikan 50%)<input name="note"></label>`, onOk: (d) => act('refund-reopen', d, 'Pemilik diminta memproses refund.') });
      if (k === 'refund-done') openDialog({ title: 'Tutup refund', ok: 'Tandai selesai', body: `<p class="muted">Gunakan bila refund sudah beres di luar sistem.</p><label class="mt">Catatan<input name="note"></label>`, onOk: (d) => act('refund-done', d, 'Refund ditutup.') });
      if (k === 'fee-returned') { if (await askConfirm('Fee sudah dikembalikan?', `Tandai fee ${rp(l.feeAmount)} sudah ditransfer kembali ke pemilik.`, 'Ya')) act('fee-returned', {}, 'Fee ditandai dikembalikan.'); }
      if (k === 'refund-proof') openDialog({
        title: 'Bukti transfer refund', ok: 'Pilih foto bukti',
        body: `<p class="muted">Transfer ke: <strong>${esc(l.refundAccount || 'minta penyewa menulis rekening lewat chat')}</strong></p><label class="mt">Jumlah yang dikembalikan<input type="number" name="amount" min="0" step="1000" value="${l.refundAmount ?? l.dpAmount ?? 0}"></label>`,
        onOk: async (d) => { await upload('refund-proof', 'Mengunggah bukti refund…', `?amount=${Number(d.amount) || 0}`); },
      });
    });
  }

  // Satu pintu masuk: username penghuni, pemilik kos, atau customer → diarahkan ke dashboard masing-masing.
  const KEYS = { penghuni: 'bonaasina-penghuni-session', pemilik: 'bonaasina-pemilik-session', customer: 'bonaasina-akun-session' };
  const HOME = { penghuni: '/penghuni/', pemilik: '/pemilik/', customer: '/akun/' };
  async function login(username, password) {
    const API = (window.BONA_CONFIG?.apiBase || '/api').replace(/\/$/, '');
    let res;
    try { res = await fetch(API + '/masuk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: String(username).trim().toLowerCase(), password }) }); }
    catch { throw new Error('Tidak bisa terhubung. Periksa koneksi internet lalu coba lagi.'); }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Username atau kata sandi salah.');
    try { localStorage.setItem(KEYS[out.kind], JSON.stringify(out)); } catch { /* abaikan */ }
    return { ...out, home: HOME[out.kind] };
  }

  window.BonaMarket = { esc, rp, tgl, waktu, relTime, sisa, STATUS, PERIOD, PER, FEE, REFUND, VISIT, pill, flags, timeline, infoKv, chat, notifs, leadPanel, bindLead, login, KEYS, HOME, onError: null };
})();
