import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join as joinPath, resolve } from 'node:path';
import { parseGitConfig } from '../gitconfig.ts';
import type { Text } from '../types.ts';
import { MAX_FILE_BYTES, type RawTree } from './tree.ts';

/**
 * Git runs programs named in the configuration of the repository it reads
 * (fsmonitor, filters, hooks...). Here git only ever runs inside an empty
 * repository created by us, so the configuration of the target is never used.
 */

export class GitError extends Error {}

const TIMEOUT_MS = 10 * 60_000;
const NULL_DEVICE = '/dev/null';

let gitPath: string | undefined;

/**
 * On Windows, starting "git" by name looks in the current folder before PATH,
 * and that folder may contain a hostile git.exe.
 */
export function findGit(path = process.env['PATH'] ?? '', cwd = process.cwd()): string {
  if (gitPath) return gitPath;
  const name = process.platform === 'win32' ? 'git.exe' : 'git';
  for (const raw of path.split(delimiter)) {
    const dir = raw.replace(/^"|"$/g, '');
    if (!dir || !isAbsolute(dir) || resolve(dir) === resolve(cwd)) continue;
    const full = joinPath(dir, name);
    if (existsSync(full) && statSync(full).isFile()) return (gitPath = full);
  }
  throw new GitError('git was not found in PATH');
}

const scratchDirs = new Set<string>();
const removeScratch = (dir: string): void => {
  scratchDirs.delete(dir);
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ }
};
process.on('exit', () => { for (const d of [...scratchDirs]) removeScratch(d); });

function environment(network: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    // Inherited GIT_* variables could redirect git to another repository.
    if (!/^GIT_/i.test(k) || /^GIT_SSH/i.test(k)) env[k] = v;
  }
  env['GIT_TERMINAL_PROMPT'] = '0';
  env['GCM_INTERACTIVE'] = 'never';
  env['GIT_ASKPASS'] = '';
  env['SSH_ASKPASS'] = '';
  env['LC_ALL'] = 'C';
  if (network) {
    env['GIT_SSH_COMMAND'] ??= 'ssh -oBatchMode=yes';
  } else {
    env['GIT_NO_LAZY_FETCH'] = '1';
    env['GIT_CONFIG_NOSYSTEM'] = '1';
    env['GIT_CONFIG_GLOBAL'] = NULL_DEVICE;
  }
  return env;
}

function run(cwd: string, args: string[], network = false): Promise<Buffer> {
  return new Promise((done, fail) => {
    const child = spawn(findGit(), args, {
      cwd,
      env: environment(network),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: TIMEOUT_MS,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', (e) => fail(new GitError(e.message)));
    child.on('close', (code) => {
      if (child.killed) fail(new GitError('The download took more than 10 minutes and was stopped.'));
      else if (code === 0) done(Buffer.concat(out));
      else fail(new GitError(redact(Buffer.concat(err).toString('utf8').trim()) || `git ${args[0]} failed`));
    });
  });
}

const redact = (s: string): string => s.replace(/(\w+:\/\/)[^\s/@]+@/g, '$1***@');

async function emptyRepository(format: string): Promise<string> {
  const dir = mkdtempSync(joinPath(tmpdir(), 'beforeopen-'));
  scratchDirs.add(dir);
  await run(dir, ['init', '--quiet', '--bare', '--template=', `--object-format=${format}`, '.']);
  return dir;
}

export interface Remote { url: string; ref: string; label: string }

/** Accepts owner/repo, github.com/owner/repo, full URLs and git@host:path. */
export function parseRemote(input: string, ref?: string): Remote | null {
  const target = input.trim();
  if (/[\s\u0000-\u001f]/.test(target) || target.startsWith('-')) return null;
  const remote = (url: string, found = 'HEAD'): Remote | null => {
    const wanted = ref ?? found;
    if (!/^[\w][\w./@+-]*$/.test(wanted) || wanted.includes('..')) return null;
    return { url, ref: wanted, label: redact(url).replace(/^https:\/\//, '').replace(/\.git$/, '') };
  };
  if (/^[\w][\w.-]*\/[\w.-]+$/.test(target) && !/^[\w-]+(\.[\w-]+)+\//.test(target)) {
    return remote(`https://github.com/${target.replace(/\.git$/, '')}.git`);
  }
  const ssh = /^(?:ssh:\/\/)?([\w][\w.-]*)@([\w][\w.-]*)(?::|\/)([\w~][\w./~-]*)$/.exec(target);
  if (ssh) return remote(`ssh://${ssh[1]}@${ssh[2]}/${ssh[3]}`);
  let url: URL;
  try {
    url = new URL(/^https:\/\//i.test(target) ? target : `https://${target}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || (/:\/\//.test(target) && !/^https:/i.test(target))) return null;
  if (!url.hostname.includes('.')) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const auth = url.username ? `${url.username}${url.password ? `:${url.password}` : ''}@` : '';
  const origin = `https://${auth}${url.host}`;
  if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
    const [owner, name, kind, value] = parts;
    const base = `${origin}/${owner}/${name!.replace(/\.git$/, '')}.git`;
    if ((kind === 'tree' || kind === 'blob' || kind === 'commit') && value) return remote(base, value);
    if (kind === 'pull' && value && /^\d+$/.test(value)) return remote(base, `refs/pull/${value}/head`);
    return remote(base);
  }
  return remote(`${origin}/${parts.join('/')}`);
}

/** Downloads the objects of one commit. Nothing is checked out. */
export async function remoteTree(remote: Remote): Promise<RawTree> {
  const dir = await emptyRepository('sha1');
  const hooks = joinPath(dir, 'no-hooks');
  mkdirSync(hooks, { recursive: true });
  const protocol = remote.url.startsWith('ssh:') ? 'ssh' : 'https';
  try {
    await run(dir, ['config', 'remote.origin.url', remote.url]);
    await run(dir, [
      '-c', 'protocol.allow=never',
      '-c', `protocol.${protocol}.allow=always`,
      '-c', `core.hooksPath=${hooks}`,
      '-c', 'core.fsmonitor=false',
      '-c', 'maintenance.auto=false',
      '-c', 'gc.auto=0',
      'fetch', '--quiet', '--depth=1', '--no-tags', '--no-recurse-submodules',
      '--no-write-commit-graph', `--filter=blob:limit=${MAX_FILE_BYTES + 1}`,
      'origin', remote.ref,
    ], true);
    const sha = (await run(dir, ['rev-parse', '--verify', '--end-of-options', 'FETCH_HEAD^{commit}'])).toString().trim();
    return await openTree(dir, sha, `${remote.label} @ ${sha.slice(0, 10)}`, () => removeScratch(dir));
  } catch (e) {
    removeScratch(dir);
    throw e;
  }
}

/** Object access to a local repository through an empty one that borrows its objects. */
export class LocalGit {
  readonly dir: string;
  private readonly common: string;
  private readonly gitDir: string;
  private readonly open: RawTree[] = [];

  private constructor(dir: string, gitDir: string, common: string) {
    this.dir = dir;
    this.gitDir = gitDir;
    this.common = common;
  }

  static async open(path: string): Promise<LocalGit> {
    const gitDir = findGitDir(path);
    if (!gitDir) throw new GitError(`Not a git repository: ${path}`);
    let common = gitDir;
    const commonFile = joinPath(gitDir, 'commondir');
    if (existsSync(commonFile)) common = resolve(gitDir, readFileSync(commonFile, 'utf8').trim());
    let format = 'sha1';
    if (existsSync(joinPath(common, 'config'))) {
      const entries = parseGitConfig(readFileSync(joinPath(common, 'config'), 'utf8'));
      if (entries.some((e) => e.key === 'extensions.objectformat' && e.value === 'sha256')) format = 'sha256';
    }
    const dir = await emptyRepository(format);
    mkdirSync(joinPath(dir, 'objects', 'info'), { recursive: true });
    writeFileSync(joinPath(dir, 'objects', 'info', 'alternates'), `${joinPath(common, 'objects').replace(/\\/g, '/')}\n`);
    return new LocalGit(dir, gitDir, common);
  }

  /** Commit for a branch, tag, SHA or HEAD, with optional ~ and ^ suffixes. */
  async resolve(rev: string): Promise<string> {
    const m = /^([\w][\w./@+-]*?)((?:[~^]\d*)*)$/.exec(rev);
    if (!m) throw new GitError(`Invalid revision: ${rev}`);
    const name = this.readRef(m[1]!) ?? (/^[0-9a-f]{4,64}$/i.test(m[1]!) ? m[1]! : null);
    if (!name) throw new GitError(`Unknown revision: ${rev}`);
    return this.verify(name + m[2]!);
  }

  async mergeBase(a: string, b: string): Promise<string> {
    return (await run(this.dir, ['merge-base', a, b])).toString().trim();
  }

  async parents(sha: string): Promise<string[]> {
    const body = (await run(this.dir, ['cat-file', 'commit', sha])).toString('utf8');
    return [...body.split('\n\n')[0]!.matchAll(/^parent ([0-9a-f]+)$/gm)].map((p) => p[1]!);
  }

  async tree(sha: string, label: string): Promise<RawTree> {
    const tree = await openTree(this.dir, sha, label, () => {});
    this.open.push(tree);
    return tree;
  }

  async close(): Promise<void> {
    await Promise.all(this.open.map((t) => t.close()));
    removeScratch(this.dir);
  }

  private async verify(name: string): Promise<string> {
    try {
      return (await run(this.dir, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${name}^{commit}`])).toString().trim();
    } catch {
      throw new GitError(`Commit not available: ${name}. In a shallow clone, fetch more history.`);
    }
  }

  private readRef(name: string, depth = 0): string | null {
    if (depth > 5 || name.split('/').includes('..')) return null;
    const candidates = [name, `refs/${name}`, `refs/tags/${name}`, `refs/heads/${name}`, `refs/remotes/${name}`];
    const packed = joinPath(this.common, 'packed-refs');
    const lines = existsSync(packed) ? readFileSync(packed, 'utf8').split(/\r?\n/) : [];
    for (const ref of candidates) {
      if (!/^(HEAD|[A-Z_]+_HEAD|refs\/.+)$/.test(ref)) continue;
      for (const dir of new Set([this.gitDir, this.common])) {
        const file = joinPath(dir, ref);
        if (!existsSync(file) || !statSync(file).isFile()) continue;
        const value = readFileSync(file, 'utf8').trim();
        if (value.startsWith('ref: ')) return this.readRef(value.slice(5).trim(), depth + 1);
        const sha = /^[0-9a-f]{40,64}/.exec(value);
        if (sha) return sha[0];
      }
      const line = lines.find((l) => l.endsWith(` ${ref}`) && /^[0-9a-f]{40,64} /.test(l));
      if (line) return line.split(' ')[0]!;
    }
    return null;
  }
}

function findGitDir(start: string): string | null {
  for (let dir = resolve(start); ; dir = resolve(dir, '..')) {
    const dot = joinPath(dir, '.git');
    if (existsSync(dot)) {
      if (statSync(dot).isDirectory()) return dot;
      const m = /^gitdir: (.+)$/m.exec(readFileSync(dot, 'utf8'));
      return m ? resolve(dir, m[1]!.trim()) : null;
    }
    if (existsSync(joinPath(dir, 'HEAD')) && existsSync(joinPath(dir, 'objects'))) return dir;
    if (resolve(dir, '..') === dir) return null;
  }
}

/** Reads files straight from the object database. */
async function openTree(dir: string, sha: string, label: string, onClose: () => void): Promise<RawTree> {
  const listing = (await run(dir, ['ls-tree', '-r', '-z', '--full-tree', sha])).toString('utf8');
  const shas = new Map<string, string>();
  const links: RawTree['links'] = [];
  const gaps: Text[] = [];
  const linkEntries: { path: string; sha: string }[] = [];
  for (const line of listing.split('\0')) {
    const m = /^(\d{6}) (blob|commit) ([0-9a-f]+)\t([\s\S]+)$/.exec(line);
    if (!m) continue;
    if (m[1] === '120000') linkEntries.push({ path: m[4]!, sha: m[3]! });
    else if (m[2] === 'blob') shas.set(m[4]!, m[3]!);
  }
  const objects = new ObjectReader(dir);
  for (const l of linkEntries) {
    const body = await objects.read(l.sha);
    if (body) links.push({ path: l.path, target: Buffer.from(body).toString('utf8') });
    else gaps.push({ en: `Could not read the link ${l.path}`, es: `No se pudo leer el enlace ${l.path}` });
  }
  return {
    label,
    files: [...shas.keys()],
    links,
    gaps,
    read: async (path) => {
      const id = shas.get(path);
      return id ? objects.read(id) : null;
    },
    close: async () => {
      await objects.close();
      onClose();
    },
  };
}

/** One long-lived `git cat-file --batch`. Requests are answered in order. */
class ObjectReader {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiting: ((b: Uint8Array | null) => void)[] = [];
  private chunks: Buffer[] = [];
  private size = 0;
  private expected: number | null = null;
  private ended = false;

  constructor(dir: string) {
    this.child = spawn(findGit(), ['cat-file', '--batch'], { cwd: dir, env: environment(false), windowsHide: true });
    this.child.stdout.on('data', (c: Buffer) => { this.chunks.push(c); this.size += c.length; this.drain(); });
    this.child.stderr.resume();
    this.child.stdin.on('error', () => {});
    const finish = (): void => {
      this.ended = true;
      for (const w of this.waiting.splice(0)) w(null);
    };
    this.child.on('error', finish);
    this.child.on('close', finish);
  }

  read(sha: string): Promise<Uint8Array | null> {
    if (this.ended) return Promise.resolve(null);
    return new Promise((done) => {
      this.waiting.push(done);
      this.child.stdin.write(`${sha}\n`);
    });
  }

  close(): Promise<void> {
    if (this.ended) return Promise.resolve();
    return new Promise((done) => {
      this.child.once('close', () => done());
      this.child.stdin.end();
    });
  }

  private drain(): void {
    for (;;) {
      // Joining only when a whole message has arrived keeps this linear.
      if (this.expected !== null && this.size < this.expected + 1) return;
      const buffer = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks);
      this.chunks = [buffer];
      if (this.expected === null) {
        const end = buffer.indexOf(10);
        if (end < 0) return;
        const m = /^[0-9a-f]+ \w+ (\d+)$/.exec(buffer.subarray(0, end).toString());
        this.keep(buffer.subarray(end + 1));
        if (m) this.expected = Number(m[1]);
        else this.waiting.shift()?.(null);
        continue;
      }
      const body = buffer.subarray(0, this.expected);
      this.keep(buffer.subarray(this.expected + 1));
      this.waiting.shift()?.(this.expected > MAX_FILE_BYTES ? null : body);
      this.expected = null;
    }
  }

  private keep(rest: Buffer): void {
    this.chunks = [rest];
    this.size = rest.length;
  }
}
