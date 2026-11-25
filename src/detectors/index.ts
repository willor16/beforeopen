import { dirname } from '../paths.ts';
import { matches } from '../paths.ts';
import { lineAt } from '../json.ts';
import type { PointRule, Rules } from '../rules.ts';
import type { RawPoint } from '../types.ts';
import { agentConfig, instructions, mcp } from './agents.ts';
import type { Detector } from './detector.ts';
import { devcontainer } from './devcontainer.ts';
import { embeddedRepo, gitDir, gitModules, husky } from './git.ts';
import { node } from './node.ts';
import { vscode } from './vscode.ts';

const MAX_PER_FILE = 500;

function decodeXml(text: string): string {
  const names: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  return text.replace(/&(?:#x([0-9a-f]{1,6})|#(\d{1,7})|(\w{2,4}));/gi, (all, hex?: string, dec?: string, name?: string) => {
    if (name) return names[name.toLowerCase()] ?? all;
    const code = hex ? parseInt(hex, 16) : Number(dec);
    return code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
}

function fromRule(rule: PointRule): Detector {
  return {
    files: rule.files,
    async detect(view, file) {
      if (matches(file.canon, rule.exclude)) return [];
      const dir = dirname(file.path);
      if (rule.sibling && !view.find(dir ? `${dir}/${rule.sibling}` : rule.sibling)) return [];
      const base = {
        id: rule.id, trigger: rule.trigger, file: file.path, title: rule.title, severity: rule.severity,
        ...(rule.needs && { needs: rule.needs }), cwd: dir,
      };
      if (!rule.match) return [{ ...base, line: 1, key: rule.id, ...(rule.script && { runs: [file.path] }) }];
      const text = await view.text(file.path);
      if (text === null) return [];
      const out: RawPoint[] = [];
      for (const m of text.matchAll(rule.match)) {
        const written = (Object.values(m.groups ?? {}).find((g) => g !== undefined) ?? m[1] ?? m[0]).trim();
        const command = rule.decode === 'xml' ? decodeXml(written) : written;
        out.push({ ...base, line: lineAt(text, m.index + m[0].search(/\S|$/)), key: command, command, ...(rule.script && { runs: [file.path] }) });
        if (out.length >= MAX_PER_FILE) {
          view.gaps.push({ en: `Too many matches in ${file.path}`, es: `Demasiadas coincidencias en ${file.path}` });
          break;
        }
      }
      return out;
    },
  };
}

export const detectors = (rules: Rules): Detector[] => [
  vscode, agentConfig, mcp, instructions, gitDir, embeddedRepo, gitModules, husky, devcontainer, node,
  ...rules.points.map(fromRule),
];
