// @vitest-environment happy-dom
/**
 * Geo Proof's way back to its home, actually mounted: "‹ Proofs" first in the header while
 * a proof is open, and gone at the home. A proof with nothing unsaved goes home at once;
 * one with changes asks the question opening another proof asks, and stays when the
 * analyst keeps editing. What the browser's Back does next is `e2e/back-forward.spec.js`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

// The canvas is not the subject here, and happy-dom draws nothing: Konva answers anything
// asked of it with a stand-in that answers in turn.
vi.mock('konva', () => {
  const fake = () => {
    const own = new Map();
    return new Proxy(function () {}, {
      get(_, key) {
        if (key === Symbol.toPrimitive) return () => 0;
        if (key === Symbol.iterator) return function* () {};
        if (key === 'then' || key === 'toJSON') return undefined;
        if (!own.has(key)) own.set(key, fake());
        return own.get(key);
      },
      set(_, key, value) {
        own.set(key, value);
        return true;
      },
      apply: () => fake(),
      construct: () => fake(),
    });
  };
  return { default: fake() };
});

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(async () => ({})), post: vi.fn(async () => ({})), del: vi.fn(async () => ({})) },
}));
vi.mock('../lib/api.js', () => ({ api }));

const { caseState, uiState } = await import('../lib/state.svelte.js');
const { default: ProofComposer } = await import('./ProofComposer.svelte');

const CASE = { id: 'case-1', folders: [], entities: [] };
const PROOFS = [{ name: 'convoy', title: 'Convoy at the gate', updated_at: '2026-11-01T10:00:00Z', png: 'proofs/convoy.png' }];

function answer(path) {
  if (path.endsWith('/proofs')) return PROOFS;
  if (path.endsWith('/proofs/convoy')) return { title: 'Convoy at the gate', panels: [], pastes: [], shapes: [] };
  if (path.includes('/entities/lookup')) return { entity: { id: 'e1', type: 'proof' } };
  if (path.includes('/entities')) return { items: [], next: null };
  return [];
}

let target;
let app;

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
};
const header = () => target.querySelector('.tool-header');
const back = () => header().querySelector('button[title="Back to the proofs of this case"]');
const home = () => target.querySelector('[data-testid="proof-home"]');
const nameField = () => header().querySelector('input[aria-label="Proof name"]');
const asked = () => document.querySelector('[role="alertdialog"]');
const press = (root, words) => {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent.replace(/\s+/g, ' ').trim() === words);
  expect(button, words).toBeTruthy();
  button.click();
  flushSync();
};

async function openConvoy() {
  uiState.openProof = 'convoy';
  flushSync();
  await settle();
  expect(nameField().value).toBe('Convoy at the gate');
}

beforeEach(async () => {
  api.get.mockReset();
  api.get.mockImplementation(async (path) => answer(path));
  history.replaceState(null, '', '#proof');
  caseState.current = CASE;
  uiState.tool = 'proof';
  target = document.createElement('div');
  document.body.append(target);
  app = mount(ProofComposer, { target });
  flushSync();
  await settle();
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  caseState.current = null;
  document.body.innerHTML = '';
});

describe('the way back to the proofs of the case', () => {
  it('stands first in the header while a proof is open, and never at the home', async () => {
    expect(home()).toBeTruthy();
    expect(back()).toBeNull();

    await openConvoy();
    expect(home()).toBeNull();
    expect(header().firstElementChild).toBe(back());
    expect(back().textContent.trim()).toBe('Proofs');
    expect(back().dataset.guide).toBe('proof.home');
  });

  it('goes home at once from a proof with nothing unsaved, as a step of its own', async () => {
    await openConvoy();
    expect(location.hash).toBe('#proof?proof=convoy');

    back().click();
    await settle();
    expect(asked()).toBeNull();
    expect(home()).toBeTruthy();
    expect(back()).toBeNull();
    expect(location.hash).toBe('#proof');
  });

  it('asks before changes not saved are left, and keeps them when the analyst stays', async () => {
    await openConvoy();
    nameField().value = 'Convoy at the north gate';
    nameField().dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(header().querySelector('.badge')?.textContent).toBe('unsaved');

    back().click();
    await settle();
    expect(asked().getAttribute('aria-label') ?? asked().textContent).toContain('Leave this proof?');
    press(asked(), 'Keep editing');
    await settle();
    expect(asked()).toBeNull();
    expect(home()).toBeNull();
    expect(nameField().value).toBe('Convoy at the north gate');

    back().click();
    await settle();
    press(asked(), 'Leave without saving');
    await settle();
    expect(home()).toBeTruthy();
    expect(back()).toBeNull();
  });
});
