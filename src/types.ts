export type Severity = 'info' | 'low' | 'medium' | 'high';
export const SEVERITIES: readonly Severity[] = ['info', 'low', 'medium', 'high'];
export const rank = (s: Severity): number => SEVERITIES.indexOf(s);
export const worst = (a: Severity, b: Severity): Severity => (rank(a) >= rank(b) ? a : b);

/** The moment at which the code would run. */
export type Trigger = 'editor' | 'agent' | 'shell' | 'git' | 'container' | 'install' | 'build' | 'run';
export const TRIGGERS: readonly Trigger[] = ['editor', 'agent', 'shell', 'git', 'container', 'install', 'build', 'run'];

export type Lang = 'en' | 'es';
export interface Text { en: string; es: string }

/** Where a piece of text came from. Signals can behave differently in each context. */
export type Context = 'command' | 'script' | 'instructions';

/** Evidence that raises the severity of an execution point. */
export interface Signal {
  id: string;
  title: Text;
  severity: Severity;
  file: string;
  line: number;
  excerpt: string;
}

/** Something in the repository that can cause code to run. */
export interface ExecutionPoint {
  id: string;
  trigger: Trigger;
  file: string;
  line: number;
  /** Identity inside the file. It must not depend on line numbers. */
  key: string;
  title: Text;
  severity: Severity;
  /** What gets executed, as written in the file. */
  command?: string;
  /** What has to happen first, such as trusting the folder. */
  needs?: Text;
  signals: Signal[];
  /** Files of the repository that were read because this point runs them. */
  follows: string[];
  /** The limits were reached before following everything. */
  partial: boolean;
  /** Hash of the command and of every followed file. */
  fingerprint: string;
}

/** What a detector produces. The engine fills in the rest. */
export interface RawPoint {
  id: string;
  trigger: Trigger;
  file: string;
  line: number;
  key: string;
  title: Text;
  severity: Severity;
  command?: string;
  needs?: Text;
  /** Directory the command runs in, relative to the root. */
  cwd?: string;
  /** Files that are known to run, besides those found in the command. */
  runs?: string[];
  /** Text to check as agent instructions. */
  instructions?: string;
  signals?: Signal[];
}

export interface ScanResult {
  target: string;
  points: ExecutionPoint[];
  filesListed: number;
  /** Things that could not be analysed. A non-empty list means the scan is incomplete. */
  gaps: Text[];
}
