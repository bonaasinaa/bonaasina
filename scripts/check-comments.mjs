#!/usr/bin/env node
// Penjaga komentar antislop-code: hanya pola mekanis. Pakai: node scripts/check-comments.mjs [--strict]
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STRICT = process.argv.includes('--strict');
const EXT = new Set(['.js', '.mjs', '.ts', '.css', '.html', '.sql', '.yml', '.yaml']);
const SKIP = new Set(['.git', 'node_modules', 'vendor', 'fonts', 'assets', 'anti-slop', 'skills']);

// Header file yang boleh lebih dari dua baris. Daftar boleh menyusut, tidak boleh bertambah.
const ALLOW_BLOCK = new Set([]);

const BANNER = /^(?:\/\/|--|#|\/\*|\*)\s*[-=*#~_]{4,}/;
const STEP = /^(?:\/\/|--|#|\/\*|\*)?\s*(?:step|langkah)\s*\d/i;
const TODO = /\b(?:todo|fixme|xxx)\b/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const HEX = /^#?[0-9a-f]{3,8}$/i;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) walk(full, out);
    } else if (EXT.has(extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

// Komentar di awal baris saja. Komentar ekor baris dilewati supaya URL dan pola di dalam string tidak ikut tertandai.
function commentsOf(path, lines) {
  const ext = extname(path);
  const out = [];
  let block = false;
  let html = false;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (ext === '.html') {
      if (html) {
        out.push([i + 1, s]);
        if (s.includes('-->')) html = false;
      } else if (s.startsWith('<!--')) {
        out.push([i + 1, s]);
        html = !s.includes('-->');
      }
      continue;
    }
    if (ext === '.js' || ext === '.mjs' || ext === '.ts' || ext === '.css') {
      if (block) {
        out.push([i + 1, s]);
        if (s.includes('*/')) block = false;
      } else if (s.startsWith('/*')) {
        out.push([i + 1, s]);
        block = !s.includes('*/');
      } else if (s.startsWith('//')) {
        out.push([i + 1, s]);
      }
      continue;
    }
    const mark = ext === '.sql' ? '--' : '#';
    if (s.startsWith(mark)) out.push([i + 1, s]);
  }
  return out;
}

function bodyOf(line) {
  return line.replace(/^(?:\/\/|--|#|\/\*|\*|<!--)\s*/, '').replace(/\s*\*\/\s*$/, '').replace(/\s*-->\s*$/, '').trim();
}

const findings = [];
let files = 0;
let commentLines = 0;

for (const path of walk(ROOT)) {
  const rel = relative(ROOT, path).split('\\').join('/');
  const lines = readFileSync(path, 'utf8').split('\n');
  const comments = commentsOf(path, lines);
  files++;
  commentLines += comments.length;

  for (const [lineNo, raw] of comments) {
    const body = bodyOf(raw);
    if (!body) continue;
    if (BANNER.test(raw)) findings.push([rel, lineNo, 'pemisah dekoratif', raw]);
    if (EMOJI.test(raw)) findings.push([rel, lineNo, 'emoji', raw]);
    if (STEP.test(body)) findings.push([rel, lineNo, 'narasi langkah', raw]);
    if (TODO.test(body) && !/:\s*\S/.test(body)) findings.push([rel, lineNo, 'TODO tanpa tugas', raw]);
    const letters = body.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 4 && letters === letters.toUpperCase() && !HEX.test(body)) {
      findings.push([rel, lineNo, 'label KAPITAL', raw]);
    }
  }

  let run = [];
  for (const item of [...comments, [Infinity, null]]) {
    if (run.length && item[0] === run[run.length - 1][0] + 1) {
      run.push(item);
    } else {
      if (run.length > 2 && !ALLOW_BLOCK.has(`${rel}:${run[0][0]}`)) {
        findings.push([rel, run[0][0], `blok ${run.length} baris`, run[0][1]]);
      }
      run = item[1] === null ? [] : [item];
    }
  }
}

const notes = findings.filter((f) => f[2].startsWith('blok '));
const violations = findings.filter((f) => !f[2].startsWith('blok '));
const shown = STRICT ? findings : violations;

for (const [file, line, kind, raw] of shown) {
  console.log(`${file}:${line}  [${kind}]  ${raw.slice(0, 110)}`);
}

console.log(`\n${files} file, ${commentLines} baris komentar, ${violations.length} pelanggaran, ${notes.length} catatan blok.`);
if (violations.length || (STRICT && notes.length)) {
  console.log('Gagal: rapikan komentar di atas.');
  process.exitCode = 1;
}
