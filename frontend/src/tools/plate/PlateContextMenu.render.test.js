// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlateContextMenu from './PlateContextMenu.svelte';
import PlateElements from './PlateElements.svelte';
import { houseLayout } from '../../lib/plate/page.js';

let held = null;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });

describe('the plate\'s right-click menu', () => {
  it('lists what can be done where the pointer is, runs it and closes, a greyed item doing nothing', () => {
    const duplicate = vi.fn();
    const remove = vi.fn();
    const onclose = vi.fn();
    held = mount(PlateContextMenu, { target: document.body, props: { onclose, menu: { at: { x: 40, y: 60 }, title: 'Title', items: [
      { label: 'Duplicate', icon: 'copy', keys: 'Ctrl+D', run: duplicate },
      'sep',
      { label: 'Remove', icon: 'trash', danger: true, disabled: true, run: remove },
    ] } } });
    flushSync();
    const menu = document.body.querySelector('.float-menu[aria-label="Title"]');
    expect(menu.querySelector('.fm-head').textContent).toBe('Title');
    const items = [...menu.querySelectorAll('.fm-item')];
    expect(items.map((item) => item.textContent.replace(/\s+/g, ' ').trim())).toEqual(['Duplicate Ctrl+D', 'Remove']);
    expect(menu.querySelectorAll('.fm-sep')).toHaveLength(1);
    items[1].click();
    expect(remove).not.toHaveBeenCalled();
    items[0].click();
    expect(duplicate).toHaveBeenCalledOnce();
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('opens from a row of the element list with the element it names', () => {
    const oncontext = vi.fn();
    const spec = houseLayout();
    held = mount(PlateElements, { target: document.body, props: { spec, selection: [], oncontext, onrestack: () => {} } });
    flushSync();
    const row = [...document.body.querySelectorAll('.list li')].find((item) => item.textContent.includes('Legend'));
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 90 });
    row.querySelector('.row').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(oncontext).toHaveBeenCalledWith(spec.elements.find((element) => element.kind === 'legend').id, { x: 30, y: 90 });
  });
});
