import { safeJson } from '../sanitize.ts';
import type { Change } from '../scan.ts';
import type { ExecutionPoint, ScanResult, Text } from '../types.ts';

/** Version of the JSON format. It changes only when fields are removed or renamed. */
const FORMAT = 1;

const point = (p: ExecutionPoint): object => ({
  id: p.id,
  trigger: p.trigger,
  severity: p.severity,
  file: p.file,
  line: p.line,
  key: p.key,
  title: p.title.en,
  command: p.command ?? null,
  needs: p.needs?.en ?? null,
  signals: p.signals.map((s) => ({ ...s, title: s.title.en })),
  follows: p.follows,
  partial: p.partial,
  fingerprint: p.fingerprint,
});

export const renderScanJson = (r: ScanResult): string =>
  `${safeJson({ format: FORMAT, target: r.target, complete: r.gaps.length === 0, gaps: r.gaps.map((g) => g.en), points: r.points.map(point) })}\n`;

export const renderDiffJson = (title: string, changes: Change[], gaps: Text[]): string =>
  `${safeJson({
    format: FORMAT,
    target: title,
    complete: gaps.length === 0,
    gaps: gaps.map((g) => g.en),
    changes: changes.map((c) => ({ kind: c.kind, before: c.before?.command ?? null, point: point(c.point) })),
  })}\n`;
