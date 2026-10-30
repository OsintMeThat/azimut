import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import UpdateButtons from './UpdateButtons.svelte';
import UpdateSteps from './UpdateSteps.svelte';

const binary = {
  update_available: true,
  latest: 'v0.3.4',
  url: 'https://github.com/OsintMeThat/azimut/releases/tag/v0.3.4',
  asset: 'azimut-linux-x86_64',
  download_url: 'https://github.com/OsintMeThat/azimut/releases/download/v0.3.4/azimut-linux-x86_64',
  install: { kind: 'binary', system: 'linux', program: '/home/u/Apps/azimut-linux-x86_64', workspace: '/home/u/Azimut' },
};

describe('the way to an update', () => {
  it('downloads the binary for this system straight from the release', () => {
    const { body } = render(UpdateButtons, { props: { update: binary } });
    expect(body).toContain(`href="${binary.download_url}"`);
    expect(body).toContain('Download for Linux');
    // no new tab: the press downloads in a hidden frame (downloadInPlace)
    expect(body).toContain(`<a class="btn btn-sm btn-primary dotted" href="${binary.download_url}" rel="noreferrer">`);
  });

  it('keeps the release page beside it, as the quieter button', () => {
    const { body } = render(UpdateButtons, { props: { update: binary } });
    expect(body).toMatch(new RegExp(`<a class="btn btn-sm dotted" href="${binary.url}"`));
  });

  it('makes the release page the main button when the release has no file for this machine yet', () => {
    const update = { ...binary, asset: null, download_url: null };
    const { body } = render(UpdateButtons, { props: { update } });
    expect(body).not.toContain('Download for');
    expect(body).toMatch(/<a class="btn btn-sm dotted btn-primary" href=/);
  });

  it('keeps the release page quiet for a pip install, whose steps are the way', () => {
    const update = { ...binary, asset: null, download_url: null, install: { kind: 'package', system: 'linux' } };
    const { body } = render(UpdateButtons, { props: { update } });
    expect(body).not.toContain('Download for');
    expect(body).not.toContain('btn-primary');
  });

  it('carries the update dot on whichever button is the main one', () => {
    expect(render(UpdateButtons, { props: { update: binary, dot: true } }).body.match(/update-dot/g)).toHaveLength(1);
    const pip = { ...binary, download_url: null };
    expect(render(UpdateButtons, { props: { update: pip, dot: true } }).body).toContain('update-dot');
  });
});

describe('the steps once the download is under way', () => {
  it('names the file coming in, the program to replace and the workspace that stays', () => {
    const { body } = render(UpdateSteps, { props: { update: binary } });
    expect(body).toContain('azimut-linux-x86_64</span>. Then:');
    expect(body).toMatch(/<code[^>]*>\/home\/u\/Apps\/azimut-linux-x86_64<\/code>/);
    expect(body).toMatch(/<code[^>]*>chmod \+x \/home\/u\/Apps\/azimut-linux-x86_64<\/code>/);
    // every command line can be copied
    expect(body.match(/aria-label="Copy /g)).toHaveLength(2);
    expect(body).toContain('Your cases and settings stay in <span class="mono">/home/u/Azimut</span>');
  });
});

describe('a pip install', () => {
  const pip = {
    ...binary,
    asset: null,
    download_url: null,
    install: { kind: 'package', system: 'linux', program: null, workspace: '/home/u/Azimut' },
  };

  it('is told its pipx command up front, framed and ready to copy', () => {
    const { body } = render(UpdateSteps, { props: { update: pip, framed: true } });
    expect(body).toMatch(/class="update-steps[^"]*framed/);
    expect(body).toContain('Update with pipx');
    expect(body).toMatch(/<code[^>]*>pipx upgrade azimut<\/code>/);
    expect(body).toContain('aria-label="Copy pipx upgrade azimut"');
    expect(body).not.toContain('downloading');
  });
});
