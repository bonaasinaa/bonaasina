// Penjaga aturan UI yang sudah dirapikan: jarak, berat font, versi aset, alt, dan outline.
// Tanpa browser, supaya bisa jalan di CI seperti check-comments.mjs.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = new URL('../web/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SKIP = new Set(['vendor', 'fonts', 'assets', 'portal']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!SKIP.has(name)) walk(p, out); }
    else if (['.html', '.css', '.js'].includes(extname(p))) out.push(p);
  }
  return out;
}

// Properti jarak yang wajib kelipatan 4 (kecuali di bawah 5px dan nilai hitungan).
const SPACING = /(margin(?:-(?:top|right|bottom|left))?|padding(?:-(?:top|right|bottom|left))?|gap|row-gap|column-gap)\s*:\s*([^;{}]+)/g;
const WEIGHT = /font(?:-weight)?\s*:\s*([^;{}]+)/g;
const ALLOWED_WEIGHTS = new Set([400, 500, 600, 700]);

const problems = [];
const say = (file, line, rule, detail) => problems.push({ file, line, rule, detail });

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  if (extname(file) === '.css') {
    lines.forEach((ln, i) => {
      const n = i + 1;
      // Jarak di luar kelipatan 4
      for (const m of ln.matchAll(SPACING)) {
        const value = m[2];
        if (/(clamp|calc|var|env)\(|%|em\b|rem\b/.test(value)) continue;
        for (const tok of value.matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
          if (tok[1].startsWith('-')) continue; // offset optis, bukan jarak ritme
          const v = Math.abs(parseFloat(tok[1]));
          if (v < 5 || v % 4 === 0) continue;
          say(rel, n, 'jarak', `${m[1]}: ${v}px (bukan kelipatan 4)`);
        }
      }
      // Berat font yang tidak ada filenya
      for (const m of ln.matchAll(WEIGHT)) {
        const w = /([1-9]00)\b/.exec(m[1]);
        if (w && !ALLOWED_WEIGHTS.has(Number(w[1]))) say(rel, n, 'berat font', `${w[1]} tidak tersedia (400/500/600/700)`);
      }
      // outline: none tanpa pengganti di blok yang sama
      if (/outline\s*:\s*(none|0)/.test(ln) && !/(border|box-shadow)/.test(ln) && !/\{.*\}/.test(ln)) {
        say(rel, n, 'fokus', 'outline dimatikan tanpa border/box-shadow di baris yang sama');
      }
    });
  }

  if (extname(file) === '.html') {
    lines.forEach((ln, i) => {
      const n = i + 1;
      // Aset CSS/JS wajib punya ?v=
      for (const m of ln.matchAll(/(?:href|src)="(\/(?:css|js)\/[^"?]+\.(?:css|js))(\?[^"]*)?"/g)) {
        if (!m[2] || !/[?&]v=/.test(m[2])) say(rel, n, 'cache', `${m[1]} tanpa ?v=`);
      }
      // Semua gambar punya alt
      for (const m of ln.matchAll(/<img\b[^>]*>/g)) {
        if (!/\balt=/.test(m[0])) say(rel, n, 'alt', `<img> tanpa alt: ${m[0].slice(0, 60)}`);
      }
    });
  }
}

if (problems.length) {
  for (const p of problems) console.error(`${p.file}:${p.line} [${p.rule}] ${p.detail}`);
  console.error(`\n${problems.length} masalah UI.`);
  process.exit(1);
}
console.log('Aturan UI: 0 masalah (jarak kelipatan 4, berat font 400-700, ?v= aset, alt gambar, outline fokus).');
