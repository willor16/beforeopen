import type { Lang, Severity, Text, Trigger } from './types.ts';

export const TRIGGER_TEXT: Record<Trigger, Text> = {
  editor: { en: 'On opening in an editor', es: 'Al abrir en un editor' },
  agent: { en: 'On opening with an AI agent', es: 'Al abrir con un agente de IA' },
  shell: { en: 'On entering the folder in a terminal', es: 'Al entrar en la carpeta con la terminal' },
  git: { en: 'On using git', es: 'Al usar git' },
  container: { en: 'On opening in a container', es: 'Al abrir en un contenedor' },
  install: { en: 'On installing dependencies', es: 'Al instalar dependencias' },
  build: { en: 'On building or testing', es: 'Al compilar o probar' },
  run: { en: 'On running the project', es: 'Al ejecutar el proyecto' },
};

export const SEVERITY_TEXT: Record<Severity, Text> = {
  high: { en: 'HIGH', es: 'ALTO' },
  medium: { en: 'MEDIUM', es: 'MEDIO' },
  low: { en: 'LOW', es: 'BAJO' },
  info: { en: 'INFO', es: 'INFO' },
};

const MESSAGES = {
  needs: { en: 'needs', es: 'requiere' },
  why: { en: 'why', es: 'por qué' },
  moreReasons: { en: 'and {n} more', es: 'y {n} más' },
  collapsed: { en: '+ {n} of lower severity (use --all to see them)', es: '+ {n} de menor gravedad (usa --all para verlos)' },
  nothing: { en: 'No execution points found.', es: 'No encontré puntos de ejecución.' },
  noNew: { en: 'No new or modified execution points.', es: 'No hay puntos de ejecución nuevos ni modificados.' },
  summary: { en: '{n} execution points in {files} files: {detail}', es: '{n} puntos de ejecución en {files} archivos: {detail}' },
  diffSummary: { en: '{n} new or modified execution points: {detail}', es: '{n} puntos de ejecución nuevos o modificados: {detail}' },
  disclaimer: {
    en: 'This is what was found, not a guarantee. A repository can still be dangerous once its code runs.',
    es: 'Esto es lo que encontré, no una garantía. Un repositorio puede ser peligroso cuando se ejecuta su código.',
  },
  incomplete: { en: 'Incomplete scan', es: 'Análisis incompleto' },
  moreGaps: { en: '{n} more', es: '{n} más' },
  partial: { en: 'runs more code than could be followed ({n} files read)', es: 'ejecuta más código del que se pudo seguir ({n} archivos leídos)' },
  added: { en: 'NEW', es: 'NUEVO' },
  modified: { en: 'CHANGED', es: 'CAMBIÓ' },
  before: { en: 'before', es: 'antes' },
  severity: { en: 'Severity', es: 'Gravedad' },
  where: { en: 'Where', es: 'Dónde' },
  what: { en: 'What runs', es: 'Qué se ejecuta' },
  when: { en: 'When', es: 'Cuándo' },
  omitted: { en: '{n} more are not shown.', es: 'No se muestran {n} más.' },
} satisfies Record<string, Text>;

export type MessageKey = keyof typeof MESSAGES;

export function t(lang: Lang, key: MessageKey, vars: Record<string, string | number> = {}): string {
  return MESSAGES[key][lang].replace(/\{(\w+)\}/g, (_m, name: string) => String(vars[name] ?? ''));
}

export function detectLang(env: NodeJS.ProcessEnv = process.env): Lang {
  const locale = env['LC_ALL'] || env['LC_MESSAGES'] || env['LANG'] || Intl.DateTimeFormat().resolvedOptions().locale;
  return /^es\b|^es_/i.test(locale) ? 'es' : 'en';
}
