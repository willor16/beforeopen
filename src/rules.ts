import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { SEVERITIES, TRIGGERS, rank, type Context, type Severity, type Signal, type Text, type Trigger } from './types.ts';
import { shorten } from './sanitize.ts';
import { lineAt } from './json.ts';

/** Raises the severity of an execution point when its text matches. */
export interface SignalRule {
  id: string;
  title: Text;
  severity: Partial<Record<Context, Severity>>;
  patterns: RegExp[];
  unless: RegExp[];
}

/** Declares an execution point without writing code. */
export interface PointRule {
  id: string;
  trigger: Trigger;
  severity: Severity;
  title: Text;
  needs?: Text;
  files: string[];
  exclude: string[];
  /** One point per match. Without it, the file itself is the point. */
  match?: RegExp;
  /** The point also exists when this file is present next to it. */
  sibling?: string;
  /** Whether the matched file is read as a script. */
  script: boolean;
}

/** Common commands that only deserve a low severity. They are still listed. */
export interface KnownRule { id: string; commands: RegExp }

export interface Rules { signals: SignalRule[]; points: PointRule[]; known: KnownRule[] }

export class RuleError extends Error {}

const CONTEXTS: readonly Context[] = ['command', 'script', 'instructions'];

type Yaml = Record<string, unknown>;

export function parseRules(source: string, name: string): Rules {
  const fail = (why: string): never => { throw new RuleError(`${name}: ${why}`); };
  let doc: unknown;
  try {
    doc = parse(source, { maxAliasCount: 0 });
  } catch (e) {
    return fail((e as Error).message);
  }
  const object = (v: unknown, where: string): Yaml =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Yaml) : fail(`${where} must be a map`);
  const list = (v: unknown): unknown[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
  const string = (v: unknown, where: string): string =>
    typeof v === 'string' && v !== '' ? v : fail(`${where} must be a text`);
  const severity = (v: unknown, where: string): Severity =>
    SEVERITIES.includes(v as Severity) ? (v as Severity) : fail(`${where} must be one of ${SEVERITIES.join(', ')}`);
  const regex = (v: unknown, where: string, flags: string): RegExp => {
    try {
      return new RegExp(string(v, where), flags);
    } catch (e) {
      return fail(`${where}: ${(e as Error).message}`);
    }
  };
  const text = (v: unknown, where: string): Text => {
    if (typeof v === 'string') return { en: v, es: v };
    const o = object(v, where);
    const en = string(o['en'], `${where}.en`);
    return { en, es: o['es'] === undefined ? en : string(o['es'], `${where}.es`) };
  };

  const root = object(doc, 'the file');
  for (const key of Object.keys(root)) {
    if (!['signals', 'points', 'known'].includes(key)) fail(`unknown section "${key}"`);
  }
  const only = (o: Yaml, id: string, keys: string[]): void => {
    for (const k of Object.keys(o)) if (!keys.includes(k)) fail(`${id}: unknown field "${k}"`);
  };

  return {
    signals: list(root['signals']).map((raw, i) => {
      const o = object(raw, `signals[${i}]`);
      const id = string(o['id'], `signals[${i}].id`);
      only(o, id, ['id', 'title', 'severity', 'patterns', 'unless', 'flags']);
      const flags = `${o['flags'] === undefined ? 'i' : String(o['flags'])}gu`;
      const bySeverity: Partial<Record<Context, Severity>> = {};
      if (typeof o['severity'] === 'string') {
        for (const c of CONTEXTS) bySeverity[c] = severity(o['severity'], `${id}.severity`);
      } else {
        for (const [c, s] of Object.entries(object(o['severity'], `${id}.severity`))) {
          if (!CONTEXTS.includes(c as Context)) fail(`${id}: unknown context "${c}"`);
          bySeverity[c as Context] = severity(s, `${id}.severity.${c}`);
        }
      }
      const patterns = list(o['patterns']).map((p, n) => regex(p, `${id}.patterns[${n}]`, flags));
      if (patterns.length === 0) fail(`${id}: needs at least one pattern`);
      return {
        id,
        title: text(o['title'], `${id}.title`),
        severity: bySeverity,
        patterns,
        unless: list(o['unless']).map((p, n) => regex(p, `${id}.unless[${n}]`, 'iu')),
      };
    }),
    points: list(root['points']).map((raw, i) => {
      const o = object(raw, `points[${i}]`);
      const id = string(o['id'], `points[${i}].id`);
      only(o, id, ['id', 'trigger', 'severity', 'title', 'needs', 'files', 'exclude', 'match', 'sibling', 'script']);
      const trigger = o['trigger'] as Trigger;
      if (!TRIGGERS.includes(trigger)) fail(`${id}.trigger must be one of ${TRIGGERS.join(', ')}`);
      const files = list(o['files']).map((f, n) => string(f, `${id}.files[${n}]`));
      if (files.length === 0) fail(`${id}: needs at least one file`);
      return {
        id,
        trigger,
        severity: severity(o['severity'], `${id}.severity`),
        title: text(o['title'], `${id}.title`),
        ...(o['needs'] !== undefined && { needs: text(o['needs'], `${id}.needs`) }),
        files,
        exclude: list(o['exclude']).map((f, n) => string(f, `${id}.exclude[${n}]`)),
        ...(o['match'] !== undefined && { match: regex(o['match'], `${id}.match`, 'gimu') }),
        ...(o['sibling'] !== undefined && { sibling: string(o['sibling'], `${id}.sibling`) }),
        script: o['script'] === undefined ? o['match'] === undefined : o['script'] === true,
      };
    }),
    known: list(root['known']).map((raw, i) => {
      const o = object(raw, `known[${i}]`);
      const id = string(o['id'], `known[${i}].id`);
      only(o, id, ['id', 'command']);
      return { id, commands: regex(`^(?:${string(o['command'], `${id}.command`)})$`, `${id}.command`, 'u') };
    }),
  };
}

export function mergeRules(all: Rules[]): Rules {
  const merged: Rules = {
    signals: all.flatMap((r) => r.signals),
    points: all.flatMap((r) => r.points),
    known: all.flatMap((r) => r.known),
  };
  const seen = new Set<string>();
  for (const { id } of [...merged.signals, ...merged.points, ...merged.known]) {
    if (seen.has(id)) throw new RuleError(`Duplicated rule: ${id}`);
    seen.add(id);
  }
  return merged;
}

export function loadRulesFrom(dir: string): Rules {
  const names = readdirSync(dir).filter((n) => /\.ya?ml$/i.test(n)).sort();
  return mergeRules(names.map((n) => parseRules(readFileSync(join(dir, n), 'utf8'), n)));
}

declare const __BEFOREOPEN_RULES__: Record<string, string> | undefined;

/** The build embeds the rules, so the package is a single file. */
export function bundledRules(): Rules {
  if (typeof __BEFOREOPEN_RULES__ !== 'undefined') {
    return mergeRules(Object.entries(__BEFOREOPEN_RULES__).map(([n, s]) => parseRules(s, n)));
  }
  return loadRulesFrom(join(import.meta.dirname, '..', 'rules'));
}

/** First match of every rule in a text. */
export function findSignals(
  rules: Rules, text: string, context: Context, file: string, firstLine = 1,
): Signal[] {
  const body = text;
  const out: Signal[] = [];
  for (const rule of rules.signals) {
    const severity = rule.severity[context];
    if (!severity) continue;
    let found: { index: number; length: number; severity: Severity } | undefined;
    search: for (const pattern of rule.patterns) {
      for (const m of body.matchAll(pattern)) {
        const match = { index: m.index, length: m[0].length };
        // An exception in code would be an easy way to silence a rule, so `unless`
        // only applies to prose. Nothing is dropped: the finding becomes info.
        const excused = context === 'instructions'
          ? rule.unless.some((u) => u.test(around(body, match)))
          : context === 'script' && !rule.id.startsWith('hidden-') && inComment(body, m.index, file);
        if (!excused) {
          found = { ...match, severity };
          break search;
        }
        found ??= { ...match, severity: 'info' };
      }
    }
    if (found) {
      out.push({
        id: rule.id,
        title: rule.title,
        severity: found.severity,
        file,
        line: context === 'command' ? firstLine : lineAt(body, found.index),
        excerpt: excerpt(body, found.index, found.length),
      });
    }
  }
  return out.sort((a, b) => rank(b.severity) - rank(a.severity));
}

const HASH_COMMENTS = /\.(sh|bash|zsh|py|rb|ps1|ya?ml|toml|envrc)$/i;
const SLASH_COMMENTS = /\.([cm]?[jt]sx?|gradle|kts|rs)$/i;
// JavaScript also ends a comment at these two characters.
const LINE_ENDS = new Set([0x0a, 0x0d, 0x2028, 0x2029]);

/** True only for a line that is nothing but a comment. Block comments never count. */
function inComment(text: string, index: number, file: string): boolean {
  const mark = HASH_COMMENTS.test(file) ? '#' : SLASH_COMMENTS.test(file) ? '//' : null;
  if (!mark) return false;
  let start = index;
  while (start > 0 && index - start < 1_000 && !LINE_ENDS.has(text.charCodeAt(start - 1))) start--;
  if (index - start >= 1_000) return false;
  const line = text.slice(start, index + 4).trimStart();
  return line.startsWith(mark) && !line.startsWith('#!');
}

/** The line of a match, cut so that long lines do not cost more. */
function around(text: string, m: { index: number; length: number }): string {
  const before = text.slice(Math.max(0, m.index - 300), m.index);
  const rest = text.slice(m.index, m.index + m.length + 300);
  const end = rest.indexOf('\n', Math.max(0, m.length - 1));
  return before.slice(before.lastIndexOf('\n') + 1) + (end < 0 ? rest : rest.slice(0, end));
}

function excerpt(text: string, index: number, length: number): string {
  const from = Math.max(0, index - 20, text.lastIndexOf('\n', index) + 1);
  const to = Math.min(text.length, index + Math.min(length, 400) + 40);
  const piece = text.slice(from, to);
  const cut = piece.indexOf('\n', index - from + Math.min(length, 400));
  return shorten((cut < 0 ? piece : piece.slice(0, cut)).trim(), 240);
}

export const isKnown = (rules: Rules, command: string): boolean =>
  rules.known.some((k) => k.commands.test(command.trim()));
