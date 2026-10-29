import { describe, expect, it } from 'vitest';
import { PIP_COMMAND, downloadInPlace, systemLabel, updateSteps } from './updateSteps.js';

const texts = (steps) => steps.map((s) => [s.text, ...(s.code ?? []), s.note ?? ''].join(' ')).join('\n');

describe('the steps after an update download', () => {
  it('closes Azimut first, since Windows cannot replace a running program', () => {
    for (const kind of ['binary', 'package']) {
      for (const system of ['linux', 'windows', 'macos']) {
        expect(updateSteps({ kind, system, program: '/x/azimut' })[0].text).toMatch(/^Quit Azimut/);
      }
    }
  });

  it('names the window Azimut runs in the way each system does', () => {
    expect(updateSteps({ system: 'windows' })[0].text).toContain('console window');
    expect(updateSteps({ system: 'macos' })[0].text).toContain('Terminal window');
    expect(updateSteps({ system: 'linux' })[0].text).toContain('terminal window');
  });

  it('names the program file to replace, not a copy or a folder', () => {
    const steps = updateSteps({ system: 'windows', program: 'C:\\Apps\\azimut-windows-x86_64.exe' });
    expect(steps[1]).toEqual({
      text: 'Put the downloaded file in place of the old program:',
      code: ['C:\\Apps\\azimut-windows-x86_64.exe'],
    });
  });

  it('makes a Linux binary runnable by its full path, from any folder', () => {
    const all = texts(updateSteps({ system: 'linux', program: '/home/u/bin/azimut' }));
    expect(all).toContain('chmod +x /home/u/bin/azimut');
    expect(all).not.toMatch(/xattr|from its folder/);
  });

  it('clears the macOS quarantine, with the Settings way as the alternative', () => {
    const all = texts(updateSteps({ system: 'macos', program: '/Users/u/azimut-macos-arm64' }));
    expect(all).toContain('chmod +x /Users/u/azimut-macos-arm64');
    expect(all).toContain('xattr -d com.apple.quarantine /Users/u/azimut-macos-arm64');
    expect(all).toContain('Privacy & Security');
  });

  it('tells Windows users how past SmartScreen and gives them no shell command', () => {
    const steps = updateSteps({ system: 'windows', program: 'C:\\azimut.exe' });
    expect(texts(steps)).toContain('More info, then Run anyway');
    expect(texts(steps)).not.toContain('chmod');
  });

  it('quotes a path a shell would split', () => {
    const all = texts(updateSteps({ system: 'linux', program: "/home/u/My Apps/it's azimut" }));
    expect(all).toContain("chmod +x '/home/u/My Apps/it'\\''s azimut'");
  });

  it('updates a pip install from a terminal, then starts it again', () => {
    const steps = updateSteps({ kind: 'package', system: 'linux', program: null });
    expect(steps[1].code).toEqual([PIP_COMMAND]);
    expect(steps[1].note).toContain('pip install -U azimut');
    expect(steps.at(-1).code).toEqual(['azimut']);
    expect(texts(steps)).not.toMatch(/download|chmod/i);
  });

  it('promises nothing about shortcuts or names', () => {
    expect(texts(updateSteps({ system: 'linux', program: '/a/azimut' }))).not.toMatch(/shortcut|same name/i);
  });

  it('ends on opening the new one', () => {
    const steps = updateSteps({ system: 'linux', program: '/a/azimut' });
    expect(steps.at(-1).text).toMatch(/^Open it/);
  });
});

describe('labels', () => {
  it('names each released system the way people say it', () => {
    expect(systemLabel('linux')).toBe('Linux');
    expect(systemLabel('windows')).toBe('Windows');
    expect(systemLabel('macos')).toBe('macOS');
  });
});

describe('downloading in place', () => {
  const fakeDoc = () => {
    const made = [];
    return {
      made,
      body: { append: (el) => made.push(el) },
      getElementById: (id) => made.find((el) => el.id === id) ?? null,
      createElement: () => ({ setAttribute() {} }),
    };
  };

  it('hands the file to one hidden frame, reused on a second press', () => {
    const doc = fakeDoc();
    downloadInPlace('https://example.invalid/a', doc);
    downloadInPlace('https://example.invalid/b', doc);
    expect(doc.made).toHaveLength(1);
    expect(doc.made[0]).toMatchObject({ id: 'update-download', hidden: true, src: 'https://example.invalid/b' });
  });
});
