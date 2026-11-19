/**
 * HTML copied from a web page, Word or Google Docs, as the Markdown an analyst would
 * write for it: headings, paragraphs, bold, italic, strikethrough, code, links, lists
 * (nested, numbered, to-dos), quotes and line breaks. Pictures, scripts, styles and
 * forms are left out; a table is pasted as a grid before this is asked
 * (`editor/pasteTable.js`), and one that reaches here is read as its words.
 *
 * Word marks its lists with `mso-list` and draws the bullet itself, Google Docs wraps
 * everything in a `<b style="font-weight:normal">` and sets bold with a weight: both are
 * read for what they mean. Pure but for the browser's own HTML parser.
 */

/** Elements left out whole. */
const SKIP = new Set([
  'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'TITLE', 'META', 'LINK', 'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'SVG', 'CANVAS',
  'IFRAME', 'OBJECT', 'EMBED', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'FORM', 'MATH',
]);

/** Elements that start a block of their own. */
const BLOCKS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION', 'ADDRESS', 'DL', 'DT', 'DD',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'CAPTION', 'CENTER', 'DETAILS', 'SUMMARY',
]);

/** The order marks are written in, the outermost first. */
const NESTING = ['bold', 'italic', 'strike', 'code'];
const WRAP = { bold: '**', italic: '*', strike: '~~', code: '`' };

/** The marks an element sets or clears, by its name and its style. */
function marksOf(element, marks) {
  const next = { ...marks };
  const tag = element.tagName;
  if (tag === 'B' || tag === 'STRONG') next.bold = true;
  if (tag === 'I' || tag === 'EM' || tag === 'CITE' || tag === 'DFN' || tag === 'VAR') next.italic = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') next.strike = true;
  if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT') next.code = true;
  const style = element.getAttribute('style') ?? '';
  const weight = /font-weight\s*:\s*([^;]+)/i.exec(style)?.[1].trim();
  if (weight) next.bold = /^(bold|bolder|[6-9]00)$/i.test(weight);
  const slant = /font-style\s*:\s*([^;]+)/i.exec(style)?.[1].trim();
  if (slant) next.italic = /^(italic|oblique)/i.test(slant);
  if (/text-decoration(?:-line)?\s*:[^;]*line-through/i.test(style)) next.strike = true;
  if (tag === 'A') {
    const href = (element.getAttribute('href') ?? '').trim();
    if (/^(https?:|mailto:)/i.test(href)) next.href = href;
  }
  return next;
}

/** Word's list paragraph: `{ depth, ordered }`, or null. */
function wordItem(element) {
  const style = element.getAttribute('style') ?? '';
  const list = /mso-list\s*:\s*l\d+\s+level(\d+)/i.exec(style);
  if (!list && !/^MsoListParagraph/i.test(element.className ?? '')) return null;
  const bullet = element.querySelector('[style*="mso-list:Ignore"], [style*="mso-list: Ignore"]')?.textContent.trim() ?? '';
  return { depth: list ? Number(list[1]) - 1 : 0, ordered: /^[\dA-Za-z]+[.)]/.test(bullet) };
}

class Reader {
  constructor() {
    this.blocks = [];
    this.block = null;
    this.lists = [];
    this.quote = 0;
    this.list = 0; // which list an item is of, counted at each list that is in none
  }

  /** The block being written, started as a paragraph when there is none. */
  current() {
    if (!this.block) this.start({ type: 'p' });
    return this.block;
  }

  start(block) {
    this.end();
    this.block = { runs: [], quote: this.quote, ...block };
  }

  end() {
    if (this.block && (this.block.type === 'hr' || this.block.runs.some((run) => run.text.trim() || run.text === '\n'))) this.blocks.push(this.block);
    this.block = null;
  }

  text(text, marks) {
    const block = this.current();
    const words = block.type === 'pre' ? text : text.replace(/\s+/g, ' ');
    if (words) block.runs.push({ text: words, marks });
  }

  walk(node, marks) {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) this.text(child.data, marks);
      else if (child.nodeType === 1) this.element(child, marks);
    }
  }

  element(element, marks) {
    const tag = element.tagName.toUpperCase();
    if (SKIP.has(tag)) return;
    if (/mso-list\s*:\s*Ignore/i.test(element.getAttribute('style') ?? '')) return;
    if (tag === 'BR') {
      this.current().runs.push({ text: '\n', marks });
      return;
    }
    if (tag === 'HR') {
      this.start({ type: 'hr' });
      this.end();
      return;
    }
    const heading = /^H([1-6])$/.exec(tag);
    if (heading) {
      this.start({ type: 'heading', level: Number(heading[1]) });
      this.walk(element, { ...marksOf(element, marks), bold: false });
      this.end();
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      this.end();
      if (!this.lists.length) this.list += 1;
      this.lists.push({ ordered: tag === 'OL', number: Number(element.getAttribute('start')) || 1 });
      this.walk(element, marks);
      this.lists.pop();
      this.end();
      return;
    }
    if (tag === 'LI') {
      const list = this.lists.at(-1) ?? { ordered: false, number: 1 };
      const level = Number(element.getAttribute('aria-level'));
      const box = element.querySelector(':scope > input[type="checkbox"]');
      this.start({
        type: 'item', list: this.list, depth: level ? level - 1 : Math.max(0, this.lists.length - 1), ordered: list.ordered, number: list.number,
        task: box ? (box.checked || box.hasAttribute('checked') ? 'x' : ' ') : null,
      });
      list.number += 1;
      this.inItem = true;
      this.walk(element, marksOf(element, marks));
      this.inItem = false;
      this.end();
      return;
    }
    if (tag === 'BLOCKQUOTE') {
      this.end();
      this.quote += 1;
      this.walk(element, marksOf(element, marks));
      this.end();
      this.quote -= 1;
      return;
    }
    if (tag === 'PRE') {
      this.start({ type: 'pre' });
      this.walk(element, { code: false });
      this.end();
      return;
    }
    if (BLOCKS.has(tag)) {
      const item = tag === 'P' ? wordItem(element) : null;
      if (item) this.start({ type: 'item', list: 'word', depth: item.depth, ordered: item.ordered, number: 1, task: null });
      // a paragraph inside an item, as Google Docs writes one, is the item's words
      else if (!(this.inItem && this.block?.type === 'item' && !this.block.runs.length)) this.start({ type: 'p' });
      this.walk(element, marksOf(element, marks));
      if (!this.inItem) this.end();
      return;
    }
    // TD, TH and inline elements: their words, a cell parted from the next by a space
    this.walk(element, marksOf(element, marks));
    if (tag === 'TD' || tag === 'TH') this.text(' ', marks);
  }
}

/** Words as Markdown reads them literally: a mark, a bracket or a backslash escaped. */
function escaped(text) {
  return text
    .replace(/([\\`*[\]])/g, '\\$1')
    .replace(/~~/g, '\\~\\~')
    .replace(/(^|[\s(])_|_(?=[\s).,;:!?]|$)/g, (match) => match.replace('_', '\\_'))
    .replace(/<(?=[A-Za-z/!?])/g, '\\<');
}

/** What a block's first words would start in Markdown, escaped so they stay words. */
function plainStart(text) {
  return text
    .replace(/^(\s*)(#{1,6}\s|>|[-+]\s)/, (_match, space, mark) => `${space}\\${mark}`)
    .replace(/^(\s*\d+)([.)]\s)/, '$1\\$2');
}

/** A block's runs of words as Markdown: marks opened and closed as few times as they change, spaces kept outside them. */
function inline(runs) {
  let out = '';
  let open = [];
  const close = (count) => {
    while (open.length > count) {
      const trail = /\s*$/.exec(out)[0];
      out = `${out.slice(0, out.length - trail.length)}${WRAP[open.pop()]}${trail}`;
    }
  };
  const segments = [];
  for (const run of runs) {
    const href = run.marks.href ?? null;
    const last = segments.at(-1);
    if (last && last.href === href) last.runs.push(run);
    else segments.push({ href, runs: [run] });
  }
  for (const segment of segments) {
    const start = out.length;
    for (const run of segment.runs) {
      if (run.text === '\n') {
        close(0);
        out = `${out.trimEnd()}\n`;
        continue;
      }
      const wanted = NESTING.filter((kind) => run.marks[kind]);
      if (!run.text.trim()) {
        out += run.text;
        continue;
      }
      let keep = 0;
      while (keep < open.length && open[keep] === wanted[keep]) keep += 1;
      close(keep);
      const lead = /^\s*/.exec(run.text)[0];
      out += lead;
      for (const kind of wanted.slice(open.length)) {
        out += WRAP[kind];
        open.push(kind);
      }
      const words = run.text.trim();
      out += open.includes('code') ? words.replace(/`/g, "'") : escaped(words);
      out += run.text.slice(lead.length + words.length);
    }
    close(0);
    if (segment.href) {
      const words = out.slice(start);
      const trail = /\s*$/.exec(words)[0];
      const lead = /^\s*/.exec(words)[0];
      const label = words.trim() || segment.href;
      out = `${out.slice(0, start)}${lead}[${label}](${segment.href.replace(/[\s()<>]/g, encodeURIComponent)})${trail}`;
    }
  }
  close(0);
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim();
}

/** The Markdown of HTML, `''` when it holds no words. */
export function htmlToMarkdown(html) {
  return readHtml(html).markdown;
}

/**
 * The Markdown of HTML, and whether the HTML sets anything besides words (a mark, a
 * link, a heading, a list, a quote, code): words alone are pasted as their plain text,
 * so Markdown copied from a code editor stays the Markdown it was.
 */
export function readHtml(html) {
  const page = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
  const reader = new Reader();
  reader.walk(page.body ?? page.documentElement, {});
  reader.end();
  const formatted = reader.blocks.some((block) => block.type !== 'p'
    || block.runs.some((run) => run.marks.href || NESTING.some((kind) => run.marks[kind])));
  let text = '';
  let previous = null;
  for (const block of reader.blocks) {
    const quote = '> '.repeat(block.quote);
    let lines;
    if (block.type === 'hr') lines = ['---'];
    else if (block.type === 'pre') {
      const code = block.runs.map((run) => run.text).join('').replace(/^\n|\n$/g, '');
      lines = ['```', ...code.split('\n'), '```'];
    } else {
      const words = inline(block.runs);
      if (!words) continue;
      if (block.type === 'heading') lines = [`${'#'.repeat(block.level)} ${words.replace(/\n/g, ' ')}`];
      else if (block.type === 'item') {
        const mark = block.ordered ? `${block.number}.` : '-';
        const pad = ' '.repeat(block.depth * (block.ordered ? 3 : 2));
        const box = block.task ? `[${block.task}] ` : '';
        const [first, ...rest] = words.split('\n');
        lines = [`${pad}${mark} ${box}${first}`, ...rest.map((line) => `${pad}${' '.repeat(mark.length + 1)}${line}`)];
      } else lines = plainStart(words).split('\n');
    }
    if (previous) {
      // items of one list follow each other; anything else is parted by a blank line, inside the quote they share
      const tight = previous.type === 'item' && block.type === 'item' && previous.quote === block.quote && previous.list === block.list;
      text += tight ? '\n' : `\n${'> '.repeat(Math.min(previous.quote, block.quote)).trimEnd()}\n`;
    }
    text += lines.map((line) => `${quote}${line}`.replace(/\s+$/, '')).join('\n');
    previous = block;
  }
  return { markdown: text.trim(), formatted };
}
