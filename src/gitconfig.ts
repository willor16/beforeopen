export interface ConfigEntry {
  /** `section.name` or `section.subsection.name`. Section and name in lower case. */
  key: string;
  section: string;
  sub: string;
  name: string;
  value: string;
  line: number;
}

/** Small reader for git configuration files. Tolerant on purpose. */
export function parseGitConfig(text: string): ConfigEntry[] {
  const out: ConfigEntry[] = [];
  let section = '';
  let sub = '';
  const lines = text.replace(/^\u{feff}/u, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const start = i;
    let line = lines[i]!.trim();
    const head = /^\[\s*([\w.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\](.*)$/.exec(line);
    if (head) {
      const dot = head[1]!.indexOf('.');
      section = (dot < 0 ? head[1]! : head[1]!.slice(0, dot)).toLowerCase();
      sub = head[2]?.replace(/\\(.)/g, '$1') ?? (dot < 0 ? '' : head[1]!.slice(dot + 1).toLowerCase());
      line = head[3]!.trim();
    }
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    // A backslash at the end of the line continues the value on the next one.
    while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i]!;
    const m = /^([A-Za-z][\w-]*)\s*(?:=\s*([\s\S]*))?$/.exec(line);
    if (!m || !section) continue;
    const name = m[1]!.toLowerCase();
    out.push({
      key: sub ? `${section}.${sub}.${name}` : `${section}.${name}`,
      section,
      sub,
      name,
      value: m[2] === undefined ? 'true' : unquote(m[2]),
      line: start + 1,
    });
  }
  return out;
}

function unquote(raw: string): string {
  let out = '';
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === '"') quoted = !quoted;
    else if (c === '\\' && i + 1 < raw.length) {
      const n = raw[++i]!;
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n;
    } else if (!quoted && (c === '#' || c === ';')) break;
    else out += c;
  }
  return out.trim();
}
