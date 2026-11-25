/**
 * Everything shown to the user comes from a repository that may be hostile, so
 * it must never reach a terminal, a Markdown renderer or the GitHub runner raw.
 */

// Control characters, bidirectional overrides and characters with no visible glyph.
const UNSAFE =
  /[\u0000-\u001f\u007f-\u009f\u{ad}\u{61c}\u{115f}\u{1160}\u{180e}\u{200b}-\u{200f}\u{2028}-\u{202e}\u{2060}-\u{206f}\u{3164}\u{fe00}-\u{fe0f}\u{feff}\u{ffa0}\u{fff9}-\u{fffb}\u{e0000}-\u{e0fff}]|[\ud800-\udfff]/gu;

const escapeChar = (c: string): string => {
  if (c === '\n') return '⏎';
  if (c === '\r') return '';
  if (c === '\t') return ' ';
  return `<U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}>`;
};

/** One line, printable, and unable to form a GitHub workflow command. */
export function clean(text: string, max = 160): string {
  const visible = text
    .slice(0, 20_000)
    .replace(/[ \t]{8,}/g, (m) => ` <${m.length} spaces> `)
    .replace(UNSAFE, escapeChar)
    .replace(/##\[/g, '## [')
    .trim();
  return shorten(visible, max).replace(/^::/, ': :');
}

/** Keeps both ends, because payloads like to hide at the end of a long line. */
export function shorten(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const tail = Math.floor(max / 3);
  return `${chars.slice(0, max - tail - 3).join('')} … ${chars.slice(-tail).join('')}`;
}

/** Text with no Markdown or HTML of its own. Use `code` or `prose`, which also stop mentions. */
function markdown(text: string, max = 160): string {
  return clean(text, max)
    .replace(/[&<>\\`*_{}[\]()#+!|~@:]/g, (c) => `&#${c.charCodeAt(0)};`)
    .replace(/www\./gi, (m) => `${m.slice(0, 3)}&#46;`);
}

/**
 * GitHub decodes entities before it looks for mentions, issues and commits, so
 * escaping is not enough. It never looks inside `<code>`.
 */
export const code = (text: string, max = 160): string => `<code>${markdown(text, max)}</code>`;

/** Plain text, unless GitHub could turn part of it into a link. */
export const prose = (text: string, max = 160): string =>
  /[@#]|GH-|[0-9a-f]{7}/i.test(text) ? code(text, max) : markdown(text, max);

/** Annotations are plain text, where GitHub still links mentions. */
export const annotation = (text: string, max = 300): string => clean(text, max).replace(/@(?=[^ ])/g, '@ ');

/** JSON that is safe to print on a terminal: plain ASCII. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/[^ -~\n]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/** Escaping for GitHub workflow commands. */
export const workflowData = (s: string): string =>
  s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
export const workflowProperty = (s: string): string =>
  workflowData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
