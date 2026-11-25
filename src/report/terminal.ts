import { SEVERITY_TEXT, TRIGGER_TEXT, t } from '../i18n.ts';
import { clean } from '../sanitize.ts';
import type { Change } from '../scan.ts';
import { SEVERITIES, TRIGGERS, rank, type ExecutionPoint, type Lang, type ScanResult, type Severity, type Text } from '../types.ts';

export interface TerminalOptions { lang: Lang; color: boolean; all: boolean; width: number }

const CODES: Record<Severity, string> = { high: '1;31', medium: '33', low: '36', info: '90' };

const painter = (on: boolean) => (code: string, text: string): string => (on ? `\x1b[${code}m${text}\x1b[0m` : text);

export function countBySeverity(points: ExecutionPoint[], lang: Lang): string {
  return [...SEVERITIES].reverse()
    .map((s) => ({ s, n: points.filter((p) => p.severity === s).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} ${SEVERITY_TEXT[x.s][lang].toLowerCase()}${lang === 'es' && x.n > 1 && x.s !== 'info' ? 's' : ''}`)
    .join(', ');
}

function renderPoint(point: ExecutionPoint, o: TerminalOptions, kind?: Change): string[] {
  const paint = painter(o.color);
  const label = SEVERITY_TEXT[point.severity][o.lang];
  const room = Math.max(40, o.width - 11);
  const tag = kind ? `${paint('1', t(o.lang, kind.kind))} ` : '';
  const out = [`  ${paint(CODES[point.severity], label.padEnd(7))} ${tag}${clean(point.title[o.lang], room)}`];
  const line = (text: string): void => { out.push(`          ${text}`); };
  line(paint('2', `${clean(point.file, 120)}:${point.line}`));
  if (point.command) line(`$ ${clean(point.command, room)}`);
  if (kind?.before?.command && kind.before.command !== point.command) {
    line(paint('2', `${t(o.lang, 'before')}: ${clean(kind.before.command, room - 10)}`));
  }
  const shown = point.signals.filter((s) => o.all || rank(s.severity) >= rank('medium')).slice(0, o.all ? 20 : 3);
  for (const s of shown) {
    const where = s.file === point.file && s.line === point.line ? '' : ` (${clean(s.file, 80)}:${s.line})`;
    line(`${paint(CODES[s.severity], '!')} ${s.title[o.lang]}${where}`);
    if (where) line(paint('2', `  ${clean(s.excerpt, room - 4)}`));
  }
  if (point.partial) line(paint('33', t(o.lang, 'partial', { n: point.follows.length })));
  if (point.needs) line(paint('2', `${t(o.lang, 'needs')}: ${clean(point.needs[o.lang], room - 10)}`));
  return out;
}

function renderGroups(points: { point: ExecutionPoint; change?: Change }[], o: TerminalOptions): string[] {
  const paint = painter(o.color);
  const out: string[] = [];
  for (const trigger of TRIGGERS) {
    const group = points.filter((p) => p.point.trigger === trigger);
    if (group.length === 0) continue;
    out.push('', paint('1', TRIGGER_TEXT[trigger][o.lang].toUpperCase()));
    const shown = group.filter((p) => o.all || rank(p.point.severity) >= rank('medium'));
    for (const p of shown) out.push(...renderPoint(p.point, o, p.change));
    const hidden = group.length - shown.length;
    if (hidden > 0) out.push(`  ${paint('2', t(o.lang, 'collapsed', { n: hidden }))}`);
  }
  return out;
}

function renderGaps(gaps: Text[], o: TerminalOptions): string[] {
  if (gaps.length === 0) return [];
  const paint = painter(o.color);
  const out = ['', paint('33', t(o.lang, 'incomplete'))];
  for (const g of gaps.slice(0, 8)) out.push(`  - ${clean(g[o.lang], o.width)}`);
  if (gaps.length > 8) out.push(`  - ${t(o.lang, 'moreGaps', { n: gaps.length - 8 })}`);
  return out;
}

export function renderScan(result: ScanResult, o: TerminalOptions): string {
  const paint = painter(o.color);
  const out = [`${paint('1', 'beforeopen')}  ${clean(result.target, 120)}`];
  out.push(...renderGroups(result.points.map((point) => ({ point })), o));
  out.push('');
  out.push(result.points.length === 0
    ? t(o.lang, 'nothing')
    : t(o.lang, 'summary', { n: result.points.length, files: result.filesListed, detail: countBySeverity(result.points, o.lang) }));
  out.push(paint('2', t(o.lang, 'disclaimer')));
  out.push(...renderGaps(result.gaps, o));
  return `${out.join('\n')}\n`;
}

export function renderDiff(title: string, changes: Change[], gaps: Text[], o: TerminalOptions): string {
  const paint = painter(o.color);
  const out = [`${paint('1', 'beforeopen')}  ${clean(title, 120)}`];
  out.push(...renderGroups(changes.map((change) => ({ point: change.point, change })), o));
  out.push('');
  out.push(changes.length === 0
    ? t(o.lang, 'noNew')
    : t(o.lang, 'diffSummary', { n: changes.length, detail: countBySeverity(changes.map((c) => c.point), o.lang) }));
  out.push(...renderGaps(gaps, o));
  return `${out.join('\n')}\n`;
}
