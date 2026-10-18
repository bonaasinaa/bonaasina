/* Bonaasina — formulir reservasi bersama (halaman utama Asina & Bona, dan halaman kos mitra).
   Tidak ada pembayaran di awal: pemilik memastikan ketersediaan dulu, baru customer diminta DP. */
window.BonaBooking = (() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const API = (window.BONA_CONFIG?.apiBase || '/api').replace(/\/$/, '');
  const PERIOD = { harian: ['Harian', 'malam', 'priceDaily', 60], bulanan: ['Bulanan', 'bulan', 'priceMonthly', 24], semesteran: ['6 bulanan', '× 6 bulan', 'priceSemester', 4], tahunan: ['Tahunan', 'tahun', 'priceYearly', 3] };
  const MONTHS = { harian: 0, bulanan: 1, semesteran: 6, tahunan: 12 };
  const today = () => { const d = new Date(Date.now() + 7 * 3600e3); return d.toISOString().slice(0, 10); };
  const plusDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

  // el: wadah kosong; opt: { properties, rooms, propertyId?, roomId?, period?, onSubmit? }
  function mount(el, opt) {
    const st = { propertyId: opt.propertyId || opt.properties[0]?.id, roomId: opt.roomId || '', period: opt.period || null, want: opt.period || null };
    const prop = () => opt.properties.find((p) => p.id === st.propertyId);
    const roomsOf = () => opt.rooms.filter((r) => r.propertyId === st.propertyId && r.status === 'kosong');
    const room = () => opt.rooms.find((r) => r.id === st.roomId) || null;
    el.innerHTML = `<form class="form" novalidate>
      <div class="form__row">
        ${opt.properties.length > 1 ? `<label>Kos<select name="propertyId">${opt.properties.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>` : `<input type="hidden" name="propertyId" value="${esc(st.propertyId)}">`}
        <label>Kamar <span class="opt">(opsional)</span><select name="roomId"></select></label>
      </div>
      <fieldset class="form__radios" data-periods><legend>Lama sewa</legend></fieldset>
      <div class="form__row">
        <label>Berapa <span data-unit>bulan</span><input type="number" name="duration" min="1" value="1" inputmode="numeric" required></label>
        <label>Rencana mulai tinggal<input type="date" name="moveDate" required></label>
      </div>
      <fieldset class="form__radios"><legend>Jumlah orang di kamar</legend>
        <label><input type="radio" name="people" value="1" checked> 1 orang</label>
        <label data-two><input type="radio" name="people" value="2"> 2 orang</label></fieldset>
      <p class="estimate" data-estimate aria-live="polite"></p>
      <div class="form__row">
        <label>Nama<input name="name" autocomplete="name" required maxlength="80"></label>
        <label>Nomor WhatsApp<input name="phone" inputmode="tel" autocomplete="tel" placeholder="0812 3456 7890" required maxlength="20"></label>
      </div>
      <label>Pekerjaan / kampus <span class="opt">(opsional)</span><input name="occupation" maxlength="80"></label>
      <label class="check-row"><input type="checkbox" name="visit" data-visit> Saya ingin melihat kos dulu (jadwalkan kunjungan)</label>
      <div class="form__row" data-visit-fields hidden>
        <label>Tanggal kunjungan<input type="date" name="visitDate"></label>
        <label>Jam<select name="visitTime"><option>09.00–11.00</option><option>11.00–13.00</option><option>13.00–15.00</option><option>15.00–18.00</option></select></label>
      </div>
      <label>Catatan <span class="opt">(opsional)</span><textarea name="note" rows="2" maxlength="600" placeholder="Misalnya: bawa motor, butuh kamar mandi dalam."></textarea></label>
      <label class="hp" aria-hidden="true">Website <input name="website" tabindex="-1" autocomplete="off"></label>
      <p class="form__note">Gratis dan belum perlu membayar. Pemilik memastikan kamar tersedia dulu, lalu mengabari Anda lewat WhatsApp &amp; dashboard reservasi.</p>
      <p class="form__error" role="alert" hidden></p>
      <button class="btn btn--red btn--block" type="submit">Kirim reservasi</button>
    </form>
    <div class="form__done" tabindex="-1" hidden></div>`;
    const form = $('form', el); const done = $('.form__done', el);
    const f = form.elements;
    f.moveDate.min = today(); f.moveDate.value = plusDays(today(), 7); f.visitDate.min = today(); f.visitDate.value = plusDays(today(), 1);
    function fillRooms() {
      const list = roomsOf();
      f.roomId.innerHTML = '<option value="">Belum tahu, pilihkan yang cocok</option>' + list.map((r) => `<option value="${r.id}">${esc(r.code)}${r.type ? ` — ${esc(r.type)}` : ''}${Number(r.capacity) === 2 ? ' (bisa 2 orang)' : ''}</option>`).join('');
      if (!list.some((r) => r.id === st.roomId)) st.roomId = '';
      f.roomId.value = st.roomId;
    }
    function fillPeriods() {
      const p = prop(); const per = p?.periods?.length ? p.periods : ['bulanan'];
      // Periode yang terakhir dipilih pengunjung dipakai lagi bila kos ini membukanya.
      st.period = per.includes(st.want) ? st.want : per.includes(st.period) ? st.period : per.includes('bulanan') ? 'bulanan' : per[0];
      $('[data-periods]', el).innerHTML = '<legend>Lama sewa</legend>' + per.map((k) => `<label><input type="radio" name="period" value="${k}" ${k === st.period ? 'checked' : ''}> ${PERIOD[k][0]}</label>`).join('');
    }
    function sync() {
      const r = room(); const k = st.period; const [, unit, key, max] = PERIOD[k];
      $('[data-unit]', el).textContent = k === 'semesteran' ? 'kali 6 bulan' : unit;
      f.duration.max = max; if (Number(f.duration.value) > max) f.duration.value = max;
      const twoOk = r ? Number(r.capacity) === 2 : roomsOf().some((x) => Number(x.capacity) === 2);
      $('[data-two]', el).hidden = !twoOk; if (!twoOk) f.people.value = '1';
      const dur = Math.max(1, Number(f.duration.value) || 1);
      const est = $('[data-estimate]', el);
      if (r && r[key]) {
        const people = Number(f.people.value) || 1;
        const total = r[key] * dur + (people === 2 ? (r.extraPersonFee || 0) * MONTHS[k] * dur : 0);
        est.innerHTML = `Perkiraan total sewa: <strong>${rp(total)}</strong> (${rp(r[key])} × ${dur}${people === 2 && r.extraPersonFee && MONTHS[k] ? ` + tambahan berdua` : ''}). ${prop()?.minBooking ? `Booking/DP minimal ${rp(prop().minBooking)} setelah dikonfirmasi pemilik.` : 'Nominal DP dikonfirmasi pemilik.'}`;
      } else if (r) est.textContent = `Kamar ${r.code} belum punya harga ${PERIOD[k][0].toLowerCase()}. Pemilik akan mengonfirmasi harganya.`;
      else est.textContent = prop()?.minBooking ? `Booking/DP minimal ${rp(prop().minBooking)}, dibayar setelah pemilik mengonfirmasi kamar.` : '';
    }
    function setProperty(id, roomId) {
      st.propertyId = id; if (f.propertyId?.tagName === 'SELECT') f.propertyId.value = id;
      st.roomId = roomId || ''; fillPeriods(); fillRooms(); sync();
    }
    setProperty(st.propertyId, st.roomId);
    form.addEventListener('change', (e) => {
      const n = e.target.name;
      if (n === 'propertyId') setProperty(e.target.value);
      if (n === 'roomId') { st.roomId = e.target.value; sync(); }
      if (n === 'period') { st.period = st.want = e.target.value; sync(); }
      if (n === 'people') sync();
      if (n === 'visit') $('[data-visit-fields]', el).hidden = !e.target.checked;
    });
    f.duration.addEventListener('input', sync);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.form__error', el); const btn = $('button[type=submit]', form);
      form.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
      const body = Object.fromEntries(new FormData(form));
      body.visit = !!f.visit.checked; body.people = Number(body.people) || 1; body.duration = Number(body.duration) || 1;
      const missing = ['name', 'phone', 'moveDate'].filter((k) => !String(body[k] || '').trim());
      if (missing.length) { missing.forEach((k) => f[k].setAttribute('aria-invalid', 'true')); err.textContent = 'Lengkapi nama, nomor WhatsApp, dan tanggal mulai tinggal.'; err.hidden = false; f[missing[0]].focus(); return; }
      btn.disabled = true; btn.textContent = 'Mengirim…'; err.hidden = true;
      try {
        const res = await fetch(API + '/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || 'Reservasi belum terkirim.');
        if (!out.username) { form.hidden = true; done.hidden = false; done.innerHTML = '<h3>Terima kasih</h3>'; return; }
        window.bonaEvent?.('generate_lead', { form: 'reservasi', kos: out.propertyName, periode: body.period });
        showDone(out, body);
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      finally { btn.disabled = false; btn.textContent = 'Kirim reservasi'; }
    });
    function showDone(out, body) {
      const selfMsg = `Akun reservasi Bonaasina (${out.propertyName})\n${out.link}\nUsername: ${out.username}\nKata sandi: ${out.password}`;
      const phone = String(body.phone).replace(/[^0-9]/g, '').replace(/^0/, '62');
      done.innerHTML = `<img src="/assets/img/mark.webp" alt="" width="120" height="82">
        <h3>Reservasi terkirim</h3>
        <p>Pemilik ${esc(out.propertyName)} akan memastikan kamar tersedia, lalu mengabari ${esc(body.name)} di ${esc(body.phone)}. Anda belum perlu membayar apa pun.</p>
        <p><strong>Simpan akun ini</strong> untuk melihat status, chat dengan pemilik, dan membayar DP setelah dikonfirmasi:</p>
        <dl class="cred"><dt>Alamat</dt><dd>${esc(out.link.replace(/^https?:\/\//, '').split('?')[0])}</dd><dt>Username</dt><dd>${esc(out.username)}</dd><dt>Kata sandi</dt><dd>${esc(out.password)}</dd></dl>
        <p class="form__note">Saat pertama masuk, Anda diminta membuat kata sandi sendiri.</p>
        <div class="done__actions"><button type="button" class="btn btn--red" data-open>Buka dashboard reservasi</button>
          <a class="btn btn--ghost" href="https://wa.me/${esc(phone)}?text=${encodeURIComponent(selfMsg)}" target="_blank" rel="noopener">Simpan ke WhatsApp saya</a></div>`;
      form.hidden = true; done.hidden = false; done.focus();
      $('[data-open]', done).addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
          const res = await fetch(API + '/masuk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: out.username, password: out.password }) });
          const s = await res.json();
          if (res.ok) { try { localStorage.setItem('bonaasina-akun-session', JSON.stringify(s)); } catch { /* abaikan */ } }
        } catch { /* tetap buka halaman masuk */ }
        location.href = `/akun/?u=${encodeURIComponent(out.username)}`;
      });
    }
    return { setProperty, setRoom(id) { const r = opt.rooms.find((x) => x.id === id); if (r) setProperty(r.propertyId, id); }, setPeriod(k) { st.want = k; fillPeriods(); sync(); } };
  }
  return { mount, PERIOD };
})();
