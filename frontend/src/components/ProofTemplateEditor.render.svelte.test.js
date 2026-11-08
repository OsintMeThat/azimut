// @vitest-environment happy-dom
/**
 * The proof-template editor, actually mounted, on templates as 0.3.3 wrote them.
 *
 * `tests/fixtures/proof-templates-0.3.3.json` is a templates.json of that release:
 * a house style using every key this editor holds without showing (a dragged logo's
 * offsets and ratios, a handle's opacity, a stack direction kept under free layout),
 * and one written before most keys existed. Opened and saved untouched, each must
 * hand Settings back what it held, the server's side of which
 * `tests/test_templates_api.py` checks byte for byte.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

vi.mock('konva', async () => ({ default: (await import('../lib/konva.fixture.js')).FakeKonva }));

const { default: ProofTemplateEditor } = await import('./ProofTemplateEditor.svelte');
const { textSignatureStyle } = await import('../lib/composer.js');

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(here, '../../../tests/fixtures/proof-templates-0.3.3.json'), 'utf8'));
const [DESK, PLAIN] = FIXTURE.proof;

let target;
let app;

function open(record) {
  target = document.createElement('div');
  document.body.append(target);
  // as Settings opens one: a plain copy, never the stored record
  const data = $state(JSON.parse(JSON.stringify(record.data)));
  app = mount(ProofTemplateEditor, { target, props: { get data() { return data; } } });
  flushSync();
  return data;
}

/** What Settings sends when Save is pressed (`Settings.saveEditingTemplate`). */
const payload = (data) => JSON.parse(JSON.stringify({ ...data, signatureText: textSignatureStyle(data.signatureText) }));
/** Without the keys a server writes nothing for when they are null. */
const stated = (data) => Object.fromEntries(Object.entries(data).filter(([key, value]) => !(
  ['sceneBadge', 'footerCredits', 'azimutMark'].includes(key) && value === null)));

afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  app = null;
});

const check = (label) => [...target.querySelectorAll('label.pte-check')]
  .find((node) => node.textContent.trim() === label).querySelector('input');
const toggle = (label) => {
  const box = check(label);
  box.checked = !box.checked;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
};

describe('a template from 0.3.3, opened and saved untouched', () => {
  it.each([DESK, PLAIN])('hands back what "$name" held', (record) => {
    const data = open(record);
    expect(stated(payload(data))).toEqual(record.data);
  });

  it('says nothing yet about the scene time and the credits', () => {
    const data = open(DESK);
    expect(data.sceneBadge).toBeNull();
    expect(data.footerCredits).toBeNull();
    expect(data.azimutMark).toBeNull();
    expect(check('Scene time on the picture').checked).toBe(false);
    expect([...target.querySelectorAll('.pte-hint')].map((n) => n.textContent))
      .toContain('Not set, so each proof keeps its own.');
  });
});

describe('the switches a template now holds', () => {
  it('states the scene time and the credits once pressed, and off stays a choice', () => {
    const data = open(PLAIN);
    toggle('Scene time on the picture');
    expect(data.sceneBadge).toBe(true);
    toggle('Scene time on the picture');
    expect(data.sceneBadge).toBe(false);
    toggle('Imagery credits');
    expect(data.footerCredits).toBe(true);
    expect(payload(data)).toMatchObject({ sceneBadge: false, footerCredits: true });
  });

  it('puts the Azimut mark in the logo\'s corner, with its name, and takes it off again', () => {
    const data = open(DESK);
    toggle('Azimut mark');
    expect(data.azimutMark).toEqual({ anchor: 'tl', name: true, size: 28 });
    toggle('With the name');
    expect(data.azimutMark.name).toBe(false);
    toggle('Azimut mark');
    expect(data.azimutMark).toBeNull();
  });

  it('keeps a dragged logo where it was until another corner is picked', () => {
    const data = open(DESK);
    expect(data.signature).toMatchObject({ dx: 14.5, xRatio: 0.031 });
    const corner = [...target.querySelectorAll('[aria-label="Logo corner"] button')].find((b) => b.textContent === 'Bottom right');
    corner.click();
    flushSync();
    expect(data.signature).toMatchObject({ anchor: 'br', dx: 0, dy: 0 });
    expect(Number.isFinite(data.signature.xRatio)).toBe(false);
  });
});

describe('the sample the template is drawn on', () => {
  it('is drawn beside the settings, grouped as the composer\'s Style tab groups them', () => {
    open(PLAIN);
    expect(target.querySelector('.pte-canvas .psp')).not.toBeNull();
    expect([...target.querySelectorAll('.pte-group h4')].map((h) => h.textContent.trim()))
      .toEqual(['Page', 'Text', 'Footer', 'Signature', 'Drawing colours']);
  });
});
