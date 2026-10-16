/* Bonaasina — interaksi halaman publik (tanpa framework).
   GSAP & Lenis dipakai bila berhasil dimuat; tanpa keduanya halaman tetap berfungsi. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const rpShort = (n) => n >= 1e6 ? 'Rp' + (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' jt' : 'Rp' + Math.round(n / 1000) + ' rb';

  const API = (window.BONA_CONFIG?.apiBase || '/api').replace(/\/$/, '');
  const state = { data: null, cycle: 'bulanan', prop: 'semua', onlyAvailable: false, activeTab: null };
  const STATUS = { kosong: 'Kosong', terisi: 'Terisi', dipesan: 'Sudah dipesan', perbaikan: 'Sedang diperbaiki' };

  function wa(text) {
    const num = state.data?.whatsappNormalized;
    return num ? `https://wa.me/${num}?text=${encodeURIComponent(text)}` : '#survei';
  }

  // ---------- muat data ----------
  fetch(API + '/public').then((r) => r.json()).then((data) => {
    state.data = data;
    state.activeTab = data.properties[0]?.id;
    renderAll();
    initMotion();
  }).catch(() => {
    $('#availabilityText').textContent = 'Data kamar belum bisa dimuat. Hubungi kami lewat WhatsApp.';
    initMotion();
  });

  function propName(id) { return state.data.properties.find((p) => p.id === id)?.name || ''; }

  function renderAll() {
    const { site, properties, rooms } = state.data;
    // Bar ketersediaan
    const parts = properties.map((p) => {
      const n = rooms.filter((r) => r.propertyId === p.id && r.status === 'kosong').length;
      return n ? `${n} kamar kosong di ${p.name}` : `${p.name} sedang penuh`;
    });
    const totalFree = rooms.filter((r) => r.status === 'kosong').length;
    $('#availabilityText').textContent = !parts.length ? '' : totalFree ? `Saat ini ada ${parts.join(', ')}.` : 'Saat ini semua kamar terisi. Tanyakan lewat WhatsApp untuk masuk daftar tunggu.';

    if (site.tagline) $('#heroLead').textContent = site.tagline;
    const hello = `Horas, saya tertarik dengan kamar di ${site.siteName || 'Bonaasina'}. Apakah masih ada yang kosong?`;
    $('#heroWa').href = wa(hello);
    $('#waFloat').href = wa(hello);

    // Fakta hero — diambil dari data, bukan angka hiasan
    const monthly = rooms.map((r) => r.priceMonthly).filter(Boolean);
    const facts = [];
    if (monthly.length) facts.push(['Mulai dari', `${rpShort(Math.min(...monthly))}/bln`]);
    facts.push(['Jumlah kamar', `${rooms.length} di ${properties.length} lokasi`]);
    if (site.surveyHours) facts.push(['Jam survei', site.surveyHours.split(',')[0]]);
    $('#heroFacts').innerHTML = facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');

    // Pita ulos: fasilitas gabungan, diulang dua kali untuk marquee tanpa jeda
    const fac = [...new Set(properties.flatMap((p) => p.facilities || []))];
    const words = (fac.length ? fac : ['Kos Asina', 'Kos Bona']).map((f) => `<span>${esc(f)}</span>`).join('');
    $('#ulosTrack').innerHTML = words + words;

    renderTabs();
    renderChips();
    renderRooms();
    renderLokasi();
    renderForm();
    renderFaq();
    renderFooter();
    $('#year').textContent = new Date().getFullYear();
    if (site.surveyHours) {
      $('#surveyHours').textContent = `Jadwal survei: ${site.surveyHours}`;
      $('#stepSurvey').textContent = `Datang melihat kamar dan lingkungan sebelum memutuskan. Jadwal survei: ${site.surveyHours}.`;
    }
    const pay = [site.depositInfo, site.paymentMethods].filter(Boolean).join(' ');
    if (pay) $('#stepPay').textContent = pay;
  }

  // ---------- tab dua rumah ----------
  function renderTabs() {
    const { properties, rooms } = state.data;
    const tabs = $('#propTabs');
    tabs.innerHTML = '<span class="tabs__ind" aria-hidden="true"></span>' + properties.map((p, i) =>
      `<button class="tab" role="tab" id="tab-${p.id}" aria-controls="panel-${p.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-id="${p.id}">${esc(p.name)}</button>`).join('');
    $('#propStage').innerHTML = properties.map((p, i) => {
      const free = rooms.filter((r) => r.propertyId === p.id && r.status === 'kosong').length;
      const photos = (p.photos || []).slice(0, 3);
      const holders = ['Foto tampak depan menyusul', 'Foto kamar menyusul', 'Foto area bersama menyusul'];
      const gallery = photos.map((u, j) => `<button type="button" class="gallery__item" data-lightbox="${p.id}" data-index="${j}" aria-label="Perbesar foto ${esc(p.name)} ${j + 1}"><img src="${esc(u)}" alt="Foto ${esc(p.name)} ${j + 1}" loading="lazy"></button>`).join('')
        + holders.slice(photos.length).map((t) => `<div class="ph"><img class="ph__mark" src="/assets/img/mark.webp" alt="">${esc(t)}</div>`).join('');
      return `<article class="prop" role="tabpanel" id="panel-${p.id}" aria-labelledby="tab-${p.id}" ${i ? 'hidden' : ''}>
        <div>
          <img class="prop__logo" src="${esc(p.logo)}" alt="Logo ${esc(p.name)}" width="240" height="270" loading="lazy">
          ${p.gender ? `<span class="prop__gender">Kos ${esc(p.gender.toLowerCase())}</span>` : ''}
          <p class="prop__tagline">${esc(p.tagline)}</p>
          <p class="prop__desc">${esc(p.description)}</p>
          <ul class="prop__fac">${(p.facilities || []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
          <div class="prop__cta">
            <a class="btn btn--red" href="#kamar" data-filter="${p.id}">Lihat ${free} kamar kosong</a>
            <a class="btn btn--ghost" href="#survei" data-survey="${p.id}">Survei ${esc(p.name)}</a>
          </div>
        </div>
        <div class="gallery">${gallery}</div>
      </article>`;
    }).join('');

    const select = (id, focus) => {
      state.activeTab = id;
      $$('.tab', tabs).forEach((t) => {
        const on = t.dataset.id === id;
        t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
        if (on && focus) t.focus();
      });
      $$('.prop').forEach((panel) => {
        const on = panel.id === `panel-${id}`;
        if (on && panel.hidden) { panel.hidden = false; panel.classList.remove('is-entering'); void panel.offsetWidth; panel.classList.add('is-entering'); }
        else if (!on) panel.hidden = true;
      });
      moveIndicator();
    };
    tabs.addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) select(b.dataset.id); });
    tabs.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const ids = properties.map((p) => p.id); let i = ids.indexOf(state.activeTab);
      i = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
      e.preventDefault(); select(ids[i], true);
    });
    window.addEventListener('resize', moveIndicator);
    requestAnimationFrame(moveIndicator);
    document.fonts?.ready.then(moveIndicator);
  }
  function moveIndicator() {
    const tab = $(`.tab[aria-selected="true"]`); const ind = $('.tabs__ind');
    if (!tab || !ind) return;
    ind.style.width = tab.offsetWidth + 'px';
    ind.style.transform = `translateX(${tab.offsetLeft}px)`;
  }

  // ---------- kamar & harga ----------
  function renderChips() {
    const opts = [['semua', 'Semua kos'], ...state.data.properties.map((p) => [p.id, p.name])];
    $('#propChips').innerHTML = opts.map(([id, label]) => `<button class="chip" aria-pressed="${state.prop === id}" data-id="${id}">${esc(label)}</button>`).join('');
  }
  $('#propChips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    state.prop = b.dataset.id; renderChips(); renderRooms();
  });
  $('#onlyAvailable').addEventListener('change', (e) => { state.onlyAvailable = e.target.checked; renderRooms(); });

  const toggle = $('#cycleToggle');
  toggle.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.dataset.cycle === state.cycle) return;
    setCycle(b.dataset.cycle);
  });
  toggle.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); setCycle(state.cycle === 'bulanan' ? 'tahunan' : 'bulanan'); $(`[data-cycle="${state.cycle}"]`, toggle).focus(); }
  });
  function setCycle(c) {
    state.cycle = c; toggle.dataset.cycle = c;
    $$('button', toggle).forEach((x) => { x.setAttribute('aria-checked', x.dataset.cycle === c); x.tabIndex = x.dataset.cycle === c ? 0 : -1; });
    updatePrices(true);
    updateHint();
  }
  function updateHint() {
    const rooms = state.data?.rooms.filter((r) => r.priceMonthly && r.priceYearly) || [];
    if (!rooms.length) return;
    const saving = Math.round(rooms.reduce((s, r) => s + (r.priceMonthly * 12 - r.priceYearly), 0) / rooms.length / 50000) * 50000;
    $('#cycleHint').textContent = saving > 0
      ? (state.cycle === 'tahunan' ? `Rata-rata hemat sekitar ${rp(saving)} per tahun dibanding bayar bulanan.` : `Sewa tahunan rata-rata hemat sekitar ${rp(saving)}.`)
      : '';
  }

  function priceOf(r) { return state.cycle === 'tahunan' ? r.priceYearly : r.priceMonthly; }

  function renderRooms() {
    if (!state.data) return;
    let rooms = state.data.rooms;
    if (state.prop !== 'semua') rooms = rooms.filter((r) => r.propertyId === state.prop);
    if (state.onlyAvailable) rooms = rooms.filter((r) => r.status === 'kosong');
    const order = { kosong: 0, dipesan: 1, terisi: 2, perbaikan: 3 };
    rooms = [...rooms].sort((a, b) => order[a.status] - order[b.status] || a.code.localeCompare(b.code, 'id', { numeric: true }));
    const free = rooms.filter((r) => r.status === 'kosong').length;
    $('#kamarNote').textContent = `${free} dari ${rooms.length} kamar yang ditampilkan sedang kosong. Status diperbarui langsung oleh pemilik.`;
    if (!rooms.length) {
      $('#roomList').innerHTML = `<li class="rooms__empty">Belum ada kamar kosong untuk pilihan ini. Tanyakan lewat WhatsApp — kami kabari saat ada yang kosong.</li>`;
      return;
    }
    const row = (r) => {
      const kos = propName(r.propertyId);
      const avail = r.status === 'kosong';
      const ask = `Horas, saya mau tanya kamar ${r.code} di ${kos}. Apakah masih kosong untuk sewa ${state.cycle}?`;
      const waitlist = `Horas, saya tertarik kamar ${r.code} di ${kos}. Tolong kabari saya kalau kamar ini atau yang serupa kosong.`;
      return `<li class="room ${avail ? '' : 'is-unavailable'}">
        <div class="room__code">${esc(r.code)}<span class="room__kos">${esc(kos)}</span>${(r.photos || []).length ? `<button type="button" class="room__thumb" data-lightbox="room:${r.id}" data-index="0" aria-label="Lihat ${r.photos.length} foto kamar ${esc(r.code)}"><img src="${esc(r.photos[0])}" alt="" loading="lazy"><span>${r.photos.length} foto</span></button>` : ''}</div>
        <div class="room__info">
          <div class="room__type">${esc(r.type)}</div>
          <div class="room__meta">${[r.sizeM2, r.floor].filter(Boolean).map(esc).join(', ')}</div>
          <span class="status status--${r.status}">${STATUS[r.status] || esc(r.status)}</span>
        </div>
        <div class="room__fac">${(r.facilities || []).map(esc).join(', ')}${r.note ? `<span class="room__note">${esc(r.note)}</span>` : ''}</div>
        <div class="room__price"><span class="room__amount" data-id="${r.id}">${rp(priceOf(r))}</span><span class="room__per">per ${state.cycle === 'tahunan' ? 'tahun' : 'bulan'}</span></div>
        <div class="room__actions">
          ${avail
            ? `<a class="btn btn--red btn--sm" href="${esc(wa(ask))}" target="_blank" rel="noopener">Tanya kamar ini</a>
               <a class="btn btn--ghost btn--sm" href="#survei" data-survey="${r.propertyId}" data-room="${r.id}">Jadwalkan survei</a>`
            : `<a class="btn btn--ghost btn--sm" href="${esc(wa(waitlist))}" target="_blank" rel="noopener">Kabari saya</a>`}
        </div>
      </li>`;
    };
    const open = rooms.filter((r) => r.status === 'kosong');
    const rest = rooms.filter((r) => r.status !== 'kosong');
    // Kamar yang tidak tersedia dilipat supaya daftar tidak panjang, tapi tetap bisa dilihat.
    $('#roomList').innerHTML = open.map(row).join('') + (rest.length
      ? `<li class="rooms__more"><details ${open.length ? '' : 'open'}><summary>Lihat ${rest.length} kamar yang sedang tidak tersedia</summary><ul class="rooms">${rest.map(row).join('')}</ul></details></li>`
      : '');
    updateHint();
  }

  // Animasi angka harga saat toggle bulanan/tahunan (merespons tindakan pengguna).
  function updatePrices(animate) {
    $$('.room__per').forEach((el) => { el.textContent = `per ${state.cycle === 'tahunan' ? 'tahun' : 'bulan'}`; });
    $$('.room__amount').forEach((el) => {
      const r = state.data.rooms.find((x) => x.id === el.dataset.id); if (!r) return;
      const to = priceOf(r);
      const from = Number(el.dataset.v || (state.cycle === 'tahunan' ? r.priceMonthly : r.priceYearly));
      el.dataset.v = to;
      if (!animate || reduce) { el.textContent = rp(to); return; }
      const t0 = performance.now(), dur = 650;
      const step = (t) => {
        const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        el.textContent = rp(Math.round((from + (to - from) * e) / 1000) * 1000);
        if (p < 1) requestAnimationFrame(step); else el.textContent = rp(to);
      };
      requestAnimationFrame(step);
    });
    // Rangkai ulang tautan WA agar menyebut lama sewa yang dipilih
    renderRoomsLinksOnly();
  }
  function renderRoomsLinksOnly() {
    $$('.room').forEach((li) => {
      const code = $('.room__code', li).firstChild.textContent; const kos = $('.room__kos', li).textContent;
      const a = $('.btn--red', li);
      if (a) a.href = wa(`Horas, saya mau tanya kamar ${code} di ${kos}. Apakah masih kosong untuk sewa ${state.cycle}?`);
    });
  }

  // Tombol pintasan: saring kamar / isi formulir survei
  document.addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]');
    if (f) { state.prop = f.dataset.filter; state.onlyAvailable = true; $('#onlyAvailable').checked = true; renderChips(); renderRooms(); }
    const s = e.target.closest('[data-survey]');
    if (s) {
      $('#fProperty').value = s.dataset.survey; fillRoomOptions();
      if (s.dataset.room) $('#fRoom').value = s.dataset.room;
    }
  });

  // ---------- lokasi & aturan ----------
  function renderLokasi() {
    $('#lokasiGrid').innerHTML = state.data.properties.map((p) => `
      <article class="place">
        <div class="place__map">${p.mapsQuery && !window.BONA_PREVIEW
          ? `<iframe title="Peta lokasi ${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${encodeURIComponent(p.mapsQuery)}&output=embed"></iframe>`
          : p.mapsQuery
            ? `<div class="place__nomap"><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.mapsQuery)}" target="_blank" rel="noopener">Lihat lokasi ${esc(p.name)} di Google Maps</a></div>`
            : `<div class="place__nomap">Titik peta ${esc(p.name)} belum diatur.<br>Minta lokasi lewat WhatsApp.</div>`}</div>
        <div class="place__body">
          <div><p class="place__name">${esc(p.name)}</p><p class="place__addr">${esc(p.address)}</p>
            ${p.mapsQuery ? `<p style="margin-top:10px"><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.mapsQuery)}" target="_blank" rel="noopener">Buka di Google Maps</a></p>` : ''}</div>
          ${(p.nearby || []).length ? `<div><h3>Dekat dengan</h3><ul>${p.nearby.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
          ${(p.rules || []).length ? `<div><h3>Aturan ${esc(p.name)}</h3><ul>${p.rules.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
        </div>
      </article>`).join('');
  }

  // ---------- formulir survei ----------
  function renderForm() {
    $('#fProperty').innerHTML = state.data.properties.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    fillRoomOptions();
    const d = new Date(); const pad = (n) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    $('#fDate').min = today; $('#fDate').value = today;
  }
  function fillRoomOptions() {
    const pid = $('#fProperty').value;
    const rooms = state.data.rooms.filter((r) => r.propertyId === pid && r.status === 'kosong');
    $('#fRoom').innerHTML = '<option value="">Belum tahu, mau lihat dulu</option>' +
      rooms.map((r) => `<option value="${r.id}">${esc(r.code)} — ${esc(r.type)}</option>`).join('');
  }
  $('#fProperty').addEventListener('change', fillRoomOptions);

  $('#surveyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target; const err = $('#formError'); const btn = $('#surveySubmit');
    $$('[aria-invalid]', form).forEach((x) => x.removeAttribute('aria-invalid'));
    const body = Object.fromEntries(new FormData(form));
    const missing = ['name', 'phone', 'date'].filter((k) => !String(body[k] || '').trim());
    if (missing.length) {
      missing.forEach((k) => form.elements[k].setAttribute('aria-invalid', 'true'));
      err.textContent = 'Lengkapi nama, nomor WhatsApp, dan tanggal survei.'; err.hidden = false;
      form.elements[missing[0]].focus(); return;
    }
    btn.disabled = true; btn.textContent = 'Mengirim…'; err.hidden = true;
    try {
      const res = await fetch(API + '/surveys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Permintaan belum terkirim.');
      const kos = propName(body.propertyId);
      const tgl = new Date(body.date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
      $('#doneText').textContent = `Kami akan menghubungi ${body.name} di ${body.phone} untuk konfirmasi survei ${kos} pada ${tgl}, ${body.time}.`;
      $('#doneWa').href = wa(`Horas, saya ${body.name}. Saya baru mengisi formulir survei ${kos} untuk ${tgl} jam ${body.time}.`);
      form.hidden = true; const done = $('#surveyDone'); done.hidden = false; done.focus();
    } catch (ex) {
      err.textContent = ex.message + ' Atau hubungi kami langsung lewat WhatsApp.'; err.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'Kirim permintaan survei';
    }
  });

  // ---------- tanya jawab (akordeon dengan tinggi teranimasi) ----------
  function renderFaq() {
    const faq = state.data.site.faq || [];
    $('#faq').innerHTML = faq.map((f) => `<details><summary>${esc(f.q)}</summary><div class="faq__a"><p>${esc(f.a)}</p></div></details>`).join('');
    if (reduce) return;
    $$('#faq details').forEach((d) => {
      const sum = $('summary', d), body = $('.faq__a', d);
      sum.addEventListener('click', (e) => {
        e.preventDefault();
        if (d.open) {
          const h = body.offsetHeight;
          body.animate([{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 300, easing: 'cubic-bezier(.22,.8,.2,1)' }).onfinish = () => { d.open = false; };
        } else {
          d.open = true; const h = body.offsetHeight;
          body.animate([{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.22,.8,.2,1)' });
        }
      });
    });
  }

  function renderFooter() {
    const { site, properties } = state.data;
    $('#footerInfo').innerHTML = properties.map((p) => `<div><strong>${esc(p.name)}</strong>${esc(p.address)}</div>`).join('') +
      `<div><strong>Hubungi pemilik</strong><a href="${esc(wa('Horas, saya mau tanya soal kos.'))}" target="_blank" rel="noopener">WhatsApp ${esc(site.whatsapp || '')}</a></div>`;
  }

  // ---------- gerak ----------
  function initMotion() {
    // Nav berubah saat discroll + tombol WA muncul setelah hero
    const nav = $('#nav'), float = $('#waFloat');
    const onScroll = () => {
      nav.classList.toggle('is-scrolled', scrollY > 10);
      float.classList.toggle('is-visible', scrollY > innerHeight * 0.6);
    };
    addEventListener('scroll', onScroll, { passive: true }); onScroll();

    startRotator();
    if (reduce) return;

    // Lenis: scroll halus, juga untuk tautan jangkar
    if (window.Lenis) {
      const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
      const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
      document.addEventListener('click', (e) => {
        const a = e.target.closest('a[href^="#"]'); if (!a) return;
        const id = a.getAttribute('href'); if (id.length < 2) return;
        const el = document.querySelector(id); if (!el) return;
        e.preventDefault(); lenis.scrollTo(el, { offset: -70 });
        history.replaceState(null, '', id);
      });
      if (window.ScrollTrigger) lenis.on('scroll', ScrollTrigger.update);
    }

    // Satu momen pembuka yang diatur: logo naik dari balik "tanah", judul baris demi baris.
    if (window.gsap) {
      const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
      tl.from('.hero__sun', { scale: .6, opacity: 0, duration: 1.4 })
        .from('#heroLogo', { yPercent: 18, opacity: 0, clipPath: 'inset(100% 0 0 0)', duration: 1.4 }, '<.1')
        .from('.line__in', { yPercent: 110, duration: 1.2, stagger: .12 }, '<.15')
        .from(['.hero__lead', '.hero__ctas', '.hero__facts'], { y: 16, opacity: 0, duration: .9, stagger: .08 }, '<.4');
      if (window.ScrollTrigger) {
        gsap.registerPlugin(ScrollTrigger);
        // Logo sedikit tenggelam saat hero discroll lewat
        gsap.to('#heroLogo', { yPercent: 10, scale: .94, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
      }
    }
  }

  function startRotator() {
    const words = state.data?.site.heroWords?.length ? state.data.site.heroWords : ['tenang', 'bersih', 'aman', 'dekat'];
    const box = $('#rotator');
    let i = 0;
    box.innerHTML = `<span class="rotator__word">${esc(words[0])}</span>`;
    // Lebar kotak mengikuti kata aktif dan bergeser halus, supaya titik di belakangnya ikut rapat.
    const measure = document.createElement('span'); measure.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
    box.appendChild(measure);
    const widthOf = (w) => { measure.textContent = w; return measure.offsetWidth + 'px'; };
    const fit = () => { box.style.width = widthOf(words[i]); };
    document.fonts?.ready.then(fit); fit();
    addEventListener('resize', fit);
    if (reduce || words.length < 2) return;
    setInterval(() => {
      if (document.hidden) return;
      i = (i + 1) % words.length;
      const out = $('.rotator__word', box);
      const inn = document.createElement('span'); inn.className = 'rotator__word'; inn.textContent = words[i];
      out.classList.add('is-out'); box.insertBefore(inn, measure);
      box.style.transition = 'width .7s cubic-bezier(.22,.8,.2,1)'; box.style.width = widthOf(words[i]);
      const ease = 'cubic-bezier(.22,.8,.2,1)';
      out.animate([{ transform: 'translateY(0)', opacity: 1 }, { opacity: 0, offset: 0.45 }, { transform: 'translateY(-100%)', opacity: 0 }], { duration: 700, easing: ease }).onfinish = () => out.remove();
      inn.animate([{ transform: 'translateY(100%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 700, easing: ease });
    }, 2600);
  }

  // ---------- lightbox foto (kos & kamar) ----------
  const lb = document.createElement('dialog');
  lb.className = 'lightbox';
  lb.innerHTML = `<figure><img alt=""><figcaption></figcaption></figure>
    <button type="button" class="lightbox__close" aria-label="Tutup">✕</button>
    <button type="button" class="lightbox__nav lightbox__prev" aria-label="Foto sebelumnya">‹</button>
    <button type="button" class="lightbox__nav lightbox__next" aria-label="Foto berikutnya">›</button>`;
  document.body.appendChild(lb);
  let lbList = [], lbIdx = 0, lbTitle = '';
  const lbShow = () => {
    const img = $('img', lb); img.src = lbList[lbIdx]; img.alt = `${lbTitle}, foto ${lbIdx + 1}`;
    $('figcaption', lb).textContent = `${lbTitle} — ${lbIdx + 1} dari ${lbList.length}`;
    $$('.lightbox__nav', lb).forEach((b) => { b.hidden = lbList.length < 2; });
  };
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-lightbox]'); if (!t || !state.data) return;
    const key = t.dataset.lightbox;
    if (key.startsWith('room:')) { const r = state.data.rooms.find((x) => x.id === key.slice(5)); lbList = r?.photos || []; lbTitle = `Kamar ${r?.code}`; }
    else { const p = state.data.properties.find((x) => x.id === key); lbList = p?.photos || []; lbTitle = p?.name || ''; }
    if (!lbList.length) return;
    lbIdx = Number(t.dataset.index) || 0; lbShow(); lb.showModal();
  });
  $('.lightbox__close', lb).onclick = () => lb.close();
  $('.lightbox__prev', lb).onclick = () => { lbIdx = (lbIdx - 1 + lbList.length) % lbList.length; lbShow(); };
  $('.lightbox__next', lb).onclick = () => { lbIdx = (lbIdx + 1) % lbList.length; lbShow(); };
  lb.addEventListener('click', (e) => { if (e.target === lb) lb.close(); });
  lb.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') $('.lightbox__prev', lb).click();
    if (e.key === 'ArrowRight') $('.lightbox__next', lb).click();
  });

  // ---------- menu di HP ----------
  const menuBtn = $('#menuBtn'), menu = $('#mobileMenu');
  if (menuBtn && menu) {
    const setMenu = (open) => { menu.hidden = !open; menuBtn.setAttribute('aria-expanded', open); menuBtn.textContent = open ? 'Tutup' : 'Menu'; document.body.classList.toggle('menu-open', open); };
    menuBtn.addEventListener('click', () => setMenu(menu.hidden));
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); menuBtn.focus(); } });
  }
})();
