import { createHash } from 'node:crypto';
import { detectors } from './detectors/index.ts';
import { canonical, globToRegExp, matches } from './paths.ts';
import { BINARY, follow } from './references.ts';
import { broadSignals, findSignals, isKnown, type Rules } from './rules.ts';
import { RepoView, type RawTree } from './tree/tree.ts';
import { TRIGGERS, rank, worst, type ExecutionPoint, type RawPoint, type ScanResult, type Severity, type Signal } from './types.ts';

/** Source files where hidden code is searched even if nothing runs them by itself. */
const SOURCE = /\.([cm]?[jt]sx?|py|pyw|rb|php|pl|lua|sh|bash|zsh|ps1|bat|cmd|vbs|go|rs|cs|vb)$/;
const NOT_SOURCE = /(^|\/)(node_modules|\.git|\.yarn|\.pnp\.[cm]?js)(\/|$)/;
/** Tests and copies of other projects hold strange code on purpose. */
const SAMPLES = /(^|\/)(tests?|__tests__|specs?|testdata|test-data|fixtures?|__fixtures__|baselines?|snapshots?|examples?|benchmarks?|vendor|third[_-]?party|external)\/|[._-](test|spec|bench)\.\w+$|(^|\/)test_[^/]+$/;
const MAX_SOURCE_BYTES = 1024 * 1024;
const READ_AHEAD = 128;

export interface ScanOptions {
  /** Files known to be the same on both sides of a comparison. */
  unchanged?: (path: string) => boolean;
}

export async function scan(tree: RawTree, rules: Rules, options: ScanOptions = {}): Promise<ScanResult> {
  const view = new RepoView(tree);
  const raw: RawPoint[] = [];
  const all = detectors(rules);
  // One expression for every glob discards most files at once.
  const any = new RegExp(all.flatMap((d) => d.files).map((g) => globToRegExp(g).source).join('|'));
  const candidates = view.files.filter((f) => any.test(f.canon));
  for (const detector of all) {
    for (const file of candidates) {
      if (matches(file.canon, detector.files)) raw.push(...(await detector.detect(view, file)));
    }
  }
  for (const link of view.escapingLinks) {
    raw.push({
      id: 'link-outside', trigger: 'editor', file: link.path, line: 1, key: 'link',
      title: { en: 'Symbolic link to a place outside the repository', es: 'Enlace simbólico a un lugar fuera del repositorio' },
      severity: /(^|\/)\.(ssh|aws|gnupg|kube|docker|npmrc|netrc|bash\w*|zsh\w*|profile|config)(\/|$)/i.test(link.target) ? 'high' : 'low',
      command: link.target,
    });
  }

  for (const file of view.files) {
    // Right-to-left marks in a name make `exe.txt` look like `txt.exe`.
    if (!/[\u{200e}\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}]/u.test(file.path)) continue;
    raw.push({
      id: 'disguised-name', trigger: 'run', file: file.path, line: 1, key: 'name', severity: 'high',
      title: { en: 'File name written to look like another one', es: 'Nombre de archivo escrito para parecer otro' },
    });
  }

  const points: ExecutionPoint[] = [];
  const scripts = new Map<string, Promise<ScriptFacts>>();
  const seen = new Set<string>();
  for (const point of raw) {
    const id = `${point.id}\0${point.file}\0${point.key}\0${point.command ?? ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    points.push(await evaluate(view, rules, point, scripts));
  }
  points.push(...(await hiddenCode(view, rules, points, options)));
  points.sort((a, b) =>
    TRIGGERS.indexOf(a.trigger) - TRIGGERS.indexOf(b.trigger) ||
    rank(b.severity) - rank(a.severity) ||
    a.file.split('/').length - b.file.split('/').length ||
    (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
    a.line - b.line);
  return { target: view.label, points, filesListed: view.files.length, gaps: view.gaps };
}

/** Points whose "command" is the value of a setting, not something to run. */
const SETTINGS = new Set(['vscode/program-setting', 'agent/auto-approve', 'agent/plugins', 'agent/redirect', 'agent/inject']);

/** Code that tries not to be seen, anywhere in the repository. */
async function hiddenCode(
  view: RepoView, rules: Rules, points: ExecutionPoint[], options: ScanOptions,
): Promise<ExecutionPoint[]> {
  // What a known execution point already reports is not repeated.
  const reported = new Set(points.filter((p) => rank(p.severity) >= rank('medium')).flatMap((p) => [p.file, ...p.follows]));
  const out: ExecutionPoint[] = [];
  const sources = view.files.filter((file) =>
    SOURCE.test(file.canon) && !NOT_SOURCE.test(file.canon) && !reported.has(file.path) && !options.unchanged?.(file.real));
  for (let i = 0; i < sources.length; i += READ_AHEAD) {
    const batch = sources.slice(i, i + READ_AHEAD);
    const texts = await Promise.all(batch.map((file) => view.peek(file.path, MAX_SOURCE_BYTES)));
    for (const [n, file] of batch.entries()) {
      const text = texts[n] ?? null;
      if (text === null) continue;
      const signals = findSignals(rules, text, 'script', file.path, 1, true).filter((s) => rank(s.severity) >= rank('medium'));
      if (signals.length === 0) continue;
      out.push({
        id: 'code/hidden', trigger: 'run', file: file.path, line: signals[0]!.line, key: 'hidden',
        title: { en: 'Code that tries not to be seen', es: 'Código que intenta no ser visto' },
        severity: SAMPLES.test(file.canon) ? 'low' : signals.reduce((s, x) => worst(s, x.severity), 'medium' as Severity),
        signals, follows: [], partial: false,
        fingerprint: createHash('sha256').update(text).digest('hex').slice(0, 16),
      });
    }
  }
  return out;
}

/** The same script is often reached from many points. */
interface ScriptFacts { signals: Signal[]; digest: string }

async function readScript(view: RepoView, rules: Rules, file: string): Promise<ScriptFacts> {
  const text = await view.text(file);
  if (text === null) return { signals: [], digest: 'unreadable' };
  // Only by name: a script with a stray null character still runs.
  const binary = BINARY.test(file) && text.includes(String.fromCharCode(0));
  return {
    signals: binary ? [] : findSignals(rules, text, 'script', file),
    digest: createHash('sha256').update(text).digest('hex'),
  };
}

async function evaluate(
  view: RepoView, rules: Rules, point: RawPoint, scripts: Map<string, Promise<ScriptFacts>>,
): Promise<ExecutionPoint> {
  const hash = createHash('sha256').update(`${point.id}\0${point.key}\0${point.command ?? ''}`);
  const signals: Signal[] = [...(point.signals ?? [])];
  if (point.command) signals.push(...findSignals(rules, point.command, 'command', point.file, point.line));
  if (point.instructions !== undefined) {
    signals.push(...findSignals(rules, point.instructions, 'instructions', point.file));
    hash.update(point.instructions);
  }

  const reached = await follow(view, {
    ...(point.command !== undefined && { command: point.command }),
    ...(point.cwd !== undefined && { cwd: point.cwd }),
    ...(point.runs && { runs: point.runs }),
    // Ordinary project files lead to the whole program, so only their surroundings are read.
    ...(point.severity === 'info' && { maxDepth: 1 }),
  });
  for (const c of reached.commands) {
    hash.update(`\0${c.text}`);
    signals.push(...findSignals(rules, c.text, 'command', c.file, c.line));
  }
  for (const file of reached.files) {
    let facts = scripts.get(file);
    if (!facts) scripts.set(file, (facts = readScript(view, rules, file)));
    const { signals: found, digest } = await facts;
    hash.update(`${file} ${digest}`);
    // Ordinary project files also lead to tests, which hold strange code on purpose.
    const sample = point.severity === 'info' && SAMPLES.test(canonical(file));
    signals.push(...found.map((s) => (sample && rank(s.severity) > rank('low') ? { ...s, severity: 'low' as const } : s)));
  }
  const partial = reached.partial && point.severity !== 'info';

  if (point.instructions !== undefined) {
    // Text can tell an agent to run a script. Only code that hides itself counts here.
    const broad = broadSignals(rules);
    for (const command of writtenCommands(point.instructions)) {
      const told = await follow(view, { command, cwd: projectOf(point.file), maxDepth: 2 });
      for (const file of told.files) {
        let facts = scripts.get(file);
        if (!facts) scripts.set(file, (facts = readScript(view, rules, file)));
        const { signals: found, digest } = await facts;
        const strong = found.filter((s) => s.severity === 'high' && broad.has(s.id));
        if (strong.length === 0) continue;
        hash.update(`${file} ${digest}`);
        signals.push(...strong);
      }
    }
  }

  const unique = signals
    .filter((s, i) => signals.findIndex((o) => o.id === s.id && o.file === s.file) === i)
    .sort((a, b) => rank(b.severity) - rank(a.severity));
  const base = point.command && point.severity === 'medium' && !SETTINGS.has(point.id) && isKnown(rules, point.command) ? 'low' : point.severity;
  const { cwd: _cwd, runs: _runs, instructions: _text, signals: _signals, ...rest } = point;
  return {
    ...rest,
    // Hiding a payload behind hundreds of files must not make it look harmless.
    severity: unique.reduce((s, x) => worst(s, x.severity), partial ? worst(base, 'medium') : base),
    signals: unique,
    follows: reached.files,
    partial,
    fingerprint: hash.digest('hex').slice(0, 16),
  };
}

/** Commands between backticks or in code blocks. */
function writtenCommands(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]{3,300})`/g)) out.add(m[1]!);
  for (const block of text.matchAll(/```[^\n]*\n([\s\S]{1,4000}?)```/g)) {
    for (const line of block[1]!.split(/\r?\n/)) if (line.trim()) out.add(line.trim().replace(/^\$ /, ''));
  }
  return [...out].filter((c) => /[\w./-]+\.\w{1,5}\b/.test(c)).slice(0, 100);
}

/** Folder that instructions are about: the one that holds their `.cursor`, for example. */
const projectOf = (path: string): string => {
  const parts = path.split('/').slice(0, -1);
  const dot = parts.findIndex((p) => p.startsWith('.'));
  return (dot < 0 ? parts : parts.slice(0, dot)).join('/');
};

export interface Change {
  kind: 'added' | 'modified';
  point: ExecutionPoint;
  before?: ExecutionPoint;
}

/** Execution points that the new tree has and the old one does not. */
export function compare(before: ScanResult, after: ScanResult): Change[] {
  const identity = (p: ExecutionPoint): string => `${p.id}\0${p.file.toLowerCase()}\0${p.key}`;
  const old = new Map<string, ExecutionPoint[]>();
  for (const p of before.points) old.set(identity(p), [...(old.get(identity(p)) ?? []), p]);
  const out: Change[] = [];
  for (const point of after.points) {
    const same = old.get(identity(point));
    if (!same) out.push({ kind: 'added', point });
    else if (!same.some((p) => p.fingerprint === point.fingerprint)) {
      out.push({ kind: 'modified', point, before: same[0]! });
    }
  }
  return out;
}
