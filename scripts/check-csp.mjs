// Penjaga CSP: skrip inline dilarang, dan setiap sumber luar harus diizinkan direktifnya.
// Tanpa browser, supaya bisa jalan di CI seperti check-ui.mjs.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = new URL('../web/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SKIP = new Set(['vendor', 'fonts', 'assets', 'portal']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!SKIP.has(name)) walk(p, out); }
    else if (extname(p) === '.html') out.push(p);
  }
  return out;
}

function directive(csp, name) {
  const part = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + ' '));
  return part ? part.split(/\s+/).slice(1) : [];
}

function allowed(list, url) {
  if (url.startsWith('/') || url.startsWith('data:')) return true;
  let origin;
  try { origin = new URL(url).origin; } catch { return true; }
  return list.some((entry) => {
    if (entry === "'self'") return false;
    const pattern = entry.replace(/^https:\/\//, '').replace(/^http:\/\//, '');
    const host = origin.replace(/^https:\/\//, '').replace(/^http:\/\//, '');
    if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1)) || host === pattern.slice(2);
    return host === pattern;
  });
}

const headers = readFileSync(join(ROOT, '_headers'), 'utf8');
const cspLine = headers.split(/\r?\n/).find((l) => l.trim().startsWith('Content-Security-Policy:'));
if (!cspLine) {
  console.error('web/_headers: baris Content-Security-Policy tidak ditemukan.');
  process.exit(1);
}
const csp = cspLine.slice(cspLine.indexOf(':') + 1).trim();
const scriptSrc = directive(csp, 'script-src');
const styleSrc = directive(csp, 'style-src');
const imgSrc = directive(csp, 'img-src');

const problems = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const html = readFileSync(file, 'utf8');
  const lines = html.split('\n');

  lines.forEach((line, i) => {
    // Skrip inline diblokir CSP. Blok data ld+json bukan skrip yang dieksekusi, jadi dikecualikan.
    const inline = line.match(/<script(?![^>]*\bsrc=)([^>]*)>(.*?)<\/script>/i);
    if (inline && !/application\/ld\+json/i.test(inline[1])) {
      problems.push({ file: rel, line: i + 1, rule: 'inline-script', detail: 'skrip inline diblokir CSP; pindahkan ke berkas di web/js/' });
    }
    for (const m of line.matchAll(/<script[^>]*\bsrc="([^"]+)"/gi)) {
      if (!allowed(scriptSrc, m[1])) problems.push({ file: rel, line: i + 1, rule: 'script-src', detail: `${m[1]} tidak ada di script-src` });
    }
    for (const m of line.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/gi)) {
      if (!allowed(styleSrc, m[1])) problems.push({ file: rel, line: i + 1, rule: 'style-src', detail: `${m[1]} tidak ada di style-src` });
    }
    for (const m of line.matchAll(/<img[^>]*\bsrc="([^"]+)"/gi)) {
      if (!allowed(imgSrc, m[1])) problems.push({ file: rel, line: i + 1, rule: 'img-src', detail: `${m[1]} tidak ada di img-src` });
    }
  });
}

if (problems.length) {
  for (const p of problems) console.error(`${p.file}:${p.line} [${p.rule}] ${p.detail}`);
  console.error(`\n${problems.length} masalah CSP.`);
  process.exit(1);
}
console.log(`Aturan CSP: 0 masalah (${scriptSrc.length} sumber skrip diizinkan, tanpa skrip inline).`);
