import type { RepoView, TreeFile } from '../tree/tree.ts';
import type { RawPoint, Trigger } from '../types.ts';

export interface Detector {
  /** Globs over canonical paths, so always in lower case. */
  files: string[];
  detect(view: RepoView, file: TreeFile): Promise<RawPoint[]>;
}

/** A file that cannot be parsed may still be accepted by the real tool. */
export function malformed(file: string, trigger: Trigger): RawPoint {
  return {
    id: 'unreadable-config',
    trigger,
    file,
    line: 1,
    key: 'malformed',
    title: {
      en: 'Configuration that could not be understood. Review it by hand',
      es: 'Configuración que no se pudo interpretar. Revísala a mano',
    },
    severity: 'medium',
  };
}
