// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PickList from './PickList.svelte';

let held = null;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });

const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); flushSync(); };
const trigger = () => document.querySelector('[role="combobox"]');
const list = () => document.querySelector('[role="listbox"]');
const options = () => [...document.querySelectorAll('[role="option"]')].map((node) => node.textContent.trim());
const activeText = () => document.getElementById(trigger().getAttribute('aria-activedescendant'))?.textContent.trim();
const press = async (key, node = trigger()) => {
  node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await settle();
};

/** The list as the publish window holds it: its value handed back as the dialog keeps it. */
function show({ value = '', options: given = ['Conflict Watch', 'Methods & Tools', 'Élections'] } = {}) {
  const state = $state({ value });
  const onpick = vi.fn((next) => { state.value = next; });
  held = mount(PickList, {
    target: document.body,
    props: {
      get value() { return state.value; }, options: given, emptyLabel: 'No category', newLabel: 'New category…', newPlaceholder: 'New category',
      maxlength: 60, id: 'export-category', title: 'The category this article is listed under on the site', label: 'Category', onpick,
    },
  });
  flushSync();
  return { state, onpick };
}

describe('a value picked from a list drawn as the app draws it', () => {
  it('shows the value, or what none is called, and opens a list of none, the options and a new one on a press', async () => {
    const { onpick } = show();
    expect(trigger().textContent.trim()).toBe('No category');
    expect(trigger().getAttribute('title')).toBeTruthy();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(list()).toBeNull();
    trigger().click();
    await settle();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(list().id);
    expect(options()).toEqual(['No category', 'Conflict Watch', 'Methods & Tools', 'Élections', 'New category…']);
    // the one picked says so
    expect(document.querySelector('[role="option"][aria-selected="true"]').textContent.trim()).toBe('No category');
    [...document.querySelectorAll('[role="option"]')][2].click();
    await settle();
    expect(onpick).toHaveBeenLastCalledWith('Methods & Tools');
    expect(trigger().textContent.trim()).toBe('Methods & Tools');
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('walks the list with the arrows, Home and End, and picks with Enter', async () => {
    const { onpick } = show({ value: 'Conflict Watch' });
    trigger().focus();
    await press('ArrowDown');
    expect(list()).not.toBeNull();
    // it opens on the value picked
    expect(activeText()).toBe('Conflict Watch');
    await press('ArrowDown');
    expect(activeText()).toBe('Methods & Tools');
    await press('End');
    expect(activeText()).toBe('New category…');
    await press('ArrowDown');
    expect(activeText()).toBe('New category…');
    await press('Home');
    expect(activeText()).toBe('No category');
    await press('ArrowUp');
    expect(activeText()).toBe('No category');
    await press('Enter');
    expect(onpick).toHaveBeenLastCalledWith('');
    expect(list()).toBeNull();
    expect(trigger().textContent.trim()).toBe('No category');
  });

  it('filters as letters are typed, whatever their accents, and Backspace takes one back', async () => {
    const { onpick } = show();
    trigger().focus();
    await press('e');
    expect(list()).not.toBeNull();
    expect(document.querySelector('.pick-query').textContent.trim()).toBe('e');
    await press('l');
    // none goes while a filter stands: what is left are the matches and the way to a new one
    expect(options()).toEqual(['Élections', 'New category…']);
    expect(activeText()).toBe('Élections');
    await press('x');
    expect(options()).toEqual(['New category…']);
    await press('Backspace');
    expect(options()).toEqual(['Élections', 'New category…']);
    await press(' ');
    expect(document.querySelector('.pick-query').textContent.trim()).toBe('el');
    await press('Backspace');
    await press('Enter');
    expect(onpick).toHaveBeenLastCalledWith('Élections');
  });

  it('closes on Escape, leaving the value as it was and the focus on the button', async () => {
    const { onpick } = show({ value: 'Conflict Watch' });
    trigger().focus();
    await press('ArrowDown');
    await press('ArrowDown');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(list()).toBeNull();
    expect(onpick).not.toHaveBeenCalled();
    expect(trigger().textContent.trim()).toBe('Conflict Watch');
    expect(document.activeElement).toBe(trigger());
  });

  it('types a new one in a field that takes the button\'s place, handed up letter by letter', async () => {
    const { onpick } = show({ value: 'Conflict Watch' });
    trigger().click();
    await settle();
    [...document.querySelectorAll('[role="option"]')].at(-1).click();
    await settle();
    const field = document.querySelector('#export-category');
    expect(field.tagName).toBe('INPUT');
    expect(field.getAttribute('placeholder')).toBe('New category');
    expect(field.maxLength).toBe(60);
    expect(document.activeElement).toBe(field);
    field.value = 'Port news';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(onpick).toHaveBeenLastCalledWith('Port news');
    field.value = 'Port news ';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await press('Enter', field);
    // ended, it stands trimmed on the button, which takes the focus back and lists it
    expect(onpick).toHaveBeenLastCalledWith('Port news');
    expect(trigger().textContent.trim()).toBe('Port news');
    expect(document.activeElement).toBe(trigger());
    trigger().click();
    await settle();
    expect(options()).toContain('Port news');
    expect(document.querySelector('[role="option"][aria-selected="true"]').textContent.trim()).toBe('Port news');
  });

  it('starts the new one on the letters typed, and Escape gives the value back as it was', async () => {
    const { onpick } = show({ value: 'Conflict Watch' });
    trigger().focus();
    await press('h');
    await press('a');
    await press('End');
    await press('Enter');
    const field = document.querySelector('#export-category');
    expect(field.value).toBe('ha');
    field.value = 'Harbour';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(onpick).toHaveBeenLastCalledWith('Harbour');
    // the field's own Escape: whatever holds the list stays open
    const outside = vi.fn();
    window.addEventListener('keydown', outside);
    await press('Escape', field);
    window.removeEventListener('keydown', outside);
    expect(outside).not.toHaveBeenCalled();
    expect(onpick).toHaveBeenLastCalledWith('Conflict Watch');
    expect(trigger().textContent.trim()).toBe('Conflict Watch');
  });

  it('cuts what is typed to its longest, and ends when the field is left', async () => {
    const { onpick } = show();
    trigger().click();
    await settle();
    [...document.querySelectorAll('[role="option"]')].at(-1).click();
    await settle();
    const field = document.querySelector('#export-category');
    field.value = 'x'.repeat(90);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(onpick.mock.calls.at(-1)[0]).toHaveLength(60);
    field.dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(trigger().textContent.trim()).toBe('x'.repeat(60));
  });
});
