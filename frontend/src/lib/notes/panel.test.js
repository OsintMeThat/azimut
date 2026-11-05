import { afterEach, describe, expect, it, vi } from 'vitest';
import { inNotePanel, panelState, putDone, readPut, receivePuts, tellPanel } from './panel.js';
import { acceptsOrigin, fromExtension } from './panelOrigin.js';

/**
 * The note in the extension's panel takes what the extension sends only from the
 * extension's page that frames it, and only when every field is what it should be.
 * Anything else is dropped without an answer.
 */

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const put = (fields = {}) => ({ azimut: 'note-put', v: 1, id: 'put-3-1730800000000', action: 'cite', url: 'https://example.org/a', ...fields });

describe('who may send a put', () => {
  it('is an extension page of any of the three browsers, and no web page', () => {
    for (const origin of [EXT, 'moz-extension://0b5f8e2c-1a2b-4c3d-8e9f-001122334455', 'safari-web-extension://ABCD-1234']) {
      expect(fromExtension(origin)).toBe(true);
      expect(acceptsOrigin(origin, { origin: 'http://127.0.0.1:8477', hash: '' })).toBe(true);
    }
    for (const origin of ['https://evil.example', 'http://127.0.0.1:8477', 'null', '', 'chrome-extension://', 'file://', undefined]) {
      expect(acceptsOrigin(origin, { origin: 'http://127.0.0.1:8477', hash: '#notebook?panel=1' })).toBe(false);
    }
  });

  it('is the app\'s own origin only for the browser test\'s stand-in parent, named in the address', () => {
    const place = { origin: 'http://127.0.0.1:18601', hash: '#notebook?panel=1&testParent=1' };
    expect(acceptsOrigin('http://127.0.0.1:18601', place)).toBe(true);
    expect(acceptsOrigin('https://evil.example', place)).toBe(false);
    expect(acceptsOrigin('http://127.0.0.1:18601', { ...place, hash: '#notebook?panel=1' })).toBe(false);
  });
});

describe('a put', () => {
  it('is read with its fields cleaned', () => {
    expect(readPut(put({ title: '  Port   news ' }))).toEqual({
      id: 'put-3-1730800000000', action: 'cite', url: 'https://example.org/a', title: 'Port news', text: '', entityId: '',
    });
    expect(readPut(put({ action: 'quote', text: 'The port\nwas closed', url: 'https://example.org/a#top' })).text).toBe('The port\nwas closed');
    expect(readPut(put({ action: 'picture', url: undefined, entityId: 'e_0123456789' })).entityId).toBe('e_0123456789');
    expect(readPut(put({ action: 'picture', url: null, title: null, entityId: 'e_1' })).url).toBe('');
  });

  it.each([
    ['not a put', 'hello'],
    ['an array', []],
    ['another message', put({ azimut: 'note-panel' })],
    ['another version', put({ v: 2 })],
    ['an unknown key', put({ kind: 'post' })],
    ['an id with other marks', put({ id: 'a b' })],
    ['a long id', put({ id: 'a'.repeat(65) })],
    ['a numeric id', put({ id: 7 })],
    ['an unknown action', put({ action: 'delete' })],
    ['a script address', put({ url: 'javascript:alert(1)' })],
    ['a file address', put({ url: 'file:///etc/passwd' })],
    ['an address that is not one', put({ url: 'example.org/a' })],
    ['a long address', put({ url: `https://example.org/${'a'.repeat(2030)}` })],
    ['an address of the wrong kind', put({ url: ['https://example.org'] })],
    ['a long title', put({ title: 't'.repeat(301) })],
    ['a title of the wrong kind', put({ title: { text: 'x' } })],
    ['a long text', put({ action: 'quote', text: 'w'.repeat(5001) })],
    ['a cite with no address', put({ url: undefined })],
    ['a quote with no words', put({ action: 'quote', text: '   \n ' })],
    ['a picture with no record', put({ action: 'picture' })],
    ['a record id with other marks', put({ action: 'picture', entityId: '../trash' })],
  ])('is dropped when it is %s', (_, data) => {
    expect(readPut(data)).toBeNull();
  });

  it('takes each field at its bound', () => {
    const url = `https://example.org/${'a'.repeat(2048 - 'https://example.org/'.length)}`;
    expect(readPut(put({ url, title: 't'.repeat(300), action: 'quote', text: 'w'.repeat(5000) }))).not.toBeNull();
  });
});

describe('what the panel says', () => {
  it('names its note, Case notes as `case`, or says it holds none', () => {
    expect(panelState({ caseId: 'c1', noteId: 'n1', title: 'Port' })).toEqual({
      azimut: 'note-panel', v: 1, state: 'ready', caseId: 'c1', noteId: 'n1', title: 'Port',
    });
    expect(panelState({ caseId: 'c1', noteId: null, title: '' })).toMatchObject({ state: 'ready', noteId: 'case', title: 'Case notes' });
    expect(panelState(null)).toEqual({ azimut: 'note-panel', v: 1, state: 'none' });
  });

  it('answers a put by its id, with a sentence when it failed', () => {
    expect(putDone('p1', { ok: true })).toEqual({ azimut: 'note-put-done', v: 1, id: 'p1', ok: true });
    expect(putDone('p1', { ok: false, error: 'That capture is not in this case' }))
      .toEqual({ azimut: 'note-put-done', v: 1, id: 'p1', ok: false, error: 'That capture is not in this case' });
    expect(putDone('p1', {}).error).toBe('Nothing was put in the note');
  });

  it('says it only to a page that frames it', () => {
    const parent = { postMessage: vi.fn() };
    tellPanel({ caseId: 'c1', noteId: null, title: 'Case notes' }, { parent });
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ state: 'ready', noteId: 'case' }), '*');
    const alone = { postMessage: vi.fn() };
    alone.parent = alone;
    tellPanel(null, alone);
    expect(alone.postMessage).not.toHaveBeenCalled();
  });
});

describe('panel mode', () => {
  it('is the Notebook asked for as a panel, inside a frame', () => {
    const framed = { parent: {} };
    const alone = {};
    alone.parent = alone;
    expect(inNotePanel('#notebook?case=c1&note=case&solo=1&panel=1', framed)).toBe(true);
    expect(inNotePanel('#notebook?case=c1&note=case&solo=1&panel=1', alone)).toBe(false);
    expect(inNotePanel('#notebook?case=c1&solo=1', framed)).toBe(false);
    expect(inNotePanel('#satellite?panel=1', framed)).toBe(false);
  });
});

describe('the receiver', () => {
  let stop = () => {};
  afterEach(() => stop());

  /** A window framed by `parent`, with a listener list a test can send through. */
  function framedWindow() {
    const listeners = new Set();
    const parent = { postMessage: vi.fn() };
    const win = {
      parent,
      addEventListener: (type, fn) => type === 'message' && listeners.add(fn),
      removeEventListener: (type, fn) => listeners.delete(fn),
    };
    const send = async (data, { origin = EXT, source = parent } = {}) => {
      await Promise.all([...listeners].map((fn) => fn({ data, origin, source })));
    };
    return { win, parent, send, listeners };
  }

  it('runs a valid put from the extension that frames it, and answers that page alone', async () => {
    const { win, parent, send } = framedWindow();
    const run = vi.fn(async () => ({ ok: true }));
    stop = receivePuts(run, { win });
    await send(put({ action: 'quote', text: 'The port was closed' }));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ action: 'quote', text: 'The port was closed' }));
    expect(parent.postMessage).toHaveBeenCalledWith({ azimut: 'note-put-done', v: 1, id: 'put-3-1730800000000', ok: true }, EXT);
  });

  it('answers a refusal or a failure with its sentence', async () => {
    const { win, parent, send } = framedWindow();
    stop = receivePuts(async () => { throw new Error('This note is open in another tab'); }, { win });
    await send(put());
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'This note is open in another tab' }), EXT);
  });

  it('drops, without an answer, a web origin, another window, and a put that is off', async () => {
    const { win, parent, send } = framedWindow();
    const run = vi.fn(async () => ({ ok: true }));
    stop = receivePuts(run, { win });
    await send(put(), { origin: 'https://evil.example' });
    await send(put(), { origin: 'http://127.0.0.1:8477' });
    await send(put(), { source: { postMessage: vi.fn() } });
    await send(put({ url: 'javascript:alert(1)' }));
    await send(put({ extra: true }));
    expect(run).not.toHaveBeenCalled();
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it('listens to nothing in a page that is not framed, and stops when undone', async () => {
    const alone = framedWindow();
    alone.win.parent = alone.win;
    expect(receivePuts(vi.fn(), { win: alone.win })).toBeTypeOf('function');
    expect(alone.listeners.size).toBe(0);
    const { win, listeners } = framedWindow();
    receivePuts(vi.fn(), { win })();
    expect(listeners.size).toBe(0);
  });
});
