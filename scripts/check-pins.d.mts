// Types of scripts/check-pins.mjs, for the tests that import it.
export interface Pin {
  name: string;
  platform: string;
  repo: string;
  file: string;
  pin: RegExp;
  followers: { file: string; pin: RegExp }[];
  mention: RegExp;
}
export interface Assessment {
  name: string;
  pinned: string;
  latest: string;
  behind: boolean;
  major: boolean;
  line: string;
  title: string;
  branch: string;
}
export interface PullRequest {
  number: number;
  title: string;
  state: string;
  headRefName: string;
}
export interface Files {
  read(file: string): string;
  write(file: string, text: string): void;
}
export const PINS: Pin[];
export function readPin(dependency: Pin, read?: (file: string) => string): string;
export function compareVersions(a: string, b: string): number;
export function versionOf(tag: string): string;
export function assess(dependency: Pin, pinned: string, latest: string): Assessment;
export function bump(dependency: Pin, from: string, to: string, files: Files): string[];
export function commitMessage(dependency: Pin, result: Assessment): string;
export function describePullRequest(dependency: Pin, result: Assessment, files: string[], run?: string): string;
export function decide(result: Assessment, pulls: PullRequest[]): { open: boolean; why?: string };
export function superseded(result: Assessment, pulls: PullRequest[]): PullRequest[];
export function propose(
  entries: { dependency: Pin; result: Assessment }[],
  io: {
    exec(command: string, args: string[]): string;
    act(command: string, args: string[]): string;
    files: Files;
    head: string;
  },
): void;
