// The `plan` step of .github/workflows/ci.yaml decides, from what started a run, which of the longer tests it needs and whether it ends
// in a publish. It is shell inside YAML, so it is run here. A run started by hand or by the pins workflow (workflow_dispatch) tests
// everything and must never publish: trusted publishing is tied to the file name, not to the branch.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../..');
const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yaml'), 'utf8');

/** The shell of the `plan` step, taken out of the YAML and dedented. */
function planScript(): string {
  const step = workflow.slice(workflow.indexOf('- id: plan'));
  const body = / {8}run: \|\n((?: {10}.*\n|\n)+)/.exec(step)?.[1];
  if (!body) {
    throw new Error('ci.yaml has no plan step with a run block');
  }
  return body.replace(/^ {10}/gm, '');
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd,
      encoding: 'utf8',
    },
  ).trim();

/** What the plan says for a run started by `event` on `ref`, in a repository whose last commit changed `changed`. */
function plan(event: string, changed: string[] = ['README.md'], ref = 'refs/heads/main'): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'ci-plan-'));
  try {
    git(dir, 'init', '--quiet');
    writeFileSync(join(dir, 'start.txt'), 'start');
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '--message', 'base');
    const base = git(dir, 'rev-parse', 'HEAD');
    for (const file of changed) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), 'changed');
    }
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '--message', 'change');
    const output = join(dir, 'github-output');
    writeFileSync(output, '');
    execFileSync('bash', ['-c', planScript()], {
      cwd: dir,
      env: {
        ...process.env,
        EVENT: event,
        REF: ref,
        BASE: event === 'pull_request' ? base : '',
        GITHUB_OUTPUT: output,
      },
      stdio: 'pipe',
    });
    return Object.fromEntries(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split('=')),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the plan of ci.yaml', () => {
  it('tests everything and publishes on a push to main', () => {
    expect(plan('push')).toEqual({ ios: 'true', android: 'true', publish: 'true' });
  });

  it('tests everything and never publishes on a run by hand, on any branch', () => {
    expect(plan('workflow_dispatch')).toEqual({ ios: 'true', android: 'true', publish: 'false' });
    expect(plan('workflow_dispatch', undefined, 'refs/heads/pin-ZIPFoundation-0.9.21')).toEqual({
      ios: 'true',
      android: 'true',
      publish: 'false',
    });
  });

  it('runs on a pull request only the platform tests its change reaches, and never publishes', () => {
    expect(plan('pull_request', ['README.md'])).toEqual({ ios: 'false', android: 'false', publish: 'false' });
    expect(plan('pull_request', ['ios/Sources/CodePushCore/Models.swift'])).toEqual({
      ios: 'true',
      android: 'false',
      publish: 'false',
    });
    expect(plan('pull_request', ['Package.swift'])).toEqual({ ios: 'true', android: 'false', publish: 'false' });
    expect(plan('pull_request', ['android/build.gradle'])).toEqual({ ios: 'false', android: 'true', publish: 'false' });
    expect(plan('pull_request', ['src/code-push.ts'])).toEqual({ ios: 'true', android: 'true', publish: 'false' });
    expect(plan('pull_request', ['.github/workflows/test-ios.yaml'])).toEqual({
      ios: 'true',
      android: 'false',
      publish: 'false',
    });
  });
});
