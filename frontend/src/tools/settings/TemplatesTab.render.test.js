// @vitest-environment happy-dom
/**
 * The Templates section, actually mounted.
 *
 * Each row offers a copy, and a post row also says whether new posts start with
 * it. Both are answers the parent acts on, so what is checked here is what a row
 * hands up when pressed and what it shows for the current default.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import TemplatesTab from './TemplatesTab.svelte';
import { prefs, templatesState } from '../../lib/state.svelte.js';

const PROOF = { id: 'pf_1', name: 'House proof', data: { legend: true } };
const CLASSIC = { id: 'po_1', name: 'Classic', data: { body: '#place' } };
const SHORT = { id: 'po_2', name: 'Short', data: { body: '#coordinates' } };

let target;
let app;
let props;

function open() {
  target = document.createElement('div');
  document.body.append(target);
  props = {
    newTemplate: vi.fn(),
    editTemplate: vi.fn(),
    duplicateTemplate: vi.fn(),
    savePrefs: vi.fn(),
    deleteTpl: null,
  };
  app = mount(TemplatesTab, { target, props });
  flushSync();
}

beforeEach(() => {
  templatesState.proof = [PROOF];
  templatesState.post = [CLASSIC, SHORT];
  prefs.postTemplate = '';
});

afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  app = null;
  templatesState.proof = [];
  templatesState.post = [];
  prefs.postTemplate = '';
});

const rows = () => [...target.querySelectorAll('.tpl-row')];
const rowOf = (name) => rows().find((row) => row.querySelector('.tpl-name').textContent === name);
const button = (row, text) =>
  [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const toggle = (name) => rowOf(name).querySelector('button[aria-pressed]');

describe('Duplicate', () => {
  it('is on every row of both kinds, and hands up the kind and the template', () => {
    open();
    expect(rows()).toHaveLength(3);
    for (const row of rows()) expect(button(row, 'Duplicate')).toBeTruthy();

    button(rowOf('House proof'), 'Duplicate').click();
    expect(props.duplicateTemplate).toHaveBeenLastCalledWith('proof', PROOF);
    button(rowOf('Short'), 'Duplicate').click();
    expect(props.duplicateTemplate).toHaveBeenLastCalledWith('post', SHORT);
    expect(props.editTemplate).not.toHaveBeenCalled();
  });
});

describe('the template new posts start with', () => {
  it('is offered on post rows only', () => {
    open();
    expect(toggle('House proof')).toBeNull();
    expect(toggle('Classic')).not.toBeNull();
    expect(toggle('Short')).not.toBeNull();
    expect(toggle('Short').getAttribute('title')).toBe('Start new posts with this template');
  });

  it('is none until one is chosen', () => {
    open();
    expect(target.querySelectorAll('.tpl-tag')).toHaveLength(0);
    expect(toggle('Classic').getAttribute('aria-pressed')).toBe('false');
    expect(toggle('Short').getAttribute('aria-pressed')).toBe('false');
  });

  it('asks the parent to save the one pressed', () => {
    open();
    toggle('Short').click();
    expect(props.savePrefs).toHaveBeenCalledWith({ post_template: 'po_2' });
  });

  it('marks the default row, and only that one', () => {
    prefs.postTemplate = 'po_2';
    open();
    expect(toggle('Short').getAttribute('aria-pressed')).toBe('true');
    expect(toggle('Classic').getAttribute('aria-pressed')).toBe('false');
    const tags = [...target.querySelectorAll('.tpl-tag')];
    expect(tags.map((tag) => tag.textContent)).toEqual(['Default']);
    expect(rowOf('Short').contains(tags[0])).toBe(true);
  });

  it('is cleared by pressing it again', () => {
    prefs.postTemplate = 'po_2';
    open();
    toggle('Short').click();
    expect(props.savePrefs).toHaveBeenCalledWith({ post_template: '' });
  });

  it('moves to another row when that one is pressed', () => {
    prefs.postTemplate = 'po_2';
    open();
    toggle('Classic').click();
    expect(props.savePrefs).toHaveBeenCalledWith({ post_template: 'po_1' });
  });

  it('follows the saved preference when it changes', () => {
    open();
    prefs.postTemplate = 'po_1';
    flushSync();
    expect(toggle('Classic').getAttribute('aria-pressed')).toBe('true');
    expect(target.querySelectorAll('.tpl-tag')).toHaveLength(1);
  });
});
