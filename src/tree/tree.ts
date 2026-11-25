import type { Text } from '../types.ts';
import { canonical, dirname, join } from '../paths.ts';

export interface RawTree {
  label: string;
  /** Real paths, relative to the root and separated by `/`. */
  files: string[];
  links: { path: string; target: string }[];
  gaps: Text[];
  /** Returns null when the content cannot be read. */
  read(path: string): Promise<Uint8Array | null>;
  close(): Promise<void>;
}

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ALIASES = 5_000;

export interface TreeFile {
  /** Path as the user would see it. Through a link, the path of the link. */
  path: string;
  canon: string;
  real: string;
}

/** Read-only view that sees through case tricks, symbolic links and encodings. */
export class RepoView {
  readonly files: TreeFile[] = [];
  readonly gaps: Text[] = [];
  readonly escapingLinks: { path: string; target: string }[] = [];
  private readonly raw: RawTree;
  private readonly byCanon = new Map<string, TreeFile>();
  private readonly texts = new Map<string, Promise<string | null>>();

  constructor(raw: RawTree) {
    this.raw = raw;
    this.gaps.push(...raw.gaps);
    for (const path of raw.files) this.add(path, path);
    this.expandLinks();
  }

  get label(): string { return this.raw.label; }

  private add(path: string, real: string): void {
    const canon = canonical(path);
    const file: TreeFile = { path, canon, real };
    this.files.push(file);
    if (!this.byCanon.has(canon)) this.byCanon.set(canon, file);
  }

  /** A linked `.vscode` works like a real one, so its content is listed twice. */
  private expandLinks(): void {
    let aliases = 0;
    let pending = [...this.raw.links];
    for (let round = 0; round < 8 && pending.length > 0; round++) {
      const next: typeof pending = [];
      for (const link of pending) {
        const absolute = /^([a-z]:|[\\/])/i.test(link.target);
        const target = absolute ? null : join(dirname(link.path), link.target);
        if (target === null) { this.escapingLinks.push(link); continue; }
        const own = `${canonical(link.path)}/`;
        const exact = this.byCanon.get(canonical(target));
        if (exact) { this.add(link.path, exact.real); continue; }
        const prefix = target === '' ? '' : `${canonical(target)}/`;
        // Linking a folder to one of its parents would expand forever.
        if (own.startsWith(prefix)) continue;
        const inside = this.files.filter((f) => f.canon.startsWith(prefix));
        if (inside.length === 0) { next.push(link); continue; }
        for (const f of inside) {
          if (aliases++ >= MAX_ALIASES) {
            this.gaps.push({
              en: 'Too many symbolic links: some were not followed.',
              es: 'Demasiados enlaces simbólicos: algunos no se siguieron.',
            });
            return;
          }
          this.add(`${link.path}/${f.canon.slice(prefix.length)}`, f.real);
        }
      }
      if (next.length === pending.length) break;
      pending = next;
    }
  }

  find(path: string): TreeFile | undefined { return this.byCanon.get(canonical(path)); }

  text(path: string): Promise<string | null> {
    const file = this.find(path);
    if (!file) return Promise.resolve(null);
    let text = this.texts.get(file.real);
    if (!text) {
      text = this.load(file);
      this.texts.set(file.real, text);
    }
    return text;
  }

  private async load(file: TreeFile): Promise<string | null> {
    const bytes = await this.raw.read(file.real);
    if (bytes !== null) return decode(bytes);
    this.gaps.push({
      en: `Could not read ${file.path} (larger than 8 MB or unavailable).`,
      es: `No se pudo leer ${file.path} (mayor de 8 MB o no disponible).`,
    });
    return null;
  }

  close(): Promise<void> { return this.raw.close(); }
}

/** Editors honour the byte order mark, so a UTF-16 file is not a place to hide. */
export function decode(bytes: Uint8Array): string {
  const [a, b] = bytes;
  if (a === 0xff && b === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (a === 0xfe && b === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}
