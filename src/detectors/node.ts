import { at, entries, parseJson, str, value } from '../json.ts';
import { dirname } from '../paths.ts';
import { scriptsOf } from '../references.ts';
import type { RawPoint } from '../types.ts';
import { malformed, type Detector } from './detector.ts';

/** Scripts that package managers run by themselves during an installation. */
const LIFECYCLE = /^(preinstall|install|postinstall|prepublish|preprepare|prepare|postprepare|dependencies|pnpm:devPreinstall)$/;

const REMOTE_DEPENDENCY = /^(https?:|git(\+\w+)?:|git@|github:|gitlab:|bitbucket:|gist:|[\w.-]+\/[\w.-]+(#.*)?$)/i;

export const node: Detector = {
  files: ['**/package.json'],
  async detect(view, file) {
    if (/(^|\/)node_modules\//.test(file.canon)) return [];
    const text = await view.text(file.path);
    if (text === null) return [];
    const doc = parseJson(text);
    if (!doc) return text.trim() ? [malformed(file.path, 'install')] : [];
    const cwd = dirname(file.path);
    const out: RawPoint[] = [];
    const scripts = scriptsOf(doc.root);

    for (const { key, node: script } of scripts) {
      const command = str(script);
      if (!LIFECYCLE.test(key) || !command?.trim()) continue;
      out.push({
        id: 'npm/lifecycle',
        trigger: 'install',
        file: file.path,
        line: doc.line(script),
        key,
        title: { en: `Install script: ${key}`, es: `Script de instalación: ${key}` },
        severity: 'medium',
        command,
        cwd,
      });
    }

    // npm compiles native code by itself when this file exists.
    const gyp = cwd ? `${cwd}/binding.gyp` : 'binding.gyp';
    const compiles = !scripts.some((s) => s.key === 'install' || s.key === 'preinstall');
    const gypText = compiles && view.find(gyp) ? await view.text(gyp) : null;
    if (gypText !== null) {
      // `<!(command)` runs while the project is being configured.
      const shell = [...gypText.matchAll(/<!@?\(([^)\n]{1,400})\)/g)].map((m) => m[1]!);
      out.push({
        id: 'npm/binding-gyp',
        trigger: 'install',
        file: view.find(gyp)!.path,
        line: 1,
        key: 'binding.gyp',
        title: {
          en: 'Native build that npm starts by itself',
          es: 'Compilación nativa que npm inicia por su cuenta',
        },
        severity: shell.length > 0 ? 'medium' : 'low',
        command: shell.length > 0 ? shell.join(' && ') : 'node-gyp rebuild',
        runs: [view.find(gyp)!.path],
        cwd,
      });
    }

    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const { key, node: dep } of entries(at(doc.root, field))) {
        const spec = str(dep);
        if (!spec || !REMOTE_DEPENDENCY.test(spec) || /^(file|link|workspace|npm|catalog|portal|patch):/.test(spec)) continue;
        const pinned = /#[0-9a-f]{40}$/i.test(spec);
        const plain = /^http:/i.test(spec) || (/^https?:/i.test(spec) && !/^https:\/\/(github\.com|gitlab\.com|codeload\.github\.com|registry\.npmjs\.org|pkg\.pr\.new)\//i.test(spec));
        out.push({
          id: 'npm/remote-dependency',
          trigger: 'install',
          file: file.path,
          line: doc.line(dep),
          key: `${field}.${key}`,
          title: {
            en: `Dependency from outside the registry: ${key}`,
            es: `Dependencia de fuera del registro: ${key}`,
          },
          // A pinned commit of a fork is still reachable from the original repository.
          severity: /^http:/i.test(spec) ? 'high' : plain || field === 'optionalDependencies' ? 'medium' : pinned ? 'info' : 'low',
          command: `${key}@${spec}`,
        });
      }
    }

    const manager = value(at(doc.root, 'packageManager'));
    if (typeof manager === 'string' && /@(https?|file):|@\.{0,2}\//.test(manager)) {
      out.push({
        id: 'npm/package-manager-url',
        trigger: 'install',
        file: file.path,
        line: doc.line(at(doc.root, 'packageManager')!),
        key: 'packageManager',
        title: {
          en: 'Package manager downloaded from a custom address',
          es: 'Gestor de paquetes descargado de una dirección propia',
        },
        severity: 'high',
        command: manager,
      });
    }
    return out;
  },
};
