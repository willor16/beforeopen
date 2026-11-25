import { parseGitConfig } from '../gitconfig.ts';
import { basename, dirname, join } from '../paths.ts';
import type { RepoView } from '../tree/tree.ts';
import type { RawPoint, Severity, Text } from '../types.ts';
import type { Detector } from './detector.ts';

/** Keys that make git start a program. */
function executes(section: string, name: string, value: string): Severity | null {
  const boolean = /^(true|false|yes|no|on|off|0|1|)$/i.test(value);
  switch (section) {
    case 'core':
      if (name === 'fsmonitor') return boolean ? null : 'high';
      if (name === 'hookspath') return 'medium';
      if (['sshcommand', 'pager', 'editor', 'gitproxy', 'askpass', 'alternaterefscommand'].includes(name)) return 'high';
      return null;
    case 'diff': return name === 'external' || name === 'command' || name === 'textconv' ? 'high' : null;
    case 'filter':
      if (!['clean', 'smudge', 'process'].includes(name)) return null;
      return /^git-lfs (clean|smudge|filter-process)( .*)?$/.test(value) ? 'info' : 'high';
    case 'merge': return name === 'driver' ? 'high' : null;
    case 'gpg': return name === 'program' ? 'medium' : null;
    case 'credential':
      if (name !== 'helper') return null;
      return /^!|[\\/]/.test(value) ? 'medium' : 'info';
    case 'alias': return value.startsWith('!') ? 'medium' : null;
    case 'pager': return boolean ? null : 'high';
    case 'sequence': return name === 'editor' ? 'high' : null;
    case 'interactive': return name === 'difffilter' ? 'high' : null;
    case 'uploadpack': return name === 'packobjectshook' ? 'high' : null;
    case 'trailer': return name === 'command' || name === 'cmd' ? 'medium' : null;
    case 'difftool':
    case 'mergetool':
    case 'browser':
    case 'man': return name === 'cmd' ? 'low' : null;
    case 'remote':
    case 'url':
      if (['uploadpack', 'receivepack', 'vcs'].includes(name)) return 'high';
      if (/^(url|pushurl)$/.test(name) && /^(ext|fd)::|^-/.test(value)) return 'high';
      return null;
    case 'submodule': return name === 'update' && value.startsWith('!') ? 'high' : null;
    case 'include':
    case 'includeif': return name === 'path' ? 'low' : null;
    default: return null;
  }
}

const FROM_ARCHIVE: Text = {
  en: 'any git command runs here, even one started by your editor or prompt',
  es: 'que se use git aquí, aunque lo haga tu editor o tu terminal',
};

async function config(view: RepoView, path: string, embedded: boolean): Promise<RawPoint[]> {
  const text = await view.text(path);
  if (text === null) return [];
  return parseGitConfig(text).flatMap((e): RawPoint[] => {
    const severity = executes(e.section, e.name, e.value);
    if (!severity) return [];
    return [{
      id: 'git/config',
      trigger: 'git',
      file: path,
      line: e.line,
      key: e.key,
      title: embedded
        ? { en: `Hidden git repository that runs a program: ${e.key}`, es: `Repositorio git oculto que ejecuta un programa: ${e.key}` }
        : { en: `Git setting that runs a program: ${e.key}`, es: `Ajuste de git que ejecuta un programa: ${e.key}` },
      severity,
      command: e.value,
      needs: FROM_ARCHIVE,
    }];
  });
}

function hookFiles(view: RepoView, dir: string, title: Text, severity: Severity, needs: Text): RawPoint[] {
  const prefix = `${dir}/`.toLowerCase();
  return view.files
    .filter((f) => f.canon.startsWith(prefix) && !f.canon.slice(prefix.length).includes('/') && !/\.sample$/.test(f.canon))
    .map((f) => ({
      id: 'git/hook', trigger: 'git' as const, file: f.path, line: 1, key: basename(f.canon),
      title: { en: `${title.en}: ${basename(f.path)}`, es: `${title.es}: ${basename(f.path)}` },
      severity, needs, runs: [f.path],
    }));
}

/** The `.git` folder itself. It only comes with archives, never with a clone. */
export const gitDir: Detector = {
  files: ['**/.git/config', '**/.git/config.worktree', '**/.git/modules/**/config', '**/.git'],
  async detect(view, file) {
    if (basename(file.canon) !== '.git') {
      const dir = dirname(file.path);
      return [
        ...(await config(view, file.path, false)),
        ...(file.canon.endsWith('/config') ? hookFiles(view, `${dir}/hooks`, { en: 'Active git hook', es: 'Hook de git activo' }, 'low', {
          en: 'you use git here', es: 'que uses git aquí',
        }) : []),
      ];
    }
    // `.git` as a file can point to a folder of the repository.
    const text = await view.text(file.path);
    const target = /^gitdir:\s*(.+)$/m.exec(text ?? '')?.[1]?.trim();
    const inside = target && !/^([a-z]:|[\\/])/i.test(target) ? join(dirname(file.path), target) : null;
    if (!inside || !view.find(`${inside}/config`)) return [];
    return config(view, view.find(`${inside}/config`)!.path, true);
  },
};

/** A folder with the shape of a git repository is used as one by git. */
export const embeddedRepo: Detector = {
  files: ['**/head'],
  async detect(view, file) {
    if (/(^|\/)\.git\//.test(file.canon)) return [];
    const dir = dirname(file.path);
    const at = (name: string): string => (dir ? `${dir}/${name}` : name);
    const found = view.find(at('config'));
    if (!found) return [];
    const prefix = at('').toLowerCase();
    const shape = view.files.some((f) => f.canon.startsWith(`${prefix}objects/`) || f.canon.startsWith(`${prefix}refs/`));
    if (!shape) return [];
    return config(view, found.path, true);
  },
};

export const gitModules: Detector = {
  files: ['.gitmodules'],
  async detect(view, file) {
    const text = await view.text(file.path);
    if (text === null) return [];
    return parseGitConfig(text).flatMap((e): RawPoint[] => {
      if (e.section !== 'submodule') return [];
      const base = { trigger: 'git' as const, file: file.path, line: e.line, key: e.key, command: e.value };
      if (e.name === 'update' && e.value.startsWith('!')) return [{
        ...base, id: 'git/submodule', severity: 'high',
        title: { en: 'Submodule that runs a command', es: 'Submódulo que ejecuta un comando' },
      }];
      if (e.name === 'path' && /(^|[\\/])(\.\.|\.git)([\\/]|$)/i.test(e.value)) return [{
        ...base, id: 'git/submodule', severity: 'high',
        title: { en: 'Submodule written outside its place', es: 'Submódulo que se escribe fuera de su sitio' },
      }];
      if (e.name === 'url') {
        const odd = /^(ext|fd)::|^-/.test(e.value);
        return [{
          ...base, id: 'git/submodule', severity: odd ? 'high' : 'info',
          title: odd
            ? { en: 'Submodule whose address runs a program', es: 'Submódulo cuya dirección ejecuta un programa' }
            : { en: 'Submodule: its code was not scanned', es: 'Submódulo: su código no se analizó' },
        }];
      }
      return [];
    });
  },
};

export const husky: Detector = {
  files: ['**/.husky/*', '**/.githooks/*', '**/.git-hooks/*'],
  async detect(view, file) {
    const name = basename(file.canon);
    if (!/^(applypatch-msg|pre-applypatch|post-applypatch|pre-commit|pre-merge-commit|prepare-commit-msg|commit-msg|post-commit|pre-rebase|post-checkout|post-merge|pre-push|post-rewrite|reference-transaction|fsmonitor-watchman|post-index-change)(\.(sh|js|py|cmd|ps1))?$/.test(name)) return [];
    const automatic = /^(post-checkout|post-merge|post-index-change|reference-transaction|fsmonitor-watchman)/.test(name);
    return [{
      id: 'git/managed-hook', trigger: 'git', file: file.path, line: 1, key: name,
      title: { en: `Git hook: ${name}`, es: `Hook de git: ${name}` },
      severity: automatic ? 'medium' : 'low',
      needs: { en: 'the project activates its hooks, usually on install', es: 'que el proyecto active sus hooks, normalmente al instalar' },
      runs: [file.path],
      cwd: dirname(dirname(file.path)),
    }];
  },
};
