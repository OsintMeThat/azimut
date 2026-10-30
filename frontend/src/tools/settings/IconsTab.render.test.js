// @vitest-environment happy-dom
/**
 * Settings › Icons: the library by group, each icon's name and the way it is
 * drawn set in place, an import dropped on the tab and its report.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const mocks = vi.hoisted(() => {
  const icons = [
    { key: 'aaaaaaaaaaaaaaaa', name: 'Tank', group: 'Armour', mode: 'disc' },
    { key: 'bbbbbbbbbbbbbbbb', name: 'Truck', group: 'Armour', mode: 'image' },
    { key: 'cccccccccccccccc', name: 'Camp', group: 'My icons', mode: 'image' },
  ];
  return {
    icons,
    api: {
      get: vi.fn(async () => ({ icons, max: 1000 })),
      patch: vi.fn(async (path, changes) => ({ ...icons.find((icon) => path.endsWith(icon.key)), ...changes })),
      post: vi.fn(async (_path, body) => ({ removed: body.keys.length, icons: icons.filter((icon) => !body.keys.includes(icon.key)) })),
    },
    send: vi.fn(async () => ({ added: [{ key: 'dddddddddddddddd' }], already: 1, skipped: [{ name: 'notes.txt', reason: 'an icon is a PNG' }] })),
  };
});
vi.mock('../../lib/api.js', () => ({ api: mocks.api }));
vi.mock('../../lib/iconImport.js', () => ({ importIcons: mocks.send }));

const { default: IconsTab } = await import('./IconsTab.svelte');
const { iconLibrary } = await import('../../lib/iconLibrary.svelte.js');

let held;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; vi.clearAllMocks(); });
async function show() {
  // the library is one for the app: each test starts from what the server holds
  await iconLibrary.load(true);
  held = mount(IconsTab, { target: document.body });
  for (let round = 0; round < 4; round++) { await tick(); await Promise.resolve(); }
  flushSync();
}
const byLabel = (label) => document.querySelector(`[aria-label="${label}"]`);

it('lists the library by group, with how many it holds', async () => {
  await show();
  expect([...document.querySelectorAll('.group-name')].map((node) => node.value)).toEqual(['Armour', 'My icons']);
  expect(document.querySelectorAll('.tile')).toHaveLength(3);
  expect(document.body.textContent).toContain('3 / 1000');
});

it('switches the way an icon is drawn, and renames it, in place', async () => {
  await show();
  const truck = byLabel('How Truck is drawn');
  truck.querySelector('[aria-pressed="false"]').click();
  await tick();
  expect(mocks.api.patch).toHaveBeenCalledWith('/api/icons/bbbbbbbbbbbbbbbb', { mode: 'disc' });
  const name = byLabel('Name of Tank');
  name.value = 'Main battle tank';
  name.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
  expect(mocks.api.patch).toHaveBeenCalledWith('/api/icons/aaaaaaaaaaaaaaaa', { name: 'Main battle tank' });
});

it('renames a group by moving each of its icons', async () => {
  await show();
  const group = byLabel('Name of group Armour');
  group.value = 'Vehicles';
  group.dispatchEvent(new Event('change', { bubbles: true }));
  for (let round = 0; round < 4; round++) await tick();
  expect(mocks.api.patch.mock.calls.map(([path, body]) => [path.slice(-4), body])).toEqual([
    ['aaaa', { group: 'Vehicles' }], ['bbbb', { group: 'Vehicles' }]]);
});

it('asks before removing a whole group, saying maps keep their copies', async () => {
  await show();
  byLabel('Remove group Armour').click();
  flushSync();
  expect(document.body.textContent).toContain('Maps that wear them keep their own copies.');
  expect(mocks.api.post).not.toHaveBeenCalled();
  [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Remove').click();
  await tick();
  expect(mocks.api.post).toHaveBeenCalledWith('/api/icons/remove', { keys: ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'] });
});

it('imports what is dropped on it and says what came of each file', async () => {
  await show();
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  const files = [new File(['x'], 'tank.png')];
  Object.defineProperty(drop, 'dataTransfer', { value: { files, types: ['Files'] } });
  byLabel('Drop icons here').dispatchEvent(drop);
  for (let round = 0; round < 6; round++) { await tick(); await Promise.resolve(); }
  flushSync();
  expect(mocks.send).toHaveBeenCalledWith(files, expect.objectContaining({ api: mocks.api }));
  const report = document.querySelector('.report').textContent;
  expect(report).toContain('1 added');
  expect(report).toContain('1 already there');
  expect(report).toContain('1 skipped');
  expect(report).toContain('notes.txt');
});

it('finds an icon by its name or its group', async () => {
  await show();
  const find = byLabel('Find an icon');
  find.value = 'camp'; find.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
  expect([...document.querySelectorAll('.tile .name')].map((node) => node.value)).toEqual(['Camp']);
});

it('makes an empty group, imports a drop into it and offers it to move icons to', async () => {
  await show();
  [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'New group').click();
  flushSync();
  const name = byLabel('Name of the new group');
  name.value = 'Drones'; name.dispatchEvent(new Event('input', { bubbles: true }));
  name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  flushSync();
  expect([...document.querySelectorAll('.group-name')].map((node) => node.value)).toEqual(['Armour', 'My icons', 'Drones']);
  expect(byLabel('Group Drones').textContent).toContain('Empty.');
  expect(mocks.api.patch).not.toHaveBeenCalled();

  const drop = new Event('drop', { bubbles: true, cancelable: true });
  const files = [new File(['x'], 'drone.png')];
  Object.defineProperty(drop, 'dataTransfer', { value: { files, types: ['Files'] } });
  byLabel('Group Drones').dispatchEvent(drop);
  for (let round = 0; round < 6; round++) { await tick(); await Promise.resolve(); }
  expect(mocks.send).toHaveBeenCalledWith(files, expect.objectContaining({ group: 'Drones' }));

  byLabel('More for Camp').click();
  flushSync();
  const drones = [...document.querySelectorAll('.fm-item')].find((node) => node.textContent.trim() === 'Drones');
  drones.click();
  await tick();
  expect(mocks.api.patch).toHaveBeenCalledWith('/api/icons/cccccccccccccccc', { group: 'Drones' });
});

it('drops an empty group without asking', async () => {
  await show();
  [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'New group').click();
  flushSync();
  const name = byLabel('Name of the new group');
  name.value = 'Spare'; name.dispatchEvent(new Event('input', { bubbles: true }));
  name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  flushSync();
  byLabel('Remove group Spare').click();
  flushSync();
  expect(byLabel('Group Spare')).toBeNull();
  expect(mocks.api.post).not.toHaveBeenCalled();
});
