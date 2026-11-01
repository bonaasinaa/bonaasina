// Tahun berjalan di footer halaman kos statis. Dipisah karena CSP memblokir skrip inline.
document.getElementById('year').textContent = new Date().getFullYear();
