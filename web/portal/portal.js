// Portal lama: hapus token lama lalu pindah ke dashboard penghuni.
try { localStorage.removeItem('bonaasina-portal-token'); } catch (e) { /* abaikan */ }
location.replace('/penghuni/');
