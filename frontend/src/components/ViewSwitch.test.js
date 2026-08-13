import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ViewSwitch.svelte', import.meta.url), 'utf8');
const files = readFileSync(new URL('../tools/Files.svelte', import.meta.url), 'utf8');
const media = readFileSync(new URL('../tools/MediaLibrary.svelte', import.meta.url), 'utf8');

describe('the control that says how a screen renders its answer', () => {
  it('keeps the markup Files and the Media Library already draw by hand', () => {
    // so those two are a drop-in migration rather than a rewrite
    expect(source).toContain('<div class="view-switch" role="group" aria-label={label}>');
    expect(source).toContain('class:active={value === option.id}');
    expect(source).toContain('aria-pressed={value === option.id}');
    for (const drawn of [files, media]) {
      expect(drawn).toContain('<div class="view-switch" role="group" aria-label="View">');
      expect(drawn).toContain('aria-pressed={view === v.id}');
    }
  });

  it('carries the same sizes, so a migrated switch does not move on screen', () => {
    for (const rule of ['padding: 3px 8px;', 'border-radius: var(--r-sm);', 'gap: 2px;']) {
      expect(source).toContain(rule);
    }
    expect(source).toContain('<Icon name={option.icon} size={14} />');
  });

  it('offers an option it cannot answer with, dimmed rather than absent', () => {
    // a control you can see and cannot use teaches something; one that is not there
    // teaches nothing
    expect(source).toContain('disabled={Boolean(option.disabled) && value !== option.id}');
    expect(source).toMatch(/\.view-btn:disabled \{[^}]*opacity: 0\.45;/);
  });

  it('never dims the state that is on', () => {
    // the screen would be showing itself as unavailable
    expect(source).toContain('&& value !== option.id}');
  });

  it('states the reason in the tooltip the caller gives it', () => {
    expect(source).toContain('title={option.hint ?? `${option.label} view`}');
  });
});
