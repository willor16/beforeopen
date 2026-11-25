import { createHash } from 'node:crypto';
import { detectors } from './detectors/index.ts';
import { globToRegExp, matches } from './paths.ts';
import { BINARY, follow } from './references.ts';
import { findSignals, isKnown, type Rules } from './rules.ts';
import { RepoView, type RawTree } from './tree/tree.ts';
import { TRIGGERS, rank, worst, type ExecutionPoint, type RawPoint, type ScanResult, type Signal } from './types.ts';

export async function scan(tree: RawTree, rules: Rules): Promise<ScanResult> {
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

  const points: ExecutionPoint[] = [];
  const scripts = new Map<string, Promise<ScriptFacts>>();
  const seen = new Set<string>();
  for (const point of raw) {
    const id = `${point.id}\0${point.file}\0${point.key}\0${point.command ?? ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    points.push(await evaluate(view, rules, point, scripts));
  }
  points.sort((a, b) =>
    TRIGGERS.indexOf(a.trigger) - TRIGGERS.indexOf(b.trigger) ||
    rank(b.severity) - rank(a.severity) ||
    a.file.split('/').length - b.file.split('/').length ||
    (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
    a.line - b.line);
  return { target: view.label, points, filesListed: view.files.length, gaps: view.gaps };
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
    signals.push(...found);
  }
  const partial = reached.partial && point.severity !== 'info';

  const unique = signals
    .filter((s, i) => signals.findIndex((o) => o.id === s.id && o.file === s.file) === i)
    .sort((a, b) => rank(b.severity) - rank(a.severity));
  const base = point.command && point.severity === 'medium' && isKnown(rules, point.command) ? 'low' : point.severity;
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
