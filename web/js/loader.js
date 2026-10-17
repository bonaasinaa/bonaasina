/* Layar muat penuh Bonaasina — dipakai admin & dashboard penghuni.
   Muncul hanya bila proses lebih lama dari ~120 ms (supaya tidak berkedip saat data sudah ada di cache),
   dan bila sudah muncul tampil minimal 300 ms supaya tidak terasa seperti kilatan. */
window.BonaLoader = (() => {
  let el = null, showTimer = 0, hideTimer = 0, shownAt = 0, active = 0;
  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'loader'; el.hidden = true;
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="loader__box"><img class="loader__mark" src="/assets/img/mark.webp" alt="" width="84" height="57"><p class="loader__text">Memuat…</p><div class="loader__bar" aria-hidden="true"><span></span></div></div>';
    document.body.appendChild(el);
    return el;
  }
  function show(text = 'Memuat…', delay = 120) {
    ensure(); active++;
    el.querySelector('.loader__text').textContent = text;
    clearTimeout(hideTimer);
    if (!el.hidden) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      if (!active) return;
      el.hidden = false; void el.offsetWidth; el.classList.add('is-on'); shownAt = Date.now();
      document.documentElement.setAttribute('aria-busy', 'true');
    }, delay);
  }
  function hide() {
    active = Math.max(0, active - 1);
    if (active) return;
    clearTimeout(showTimer);
    if (!el || el.hidden) return;
    hideTimer = setTimeout(() => {
      el.classList.remove('is-on');
      document.documentElement.removeAttribute('aria-busy');
      setTimeout(() => { if (!el.classList.contains('is-on')) el.hidden = true; }, 220);
    }, Math.max(0, 300 - (Date.now() - shownAt)));
  }
  // Jalankan sebuah proses sambil menampilkan layar muat.
  async function during(text, fn) { show(text); try { return await fn(); } finally { hide(); } }
  function reset() { active = 1; hide(); }
  return { show, hide, during, reset };
})();
