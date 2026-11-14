// scripts/check-pins.mjs says where the ZIPFoundation pin stands against its latest release, and opens a pull request when it is
// behind. What it can do without the network is here, including a bump on the files of this repository, so a format that drifts away
// from what the script looks for fails here and not on a Monday.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PINS,
  assess,
  bump,
  compareVersions,
  decide,
  propose,
  readPin,
  superseded,
  versionOf,
} from '../../scripts/check-pins.mjs';

const root = join(__dirname, '../..');
const real = (file: string) => readFileSync(join(root, file), 'utf8');
const [zip] = PINS;

/** This repository's files, with what was written kept apart. */
function tree() {
  const written = new Map<string, string>();
  return {
    read: (file: string) => written.get(file) ?? real(file),
    write: (file: string, text: string) => written.set(file, text),
    written,
  };
}

describe('scripts/check-pins.mjs', () => {
  it('compares versions as numbers, so 0.9.9 is older than 0.9.20', () => {
    expect(compareVersions('0.9.9', '0.9.20')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '0.9.20')).toBeGreaterThan(0);
    expect(compareVersions('0.9.20', '0.9.20')).toBe(0);
  });

  it('reads an exact pin, the same in the package and in the test package, and refuses a range', () => {
    const pinned = readPin(zip);
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(readPin(zip.followers[0] as never)).toBe(pinned);
    expect(() =>
      readPin(zip, () => '.package(url: "https://github.com/weichsel/ZIPFoundation.git", from: "0.9.19")'),
    ).toThrow(/no exact version/);
  });

  it('takes only a release tag of three numbers', () => {
    expect(versionOf('0.9.21')).toBe('0.9.21');
    for (const tag of ['0.9', '1.0.0-beta.1', 'latest', '0.9.21; rm -rf']) {
      expect(() => versionOf(tag)).toThrow(/not a version of three numbers/);
    }
  });

  it('names the pull request of a pin that is behind, and says when a release is a major one', () => {
    const behind = assess(zip, '0.9.20', '1.0.0');
    expect(behind).toMatchObject({
      behind: true,
      major: true,
      title: 'Take ZIPFoundation 1.0.0',
      branch: 'pin-ZIPFoundation-1.0.0',
    });
    expect(assess(zip, '0.9.20', '0.9.20').behind).toBe(false);
  });

  it('moves the pin in both manifests of this repository and adds a changelog line', () => {
    const files = tree();
    const pinned = readPin(zip);
    const written = bump(zip, pinned, '9.9.9', files);
    expect(written).toEqual(expect.arrayContaining(['Package.swift', 'test/ios/Package.swift', 'CHANGELOG.md']));
    expect(files.written.get('Package.swift')).toContain('ZIPFoundation.git", exact: "9.9.9"');
    expect(files.written.get('test/ios/Package.swift')).toContain('ZIPFoundation.git", exact: "9.9.9"');
    expect(files.written.get('CHANGELOG.md')).toContain(
      `## Unreleased\n\n- iOS: ZIPFoundation 9.9.9 (it was ${pinned})\n`,
    );
  });

  it('adds an Unreleased section when the changelog has none', () => {
    const files = new Map<string, string>([
      ['Package.swift', '.package(url: "https://github.com/weichsel/ZIPFoundation.git", exact: "0.9.20")'],
      ['test/ios/Package.swift', '.package(url: "https://github.com/weichsel/ZIPFoundation.git", exact: "0.9.20")'],
      ['README.md', '# readme\n'],
      ['CHANGELOG.md', '# Changelog\n\n## v0.2.0\n\n- x\n'],
    ]);
    bump(zip, '0.9.20', '0.9.21', {
      read: (file) => files.get(file) ?? '',
      write: (file, text) => files.set(file, text),
    });
    expect(files.get('CHANGELOG.md')).toBe(
      '# Changelog\n\n## Unreleased\n\n- iOS: ZIPFoundation 0.9.21 (it was 0.9.20)\n\n## v0.2.0\n\n- x\n',
    );
  });

  it('refuses a follower that pins another version', () => {
    const files = new Map<string, string>([
      ['Package.swift', '.package(url: "https://github.com/weichsel/ZIPFoundation.git", exact: "0.9.20")'],
      ['test/ios/Package.swift', '.package(url: "https://github.com/weichsel/ZIPFoundation.git", exact: "0.9.19")'],
    ]);
    expect(() =>
      bump(zip, '0.9.20', '0.9.21', { read: (file) => files.get(file) ?? '', write: () => undefined }),
    ).toThrow(/pins 0.9.19, not 0.9.20/);
  });

  it('leaves a version alone that already has a pull request in any state, and replaces an older open one', () => {
    const result = assess(zip, '0.9.20', '0.9.22');
    const pulls = [
      { number: 3, title: 'Take ZIPFoundation 0.9.21', state: 'OPEN', headRefName: 'pin-ZIPFoundation-0.9.21' },
      { number: 4, title: 'Take ZIPFoundation 0.9.22', state: 'CLOSED', headRefName: 'pin-ZIPFoundation-0.9.22' },
    ];
    expect(decide(result, pulls).open).toBe(false);
    expect(decide(result, pulls.slice(0, 1)).open).toBe(true);
    expect(superseded(result, pulls).map((pull) => pull.number)).toEqual([3]);
  });

  it('opens a pull request on its own branch, starts CI there first, and goes back to where it started', () => {
    const files = tree();
    const commands: string[] = [];
    const full: string[] = [];
    const pinned = readPin(zip);
    propose([{ dependency: zip, result: assess(zip, pinned, '9.9.9') }], {
      exec: () => '[]',
      act: (command, args) => {
        commands.push([command, ...args.slice(0, 3)].join(' '));
        full.push([command, ...args].join(' '));
        return '';
      },
      files,
      head: 'abc',
    });
    expect(commands).toEqual([
      'git switch --create pin-ZIPFoundation-9.9.9',
      'git add -- Package.swift',
      'git -c user.name=github-actions[bot] -c',
      'git push --set-upstream origin',
      'gh workflow run ci.yaml',
      'gh pr create --base',
      'git switch --detach abc',
    ]);
    expect(full.find((line) => line.startsWith('gh pr create'))).toContain(
      '--base main --head pin-ZIPFoundation-9.9.9',
    );
  });
});
