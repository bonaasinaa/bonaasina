/* Bonaasina: halaman Jadi Mitra: contoh dashboard interaktif, kalkulator biaya, dan formulir pendaftaran 2 langkah. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const rp = (n) => 'Rp' + Math.round(Number(n || 0)).toLocaleString('id-ID');
  const API = (window.BONA_CONFIG?.apiBase || '/api').replace(/\/$/, '');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('#year').textContent = new Date().getFullYear();
  let fee = { type: 'persen', value: 10 }; let adminWa = '';

  // Contoh dashboard di ponsel
  const STEPS = [
    { label: 'Pesanan masuk', html: `<span class="dm__tag">Reservasi baru</span>
      <div class="dm__card"><strong>Rina Simanjuntak</strong><span>Kamar A-2, sewa 3 bulan</span><span>Mulai 1 November, 1 orang</span></div>
      <p style="font-size:13px;color:var(--ijuk)">Rina belum membayar apa pun. Kamarnya masih ada?</p>
      <div class="dm__btns"><button class="btn btn--ghost" type="button" data-go="0">Tidak tersedia</button><button class="btn dm__btn-green" type="button" data-go="1">Kamar tersedia</button></div>` },
    { label: 'Minta DP', html: `<span class="dm__tag">Anda konfirmasi</span>
      <div class="dm__card"><span>DP yang diminta</span><span class="dm__amount">Rp500.000</span><span>Batas bayar 24 jam</span></div>
      <div class="dm__wa">Horas Rina, kamar A-2 tersedia.\nDP Rp500.000 ke rekening pemilik, lalu unggah buktinya di sini: bonaasina.my.id/akun</div>
      <div class="dm__btns"><button class="btn dm__btn-green" type="button" data-go="2">Kirim ke WhatsApp</button></div>` },
    { label: 'DP masuk', html: `<span class="dm__tag">Bukti transfer masuk</span>
      <div class="dm__card"><strong>Rina mengirim bukti DP</strong><span>Rp500.000 ke rekening BRI Anda</span><span>Cek mutasi rekening dulu, ya.</span></div>
      <div class="dm__btns"><button class="btn btn--ghost" type="button" data-go="2">Belum masuk</button><button class="btn dm__btn-green" type="button" data-go="3">DP sudah masuk</button></div>` },
    { label: 'Booking resmi', html: `<div class="dm__check" aria-hidden="true">✓</div>
      <div class="dm__center"><h3>Kamar A-2 terpesan</h3><p>Bukti booking resmi terkirim ke Rina. Sisa sewa dibayar langsung ke Anda saat masuk.</p></div>
      <span class="dm__tag is-ok" style="justify-self:center">Biaya layanan dibayar setelah DP masuk</span>
      <div class="dm__btns"><button class="btn btn--ghost" type="button" data-go="0">Lihat lagi dari awal</button></div>` },
  ];
  let cur = 0, auto = !reduce, timer = 0;
  $('#demoDots').innerHTML = STEPS.map((s, i) => `<button type="button" role="tab" aria-label="${s.label}" data-go="${i}"></button>`).join('');
  function show(i) {
    cur = i; $('#demo').innerHTML = `<div class="dm">${STEPS[i].html}</div>`;
    $$('#demoDots button').forEach((b, j) => b.setAttribute('aria-selected', j === i));
  }
  function tick() { if (!auto) return; timer = setTimeout(() => { if (!auto) return; show((cur + 1) % STEPS.length); tick(); }, 3600); }
  document.querySelector('.phone').addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    auto = false; clearTimeout(timer); show(Number(b.dataset.go));
  });
  show(0); tick();

  // Kalkulator
  const range = $('#dpRange');
  function calc() {
    const dp = Number(range.value);
    const f = fee.type === 'nominal' ? Math.min(fee.value, dp) : Math.round((dp * fee.value) / 100);
    $('#dpOut').textContent = rp(dp); $('#youGet').textContent = rp(dp); $('#feeOut').textContent = rp(f);
    range.setAttribute('aria-valuetext', rp(dp));
  }
  range.addEventListener('input', calc); calc();

  fetch(API + '/kos-sekitar').then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then((d) => {
    if (d.fee) { fee = d.fee; $('#feeRate').textContent = fee.type === 'nominal' ? `${rp(fee.value)} per booking` : `${Number(fee.value).toLocaleString('id-ID')}% dari DP`; calc(); }
    adminWa = d.whatsapp || '';
    if (adminWa) {
      const url = `https://wa.me/${adminWa}?text=${encodeURIComponent('Horas admin Bonaasina, saya punya kos dan ingin bergabung sebagai mitra.')}`;
      $('#adminWa').href = url; $('#joinDoneWa').href = url;
    } else { $('.join__wa').hidden = true; $('#joinDoneWa').hidden = true; }
  }).catch(() => {
    // Tanpa pesan, kalkulator fee tampak memakai persentase bawaan padahal angkanya tidak termuat.
    $('#feeRate').textContent = 'belum bisa dimuat, coba muat ulang halaman';
  });

  // Formulir 2 langkah
  const form = $('#joinForm'); const err = $('.form__error', form);
  const step = (n) => {
    $$('.join__step', form).forEach((s) => { s.hidden = s.dataset.step !== String(n); });
    $$('[data-step-dot]', form).forEach((d) => d.classList.toggle('is-on', Number(d.dataset.stepDot) <= n));
    $(`.join__step[data-step="${n}"] input`, form)?.focus();
  };
  const phoneOk = (p) => String(p).replace(/[^0-9]/g, '').length >= 10;
  $('[data-next]', form).addEventListener('click', () => {
    const f = form.elements; const bad = [];
    if (!f.name.value.trim()) bad.push(f.name); if (!phoneOk(f.phone.value)) bad.push(f.phone);
    $$('[aria-invalid]', form).forEach((x) => x.removeAttribute('aria-invalid'));
    if (bad.length) { bad.forEach((x) => x.setAttribute('aria-invalid', 'true')); bad[0].focus(); return; }
    step(2);
  });
  $('[data-back]', form).addEventListener('click', () => step(1));
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest('[data-step="1"]') && e.target.tagName === 'INPUT') { e.preventDefault(); $('[data-next]', form).click(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    $$('[aria-invalid]', form).forEach((x) => x.removeAttribute('aria-invalid'));
    const miss = [f.kosName, f.city].filter((x) => !x.value.trim());
    if (miss.length) { miss.forEach((x) => x.setAttribute('aria-invalid', 'true')); err.textContent = 'Isi nama kos dan kota/daerahnya.'; err.hidden = false; miss[0].focus(); return; }
    if (!f.agree.checked) { err.textContent = 'Centang persetujuan di atas tombol kirim.'; err.hidden = false; return; }
    const body = Object.fromEntries(new FormData(form));
    body.periods = $$('input[name=periods]:checked', form).map((x) => x.value);
    delete body.agree;
    const btn = $('button[type=submit]', form); btn.disabled = true; btn.textContent = 'Mengirim…'; err.hidden = true;
    try {
      const res = await fetch(API + '/mitra/daftar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Pendaftaran belum terkirim. Coba lagi.');
      window.bonaEvent?.('generate_lead', { form: 'mitra' });
      $('#joinDoneText').textContent = `Terima kasih, ${body.name}. Admin Bonaasina akan menghubungi ${body.phone} lewat WhatsApp untuk mengirim akun masuk Anda, biasanya dalam 1×24 jam.`;
      form.hidden = true; $('#joinDone').hidden = false; $('#joinDone').focus();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; btn.textContent = 'Kirim pendaftaran'; }
  });
})();
