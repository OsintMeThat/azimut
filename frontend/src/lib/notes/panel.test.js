import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIMITS, TAB_ACCESS, TAB_ACTIONS, askTab, inNotePanel, panelState, putDone, readPut, readTab, receivePuts, receiveTab, runTab, tellPanel } from './panel.js';
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

const tab = (fields = {}) => ({
  azimut: 'note-tab', v: 1, access: 'open', url: 'https://example.org/news/strike', title: 'Strike | Example News', selection: 'Berths 10 to 14', post: false, ...fields,
});

describe('the tab in front', () => {
  it('is read with its fields cleaned: the address in full, the title on one line, the words as selected', () => {
    expect(readTab(tab({ title: '  Strike \n  news  ', url: 'https://example.org' }))).toEqual({
      access: 'open', url: 'https://example.org/', title: 'Strike news', selection: 'Berths 10 to 14', post: false,
    });
    expect(readTab(tab({ selection: 'Berths 10\nto 14' })).selection).toBe('Berths 10\nto 14');
    expect(readTab(tab({ selection: '   \n ' })).selection).toBe('');
    expect(readTab(tab({ selection: '' })).selection).toBe('');
    expect(readTab(tab({ post: true })).post).toBe(true);
    expect(TAB_ACCESS).toEqual(['open', 'closed', 'none']);
  });

  it('holds nothing of a tab it may not read, whatever it was sent', () => {
    const blank = { url: '', title: '', selection: '', post: false };
    expect(readTab(tab({ access: 'closed', url: '', title: '', selection: '' }))).toEqual({ access: 'closed', ...blank });
    expect(readTab(tab({ access: 'closed' }))).toEqual({ access: 'closed', ...blank });
    expect(readTab(tab({ access: 'none', post: true }))).toEqual({ access: 'none', ...blank });
    // still a message that is checked: a bad field refuses it, whatever the access
    expect(readTab(tab({ access: 'none', url: 'javascript:alert(1)' }))).toBeNull();
    expect(readTab(tab({ access: 'closed', selection: 'w'.repeat(LIMITS.selection + 1) }))).toBeNull();
  });

  it.each([
    ['not a tab', 'hello'],
    ['null', null],
    ['an array', []],
    ['another message', tab({ azimut: 'note-put' })],
    ['another version', tab({ v: 2 })],
    ['an unknown key', tab({ kind: 'post' })],
    ['an unknown access', tab({ access: 'yes' })],
    ['an access of the wrong kind', tab({ access: ['open'] })],
    ['a script address', tab({ url: 'javascript:alert(1)' })],
    ['a file address', tab({ url: 'file:///etc/passwd' })],
    ['an address that is not one', tab({ url: 'example.org/a' })],
    ['a long address', tab({ url: `https://example.org/${'a'.repeat(2030)}` })],
    ['an address of the wrong kind', tab({ url: ['https://example.org'] })],
    ['no address on a tab that may be read', tab({ url: '' })],
    ['a long title', tab({ title: 't'.repeat(LIMITS.title + 1) })],
    ['a title of the wrong kind', tab({ title: { text: 'x' } })],
    ['a long selection', tab({ selection: 'w'.repeat(LIMITS.selection + 1) })],
    ['a selection of the wrong kind', tab({ selection: 7 })],
    ['a post flag of the wrong kind', tab({ post: 'yes' })],
  ])('is refused when it is %s', (_name, data) => {
    expect(readTab(data)).toBeNull();
  });

  it.each(['url', 'title', 'selection', 'post', 'access', 'v', 'azimut'])('is refused with its %s missing', (key) => {
    const data = tab();
    delete data[key];
    expect(readTab(data)).toBeNull();
    // and absent is not the same as null
    expect(readTab({ ...tab(), [key]: null })).toBeNull();
    expect(readTab({ ...tab(), [key]: undefined })).toBeNull();
  });

  it('takes each field at its bound', () => {
    expect(readTab(tab({ title: 't'.repeat(LIMITS.title) })).title).toHaveLength(LIMITS.title);
    expect(readTab(tab({ selection: 'w'.repeat(LIMITS.selection) })).selection).toHaveLength(LIMITS.selection);
    expect(readTab(tab({ url: `https://example.org/${'a'.repeat(2000)}` })).url).toHaveLength(2020);
  });

  it('is refused from an object with a strange prototype, and from a class instance', () => {
    class Tab {}
    const odd = Object.assign(new Tab(), tab());
    expect(readTab(odd)).toBeNull();
    expect(readTab(Object.assign(Object.create(null), tab()))).not.toBeNull();
  });
});

describe('the tab receiver', () => {
  let stop = () => {};
  afterEach(() => stop());

  function framedWindow() {
    const listeners = new Set();
    const parent = { postMessage: vi.fn() };
    const win = {
      parent,
      addEventListener: (type, fn) => type === 'message' && listeners.add(fn),
      removeEventListener: (type, fn) => listeners.delete(fn),
    };
    const send = (data, { origin = EXT, source = parent } = {}) => [...listeners].forEach((fn) => fn({ data, origin, source }));
    return { win, parent, send, listeners };
  }

  it('hands up the tab the extension that frames it says, as read, and answers nothing', () => {
    const { win, parent, send } = framedWindow();
    const handle = vi.fn();
    stop = receiveTab(handle, { win });
    send(tab({ title: '  Strike  ' }));
    expect(handle).toHaveBeenCalledWith({ access: 'open', url: 'https://example.org/news/strike', title: 'Strike', selection: 'Berths 10 to 14', post: false });
    send(tab({ access: 'closed' }));
    expect(handle).toHaveBeenLastCalledWith({ access: 'closed', url: '', title: '', selection: '', post: false });
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it('drops a web origin, another window, a put, and a tab that is off', () => {
    const { win, send } = framedWindow();
    const handle = vi.fn();
    stop = receiveTab(handle, { win });
    send(tab(), { origin: 'https://evil.example' });
    send(tab(), { origin: 'http://127.0.0.1:8477' });
    send(tab(), { source: { postMessage: vi.fn() } });
    send(put());
    send(tab({ url: 'javascript:alert(1)' }));
    send(tab({ extra: true }));
    send('open');
    expect(handle).not.toHaveBeenCalled();
  });

  it('is not the put receiver: a tab runs no put, and a put is no tab', async () => {
    const { win, send, parent } = framedWindow();
    const run = vi.fn(async () => ({ ok: true }));
    const handle = vi.fn();
    stop = (() => { const a = receivePuts(run, { win }); const b = receiveTab(handle, { win }); return () => { a(); b(); }; })();
    send(tab());
    send(put());
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
  });

  it('listens to nothing in a page that is not framed, and stops when undone', () => {
    const alone = framedWindow();
    alone.win.parent = alone.win;
    expect(receiveTab(vi.fn(), { win: alone.win })).toBeTypeOf('function');
    expect(alone.listeners.size).toBe(0);
    const { win, listeners } = framedWindow();
    receiveTab(vi.fn(), { win })();
    expect(listeners.size).toBe(0);
  });
});

describe('the asks of the Add menu', () => {
  it('asks what the tab is, to the page that frames it, with nothing else', () => {
    const parent = { postMessage: vi.fn() };
    expect(askTab({ parent })).toBe(true);
    expect(parent.postMessage).toHaveBeenCalledWith({ azimut: 'note-tab-ask', v: 1 }, '*');
  });

  it('asks for each action it knows, and no other', () => {
    expect(TAB_ACTIONS).toEqual(['capture', 'cite', 'quote', 'allow']);
    for (const action of TAB_ACTIONS) {
      const parent = { postMessage: vi.fn() };
      expect(runTab(action, { parent })).toBe(true);
      expect(parent.postMessage).toHaveBeenCalledWith({ azimut: 'note-tab-run', v: 1, action }, '*');
    }
    for (const action of ['picture', 'delete', '', undefined, null, ['cite'], 'CAPTURE']) {
      const parent = { postMessage: vi.fn() };
      expect(runTab(action, { parent })).toBe(false);
      expect(parent.postMessage).not.toHaveBeenCalled();
    }
  });

  it('says nothing in a page that is not framed', () => {
    const alone = { postMessage: vi.fn() };
    alone.parent = alone;
    expect(askTab(alone)).toBe(false);
    expect(runTab('cite', alone)).toBe(false);
    expect(alone.postMessage).not.toHaveBeenCalled();
    expect(askTab(undefined)).toBe(false);
  });
});
