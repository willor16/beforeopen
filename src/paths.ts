/**
 * Windows and macOS ignore case, and Windows also drops trailing dots and
 * spaces. A repository could rely on that to hide `.vscode` from a scanner, so
 * every comparison uses this canonical form.
 */
export function canonical(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/[\u{200b}-\u{200f}\u{2028}-\u{202e}\u{2060}-\u{206f}\u{feff}]/gu, '')
    .normalize('NFC')
    .toLowerCase()
    .split('/')
    .map((part) => (part === '.' || part === '..' ? part : part.replace(/[. ]+$/, '')))
    .filter((part) => part !== '' && part !== '.')
    .join('/');
}

export const dirname = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
};
export const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** Joins and normalises. Returns null when the result leaves the repository. */
export function join(base: string, relative: string): string | null {
  const out: string[] = [];
  for (const part of `${base}/${relative}`.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

const cache = new Map<string, RegExp>();

// Globs over canonical paths: `**/`, `*`, `?` and `{a,b}`.
export function globToRegExp(glob: string): RegExp {
  const known = cache.get(glob);
  if (known) return known;
  const g = glob.toLowerCase();
  let out = '';
  let depth = 0;
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (g.startsWith('**/', i)) { out += '(?:[^/]+/)*'; i += 2; }
    else if (g.startsWith('**', i)) { out += '.*'; i += 1; }
    else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (c === '{') { out += '(?:'; depth++; }
    else if (c === '}' && depth > 0) { out += ')'; depth--; }
    else if (c === ',' && depth > 0) out += '|';
    else out += c.replace(/[.+^$()|[\]\\{}]/g, '\\$&');
  }
  const re = new RegExp(`^${out}$`);
  cache.set(glob, re);
  return re;
}

export const matches = (path: string, globs: readonly string[]): boolean =>
  globs.some((g) => globToRegExp(g).test(path));
