#!/usr/bin/env node
// ZIPFoundation is pinned to an exact release, and Dependabot does not move an exact Swift pin. This compares the pin with
// ZIPFoundation's latest release on GitHub and says whether it is behind. `--pr` also opens a pull request that moves the pin when it
// is, a major release included (the pull request is what says what a major breaks), and starts CI on its branch.
//
//   node scripts/check-pins.mjs                 print where each pin stands
//   node scripts/check-pins.mjs --pr            the same, and open a pull request per dependency that is behind (needs git, `gh`, GH_TOKEN)
//   node scripts/check-pins.mjs --pr --dry-run  the same, writing nothing: it says what it would write and run
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The branch a pull request goes to. */
const BASE = 'main';

/** Who the commit is from: the Actions bot, so it is not taken for the person who merges it. */
const BOT = [
  '-c',
  'user.name=github-actions[bot]',
  '-c',
  'user.email=41898282+github-actions[bot]@users.noreply.github.com',
];

const VERSION = /^\d+\.\d+\.\d+$/;

/**
 * The pinned dependencies: where each is pinned and where its releases are. `followers` are the files that must pin the same version,
 * and `mention` picks the README lines that name the dependency, which are the ones that carry its version.
 */
export const PINS = [
  {
    name: 'ZIPFoundation',
    platform: 'iOS',
    repo: 'weichsel/ZIPFoundation',
    file: 'Package.swift',
    pin: /ZIPFoundation\.git", exact: "([\d.]+)"/,
    followers: [{ file: 'test/ios/Package.swift', pin: /ZIPFoundation\.git", exact: "([\d.]+)"/ }],
    mention: /ZIPFoundation/,
  },
];

const readRoot = (file) => readFileSync(join(root, file), 'utf8');

/** The version a pin names, read out of the file that holds it. */
export function readPin(dependency, read = readRoot) {
  const version = dependency.pin.exec(read(dependency.file))?.[1];
  if (!version) {
    throw new Error(`${dependency.file} pins no exact version of ${dependency.name}`);
  }
  return version;
}

/** Negative when a is older than b, zero when they are the same, positive when a is newer: numeric, so 0.9.9 is older than 0.9.20. */
export function compareVersions(a, b) {
  const [x, y] = [a, b].map((version) => version.split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const order = (x[i] ?? 0) - (y[i] ?? 0);
    if (order !== 0) {
      return order;
    }
  }
  return 0;
}

/** A release tag as a version. Anything but three numbers is refused: it goes into a branch name, a file and a title. */
export function versionOf(tag) {
  const version = tag.replace(/^v/, '');
  if (!VERSION.test(version)) {
    throw new Error(`the release tag ${JSON.stringify(tag)} is not a version of three numbers`);
  }
  return version;
}

/** Where a pin stands against the latest release, and what a pull request that moves it is called. */
export function assess(dependency, pinned, latest) {
  const behind = compareVersions(pinned, latest) < 0;
  return {
    name: dependency.name,
    pinned,
    latest,
    behind,
    major: behind && Number(latest.split('.')[0]) > Number(pinned.split('.')[0]),
    line: `${dependency.name}: pinned ${pinned}, latest ${latest}${behind ? ' (behind)' : ''}`,
    title: `Take ${dependency.name} ${latest}`,
    // A flat name: git refuses every branch beneath one that exists.
    branch: `pin-${dependency.name}-${latest}`,
  };
}

const escape = (text) => text.replaceAll('.', '\\.');

/** Every version a pattern captures in a text, moved from one version to another; one that is not the version being moved is an error. */
function movePin(text, file, pin, from, to) {
  let moved = '';
  let last = 0;
  for (const match of text.matchAll(new RegExp(pin.source, 'gd'))) {
    const [start, end] = match.indices[1];
    if (match[1] !== from) {
      throw new Error(`${file} pins ${match[1]}, not ${from}`);
    }
    moved += text.slice(last, start) + to;
    last = end;
  }
  return moved + text.slice(last);
}

/**
 * Moves a pin, and what has to agree with it, from one version to another, through `read` and `write`, and says which files it wrote.
 * A file that does not change is an error, so a format that drifted away from what is looked for cannot pass as a bump that did nothing.
 */
export function bump(dependency, from, to, { read, write }) {
  const written = [];
  const edit = (file, change, absent) => {
    const before = read(file);
    const after = change(before);
    if (after === before) {
      throw new Error(`${file} did not change: ${absent}`);
    }
    write(file, after);
    written.push(file);
  };
  for (const { file, pin } of [dependency, ...dependency.followers]) {
    edit(file, (text) => movePin(text, file, pin, from, to), `it pins no ${dependency.name} version to move`);
  }
  // The README may name the version on a line that names the dependency. None is no error.
  const old = new RegExp(`(?<![0-9])(?<![0-9]\\.)${escape(from)}(?![0-9])(?!\\.[0-9])`, 'g');
  const readme = read('README.md');
  const moved = readme
    .split('\n')
    .map((line) => (dependency.mention.test(line) ? line.replace(old, to) : line))
    .join('\n');
  if (moved !== readme) {
    write('README.md', moved);
    written.push('README.md');
  }
  // A release renames "## Unreleased", so after one there is no such section until a change makes it: this makes it.
  const entry = `- ${dependency.platform}: ${dependency.name} ${to} (it was ${from})`;
  edit(
    'CHANGELOG.md',
    (text) =>
      text.includes('\n## Unreleased\n')
        ? text.replace('\n## Unreleased\n\n', `\n## Unreleased\n\n${entry}\n`)
        : text.replace(/\n## /, `\n## Unreleased\n\n${entry}\n\n## `),
    'it has no section to add to',
  );
  return written;
}

const releaseNotes = (dependency, result) => `https://github.com/${dependency.repo}/releases/tag/${result.latest}`;

/** The second paragraph of the commit message: where to read what changed. */
export function commitMessage(dependency, result) {
  return `Release notes: ${releaseNotes(dependency, result)}`;
}

/** The description of a pull request for a bump that wrote these files; `run` is the link to the CI run that was started on its branch. */
export function describePullRequest(dependency, result, files, run) {
  return [
    `${dependency.name} ${result.latest} is out, and this plugin pinned ${result.pinned}: ${releaseNotes(dependency, result)}`,
    `This moves the pin, what has to pin the same version, and the README lines that name it and its old version, and adds a line to CHANGELOG.md (${files.join(', ')}). What the release changes for this plugin is for whoever merges this to read in its notes and to add to that line.`,
    ...(result.major
      ? [
          'This is a major release, so it can change the API this plugin calls: a red check is the first thing to expect. The branch is an ordinary one, and the fix goes on it.',
        ]
      : []),
    run
      ? `CI was started on the branch by the workflow, as a workflow_dispatch of ci.yaml that tests everything and never publishes: ${run}. GitHub holds the pull_request run of a pull request that a workflow opened until someone approves it, so the list of checks on this page may not show CI: that run is the CI of this branch.`
      : 'CI was started on the branch by the workflow, as a workflow_dispatch of ci.yaml that tests everything and never publishes: look for it under Actions, on this branch.',
  ].join('\n\n');
}

/** Whether a pull request is to be opened, and if not, why not. A pull request of any state counts: closing one declines the version. */
export function decide(result, pulls) {
  if (!result.behind) {
    return { open: false, why: `${result.name} is not behind` };
  }
  const known = pulls.find((pull) => pull.title === result.title || pull.headRefName === result.branch);
  if (known) {
    return { open: false, why: `${result.title}: #${known.number} is already there (${known.state.toLowerCase()})` };
  }
  return { open: true };
}

/** The open pull requests of this script for an older release of the same dependency: they are replaced by the new one. */
export function superseded(result, pulls) {
  return pulls.filter(
    (pull) =>
      pull.state === 'OPEN' && pull.headRefName.startsWith(`pin-${result.name}-`) && pull.headRefName !== result.branch,
  );
}

/**
 * Opens a pull request for each dependency that is behind, unless there is one for that version already. `exec` runs what only reads,
 * `act` what writes (and says what it would, in a dry run), `files` reads and writes the working tree. `head` is where each branch starts.
 */
export function propose(entries, { exec, act, files, head }) {
  const pulls = JSON.parse(
    exec('gh', ['pr', 'list', '--state', 'all', '--limit', '100', '--json', 'number,title,state,headRefName']),
  );
  for (const { dependency, result } of entries) {
    const verdict = decide(result, pulls);
    if (!verdict.open) {
      console.log(verdict.why);
      continue;
    }
    act('git', ['switch', '--create', result.branch]);
    const written = bump(dependency, result.pinned, result.latest, files);
    act('git', ['add', '--', ...written]);
    act('git', [...BOT, 'commit', '--message', result.title, '--message', commitMessage(dependency, result)]);
    act('git', ['push', '--set-upstream', 'origin', result.branch]);
    // CI before the pull request, so that its description can link to the run
    const started = act('gh', ['workflow', 'run', 'ci.yaml', '--ref', result.branch]);
    const run = /https:\/\/github\.com\/\S+\/actions\/runs\/\d+/.exec(started)?.[0];
    const body = describePullRequest(dependency, result, written, run);
    const created = act('gh', [
      'pr',
      'create',
      '--base',
      BASE,
      '--head',
      result.branch,
      '--title',
      result.title,
      '--body',
      body,
    ]);
    const number = /\/pull\/(\d+)/.exec(created)?.[1];
    for (const old of superseded(result, pulls)) {
      act('gh', [
        'pr',
        'close',
        String(old.number),
        '--delete-branch',
        '--comment',
        `Replaced by ${number ? `#${number}` : result.title}.`,
      ]);
    }
    act('git', ['switch', '--detach', head]);
  }
}

/** The latest release of a repository that is not a prerelease, as its version. */
async function latestRelease(repo, token) {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} for the latest release of ${repo}`);
  }
  return versionOf((await response.json()).tag_name);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--pr' && arg !== '--dry-run');
  if (unknown.length > 0 || (args.includes('--dry-run') && !args.includes('--pr'))) {
    throw new Error(`usage: check-pins.mjs [--pr [--dry-run]] (got ${args.join(' ') || 'nothing'})`);
  }
  const dry = args.includes('--dry-run');
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const entries = [];
  for (const dependency of PINS) {
    const result = assess(dependency, readPin(dependency), await latestRelease(dependency.repo, token));
    console.log(result.line);
    entries.push({ dependency, result });
  }
  if (args.includes('--pr')) {
    const exec = (command, argv) => execFileSync(command, argv, { cwd: root, encoding: 'utf8' });
    const quote = (arg) => (/^[\w./:=@+-]+$/.test(arg) ? arg : JSON.stringify(arg));
    const act = dry
      ? (command, argv) => {
          console.log(`would run: ${[command, ...argv].map(quote).join(' ')}`);
          return '';
        }
      : (command, argv) => {
          const output = exec(command, argv);
          process.stdout.write(output);
          return output;
        };
    const files = {
      read: readRoot,
      write: dry
        ? (file) => console.log(`would write: ${file}`)
        : (file, text) => writeFileSync(join(root, file), text),
    };
    propose(entries, { exec, act, files, head: exec('git', ['rev-parse', 'HEAD']).trim() });
  }
}
