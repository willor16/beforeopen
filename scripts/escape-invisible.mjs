// Keeps invisible characters out of the source: they must be written as escapes.
// Code points are listed as numbers so that this file cannot contain any itself.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RANGES = [
  [0x7f, 0xa0], [0xad, 0xad], [0x61c, 0x61c], [0x115f, 0x1160], [0x180e, 0x180e], [0x2000, 0x200f],
  [0x2028, 0x202f], [0x205f, 0x206f], [0x3000, 0x3000], [0x3164, 0x3164], [0xfe00, 0xfe0f], [0xfeff, 0xfeff],
  [0xffa0, 0xffa0], [0xfff9, 0xfffb], [0xe0000, 0xe0fff],
];
const hidden = (c) => RANGES.some(([a, b]) => c >= a && c <= b);

const check = process.argv.includes('--check');
let dirty = 0;
for (const dir of ['src', 'rules', 'test', 'scripts']) {
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const text = readFileSync(path, 'utf8');
    const fixed = [...text].map((c) => (hidden(c.codePointAt(0)) ? String.fromCharCode(92) + 'u{' + c.codePointAt(0).toString(16) + '}' : c)).join('');
    if (fixed === text) continue;
    dirty++;
    console.log(`${check ? 'has invisible characters' : 'fixed'}: ${path}`);
    if (!check) writeFileSync(path, fixed);
  }
}
if (check && dirty > 0) process.exit(1);
