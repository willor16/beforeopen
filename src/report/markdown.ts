import { SEVERITY_TEXT, TRIGGER_TEXT, t } from '../i18n.ts';
import { markdown } from '../sanitize.ts';
import type { Change } from '../scan.ts';
import { rank, type ExecutionPoint, type Lang, type Text } from '../types.ts';
import { countBySeverity } from './terminal.ts';

const MAX_ROWS = 50;

/** A table where everything that comes from the repository renders literally. */
export function renderMarkdown(
  title: string, rows: { point: ExecutionPoint; change?: Change }[], gaps: Text[], lang: Lang,
): string {
  const out = [`### beforeopen: ${markdown(title, 120)}`, ''];
  if (rows.length === 0) {
    out.push(t(lang, rows.length === 0 ? 'noNew' : 'nothing'));
  } else {
    out.push(t(lang, 'diffSummary', { n: rows.length, detail: countBySeverity(rows.map((r) => r.point), lang) }), '');
    out.push(`| ${t(lang, 'severity')} | ${t(lang, 'when')} | ${t(lang, 'where')} | ${t(lang, 'what')} |`, '| --- | --- | --- | --- |');
    const sorted = [...rows].sort((a, b) => rank(b.point.severity) - rank(a.point.severity));
    for (const { point, change } of sorted.slice(0, MAX_ROWS)) {
      const reasons = point.signals.filter((s) => rank(s.severity) >= rank('medium')).slice(0, 3)
        .map((s) => `<br>**${s.title[lang]}** (${markdown(`${s.file}:${s.line}`, 100)})`);
      out.push([
        '',
        `${SEVERITY_TEXT[point.severity][lang]}${change ? `<br>${t(lang, change.kind)}` : ''}`,
        TRIGGER_TEXT[point.trigger][lang],
        markdown(`${point.file}:${point.line}`, 120),
        `${markdown(point.title[lang], 120)}${point.command ? `<br>${markdown(point.command, 200)}` : ''}${reasons.join('')}`,
        '',
      ].join(' | ').trim());
    }
    if (rows.length > MAX_ROWS) out.push('', t(lang, 'omitted', { n: rows.length - MAX_ROWS }));
  }
  if (gaps.length > 0) {
    out.push('', `**${t(lang, 'incomplete')}**`, '', ...gaps.slice(0, 10).map((g) => `- ${markdown(g[lang])}`));
  }
  out.push('', t(lang, 'disclaimer'));
  return `${out.join('\n')}\n`;
}
