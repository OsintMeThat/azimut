import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * The drawn page never shows its Markdown, the line being written in included: a
 * callout, a list, a to-do and a heading are written with no `>`, `-`, `[ ]` or `#` on
 * screen, Backspace at their edges undoes what they are and never half a mark, a word
 * composed by an input method lands inside the bold it is typed at, a copy carries the
 * Markdown and the page it makes, and a web page pasted in is written as Markdown. The
 * server is stood in for; nothing reaches past it.
 */

const at = '2026-10-01T10:00:00Z';

async function notebook(page, start) {
  const catalog = [{ id: 'n1', type: 'note', label: 'Lead', attrs: { path: 'notes/n1.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } }];
  await installAppFixture(page, { catalog });
  await page.addInitScript(() => localStorage.setItem('azimut.noteMode', 'drawn'));
  const state = { written: [], outside: [] };
  let text = start;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.protocol.startsWith('http')) state.outside.push(url.href);
  });
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      return route.fulfill({ json: { items: [{ id: 'n1', title: 'Lead', folder: '', updated_at: at, excerpt: '', words: 7,
        tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0, look: null, includes: 0 }] } });
    }
    if (/^\/[\w-]+\/look$/.test(path)) return route.fulfill({ json: { look: null } });
    if (path === '/n1') {
      if (request.method() === 'PUT') {
        text = request.postDataJSON().text;
        state.written.push(text);
        return route.fulfill({ json: { status: 'saved' } });
      }
      return route.fulfill({ json: { text } });
    }
    return route.fallback();
  });
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  // the first line as the page draws it, its Markdown put away
  await expect(page.locator('.cm-content')).toContainText(start.split('\n')[0].replace(/^#+ /, '').replace(/\*\*|\[|\]\([^)]*\)/g, ''));
  return state;
}

/** What the line the caret is on shows. */
const caretLine = (page) => page.evaluate(() => {
  const node = document.getSelection().focusNode;
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  return element?.closest('.cm-line')?.textContent ?? '';
});

/** Press at the end (or the start) of the drawn words `words`, their `nth` time on the page. */
async function pressAt(page, words, { before = false, nth = 0 } = {}) {
  const box = await page.locator('.cm-content').evaluate((root, [wanted, start, skip]) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let left = skip;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.data.indexOf(wanted);
      if (index < 0 || left-- > 0) continue;
      const range = document.createRange();
      const at2 = start ? index : index + wanted.length - 1;
      range.setStart(node, at2);
      range.setEnd(node, at2 + 1);
      return range.getBoundingClientRect().toJSON();
    }
    return null;
  }, [words, before, nth]);
  await page.mouse.click(before ? box.x + 1 : box.x + box.width - 1, box.y + box.height / 2);
}

/** Every line the page draws, as it shows. */
const shownLines = (page) => page.locator('.cm-content .cm-line').allTextContents();

test('writes a heading, a list, a to-do and a callout with no Markdown on the line being written', async ({ page }) => {
  const state = await notebook(page, 'Intro.\n');
  await pressAt(page, 'Intro.');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('## ');
  await page.keyboard.type('Findings');
  expect(await caretLine(page)).toBe('Findings');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- First');
  expect(await caretLine(page)).toBe('•First');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second');
  await page.keyboard.press('Tab');
  expect(await caretLine(page)).toBe('  •Second');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[] Check the tow');
  expect(await caretLine(page)).toBe('Check the tow');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  // a callout from the insert menu: its name heads it, never `> [!confirmed]`
  await page.keyboard.type('/callout');
  const menu = page.locator('.cm-tooltip-autocomplete');
  await menu.getByRole('option', { name: /^Confirmed/ }).click();
  await page.keyboard.type('Both videos match.');
  expect(await caretLine(page)).toBe('ConfirmedBoth videos match.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Seen twice.');
  expect(await caretLine(page)).toBe('Seen twice.');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('After.');
  for (const line of await shownLines(page)) expect(line, 'no line shows its Markdown').not.toMatch(/^\s*(#|>|- |\[[ x]\])|\*\*|\[!/);
  await expect.poll(() => state.written.at(-1)).toBe([
    'Intro.', '', '## Findings', '- First', '- Second', '', '- [ ] Check the tow', '', '> [!confirmed] Both videos match.', '> Seen twice.', '', 'After.',
  ].join('\n') + '\n');
  // the callout's name offers the other kinds
  await page.locator('.cm-callout-label').click();
  await page.getByRole('menuitemradio', { name: /^Lead/ }).click();
  await expect.poll(() => state.written.at(-1)).toContain('> [!lead] Both videos match.');
  expect(state.outside).toEqual([]);
});

test('Backspace at the edges undoes a heading and an item, never half a mark, each one Undo step', async ({ page }) => {
  const start = '## Findings\n\n- First\n- Second\n\nThe **mast** matches.\n';
  const state = await notebook(page, start);
  await pressAt(page, 'Findings', { before: true });
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await expect.poll(() => state.written.at(-1)).toBe(start.replace('## Findings', 'Findings'));
  await page.keyboard.press('Control+z');
  await expect.poll(() => state.written.at(-1)).toBe(start);
  await pressAt(page, 'Second', { before: true });
  await page.keyboard.press('Backspace');
  await expect.poll(() => state.written.at(-1)).toBe('## Findings\n\n- First\n\nSecond\n\nThe **mast** matches.\n');
  await page.keyboard.press('Control+z');
  await expect.poll(() => state.written.at(-1)).toBe(start);
  // just after bold: the caret is in it, Backspace takes its last letter, Right steps past it as one place
  await pressAt(page, 'mast');
  await page.keyboard.press('Backspace');
  await expect.poll(() => state.written.at(-1)).toBe(start.replace('**mast**', '**mas**'));
  await page.keyboard.type('t');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Backspace');
  await expect.poll(() => state.written.at(-1)).toBe(start.replace('**mast** ', '**mast**'));
  await expect(page.locator('.cm-content')).not.toContainText('**');
});

test('a word composed by an input method lands inside the bold it is typed at', async ({ page, browserName }) => {
  const state = await notebook(page, 'The **mast** matches.\n');
  await pressAt(page, 'mast');
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    for (const text of ['す', 'すと', 'ストライト']) await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    await expect(page.locator('.cm-content')).not.toContainText('**');
    await cdp.send('Input.insertText', { text: 'ストライト' });
  } else {
    // a browser without a protocol for it: the composition's events around its text
    await page.locator('.cm-content').evaluate((node) => {
      node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      node.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'すと' }));
    });
    await page.keyboard.insertText('ストライト');
    await page.locator('.cm-content').evaluate((node) => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ストライト' })));
  }
  await expect.poll(() => state.written.at(-1)).toBe('The **mastストライト** matches.\n');
  await expect(page.locator('.cm-strong')).toHaveText('mastストライト');
});

test('copies the Markdown and the page it makes, and writes a web page pasted in as Markdown', async ({ page }) => {
  const state = await notebook(page, 'The **mast** and [the report](https://example.org/r) match.\n');
  await pressAt(page, 'mast', { before: true });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+End');
  await page.keyboard.press('Control+c');
  // a field that keeps formatting, as Word or Google Docs does
  await page.evaluate(() => {
    const sink = Object.assign(document.createElement('div'), { id: 'sink', contentEditable: 'true' });
    sink.style.cssText = 'position:fixed;left:8px;top:8px;width:320px;height:60px;z-index:9999;background:#fff';
    document.body.append(sink);
    sink.focus();
  });
  await page.keyboard.press('Control+v');
  await expect(page.locator('#sink strong')).toHaveText('ast');
  await expect(page.locator('#sink a')).toHaveAttribute('href', 'https://example.org/r');
  await page.locator('#sink').evaluate((node) => node.remove());
  // back in the note, at its end: the same Markdown, the cut bold closed again
  await pressAt(page, 'match.');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+v');
  await expect.poll(() => state.written.at(-1)).toBe('The **mast** and [the report](https://example.org/r) match.\n**ast** and [the report](https://example.org/r) match.\n');
  // a page's HTML, copied by the browser itself: its heading, bold, link and list, written as Markdown
  await page.evaluate(() => {
    const page2 = Object.assign(document.createElement('div'), { id: 'web', contentEditable: 'true' });
    page2.innerHTML = '<h2>Port</h2><p>Seen <b>twice</b> by <a href="https://example.org/p">the port</a>.</p><ul><li>One</li><li>Two</li></ul>';
    page2.style.cssText = 'position:fixed;left:8px;top:8px;width:320px;z-index:9999;background:#fff;color:#000';
    document.body.append(page2);
    page2.focus();
    getSelection().selectAllChildren(page2);
  });
  await page.keyboard.press('Control+c');
  await page.locator('#web').evaluate((node) => node.remove());
  await pressAt(page, 'match.', { nth: 1 });
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+v');
  await expect.poll(() => state.written.at(-1)).toContain('\n\n## Port\n\nSeen **twice** by [the port](https://example.org/p).\n\n- One\n- Two');
});

test('a link is its words: a press puts the caret in them, a press with Ctrl opens its page', async ({ page }) => {
  await notebook(page, 'Read [the report](https://example.org/r) first.\n');
  await page.evaluate(() => { window.opened = []; window.open = (url) => { window.opened.push(url); return null; }; });
  await expect(page.locator('.cm-link')).toHaveText('the report');
  await expect(page.locator('.cm-link')).toHaveAttribute('title', /^https:\/\/example\.org\/r\n/);
  await pressAt(page, 'report');
  expect(await caretLine(page)).toBe('Read the report first.');
  expect(await page.evaluate(() => window.opened)).toEqual([]);
  await page.locator('.cm-link').click({ modifiers: ['ControlOrMeta'] });
  expect(await page.evaluate(() => window.opened)).toEqual(['https://example.org/r']);
});
