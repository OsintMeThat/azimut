import { describe, expect, it, vi } from 'vitest';
import {
  atLeastChange, badgeWords, chartFixChange, checkEdition, checkFormat, checkedWords, issueCount, readAgainChange, readReady, readyLines, runFix,
} from './readyPanel.js';

/** What the check answers for the owner's article, cut down: as the server words it. */
const ARTICLE = {
  note: 'n1',
  title: 'Article — Report',
  internal: 0,
  weight: 6_774_378,
  links: [],
  pov: [{ text: 'Proof 50: 12.689437, 43.472063', line: 80 }, { text: 'Proof 17: 12.737704, 43.501660', line: 104 }],
  warnings: [
    { text: 'Picture "Figure 3" has no source.', line: 80, kind: 'unsourced', group: 'figures' },
    { text: '105 outside links have no archived copy.', line: 2, kind: 'unarchived', group: 'sources',
      items: [{ text: 'Al Jazeera, 10 Sep', url: 'https://www.aljazeera.com/a', line: 2 }] },
    { text: '90 links are not in the case, so no day says when they were read.', line: 2, kind: 'unseen', group: 'sources',
      items: [{ text: 'Al Jazeera, 10 Sep', url: 'https://www.aljazeera.com/a', line: 2 }] },
    { text: '4 counts read as exact: "13 vehicles", "54 vehicles", "700 wounded", "51 vehicles". Say "at least" or give a range.',
      line: 38, kind: 'count', group: 'words',
      items: [{ text: '13 vehicles', url: '', line: 38 }, { text: '54 vehicles', url: '', line: 175 },
        { text: '700 wounded', url: '', line: 215 }, { text: '51 vehicles', url: '', line: 234 }] },
    { text: '"Losses" counts at least: say so in its title.', line: 12, kind: 'other', group: 'figures', fix: [['title', 'At least 5 losses']] },
    { text: 'The chart "Losses": its rows differ from "Register". Read them again to bring them up to date.', line: 14, kind: 'stale', group: 'figures' },
  ],
  ready: {
    format: 'html', edition: 'public', style: 'report', tlp: 'amber',
    pictures: [{ text: 'Figure 9', line: 140, alt: false, credit: true }],
    claims: [{ id: 'c1', text: 'hit twice', line: 7 }],
    gone: [{ text: 'Old page', url: 'https://old.example.org', line: 9 }],
    unarchived: [{ text: 'Al Jazeera, 10 Sep', url: 'https://www.aljazeera.com/a', line: 2 }],
    unseen: [{ text: 'Al Jazeera, 10 Sep', url: 'https://www.aljazeera.com/a', line: 2 }, { text: 'Other', url: 'https://b.example.org', line: 5 }],
  },
};

const texts = (lines) => lines.map((line) => line.text);

describe('the Ready panel', () => {
  it('groups what the check says, one line per exact count, in the check’s words', () => {
    const groups = readyLines(readReady(ARTICLE, 'html'), { canEdit: true });
    expect(texts(groups.words)).toEqual([
      '“13 vehicles” reads as exact.', '“54 vehicles” reads as exact.', '“700 wounded” reads as exact.', '“51 vehicles” reads as exact.',
      'The claim “hit twice” cites no source.',
    ]);
    expect(groups.words.map((line) => line.line)).toEqual([38, 175, 215, 234, 7]);
    expect(texts(groups.sources)).toEqual([
      '105 outside links have no archived copy.', '90 links are not in the case, so no day says when they were read.',
      '“Old page” no longer answered when its links were last archived.',
    ]);
    expect(texts(groups.figures)).toEqual([
      'Picture "Figure 3" has no source.', '"Losses" counts at least: say so in its title.',
      'The chart "Losses": its rows differ from "Register". Read them again to bring them up to date.',
      'Picture “Figure 9” has no alt text.', '2 points of view are shown to the metre.',
    ]);
    expect(texts(groups.edition)).toEqual(['Public edition.', 'Marked TLP:AMBER on every page.']);
    expect(texts(groups.reach)).toEqual(['About 6.5 MB, under the 25 MB it aims for.']);
  });

  it('counts what is to look at, never what it only says', () => {
    const groups = readyLines(readReady(ARTICLE, 'html'));
    // 4 counts, 1 claim, 3 source lines, 5 figure lines; the edition and the weight are said
    expect(issueCount(groups)).toBe(13);
    expect(badgeWords(13)).toBe('13 to look at');
    expect(badgeWords(0)).toBe('Ready');
    // the points of view rounded in the export are said, not counted
    expect(issueCount(readyLines(readReady(ARTICLE, 'html'), { rounded: true }))).toBe(12);
  });

  it('offers each fix the check allows, and those that write in the note only while it is open', () => {
    const fixes = (canEdit) => Object.values(readyLines(readReady(ARTICLE, 'html'), { canEdit })).flat()
      .filter((line) => line.fix).map((line) => line.fix.id);
    expect(fixes(true)).toEqual(['atleast', 'atleast', 'atleast', 'atleast', 'claim', 'archive', 'bookmark', 'chart', 'again', 'round']);
    expect(fixes(false)).toEqual(['claim', 'archive', 'bookmark', 'round']);
    const lines = Object.values(readyLines(readReady(ARTICLE, 'html'), { canEdit: true })).flat();
    expect(lines.find((line) => line.fix?.id === 'chart').fix.label).toBe('Add “at least” to the title');
    expect(lines.find((line) => line.fix?.id === 'bookmark').fix).toMatchObject({ label: 'Bookmark them', links: ARTICLE.ready.unseen });
  });

  it('folds a style’s one line per link into one line per kind', () => {
    const each = {
      ...ARTICLE,
      warnings: [
        { text: '“A” has no archived copy.', line: 2, kind: 'unarchived', group: 'sources' },
        { text: '“B” has no archived copy.', line: 5, kind: 'unarchived', group: 'sources' },
      ],
      ready: { ...ARTICLE.ready, unarchived: [{ text: 'A', url: 'https://a.example.org', line: 2 }, { text: 'B', url: 'https://b.example.org', line: 5 }] },
    };
    const sources = readyLines(readReady(each, 'html')).sources.filter((line) => line.kind === 'unarchived');
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ text: '2 outside links have no archived copy.', items: each.ready.unarchived, fix: { id: 'archive' } });
  });

  it('says what a PDF checks, and the edition and marking a note leaves unset', () => {
    const pdf = readReady({ ...ARTICLE, weight: undefined, pov: undefined, ready: { ...ARTICLE.ready, format: 'pdf', edition: 'internal', tlp: '' }, internal: 2 }, 'pdf');
    const groups = readyLines(pdf);
    expect(texts(groups.edition)).toEqual([
      'Internal edition: 2 internal passages print in marked boxes, and stay out of the public one.', 'No TLP marking.',
    ]);
    expect(texts(groups.reach)).toEqual(['A PDF holds every picture and clip still; the weight is said for an HTML page or a web folder.']);
    expect(checkedWords(pdf)).toBe('Checked as the PDF, internal edition.');
  });

  it('checks as the export would write, WordPress as its page and a page online in public', () => {
    expect(checkFormat('wordpress')).toBe('html');
    expect(checkFormat('web')).toBe('web');
    expect(checkFormat('nonsense')).toBe('pdf');
    expect(checkEdition('web', 'internal')).toBe('public');
    expect(checkEdition('pdf', 'internal')).toBe('internal');
  });
});

describe('the fixes that write in the note', () => {
  it('says “at least” before the count the check found, past a hedged one', () => {
    const text = '# T\n\nAbout 54 vehicles were seen,\nand then **54** vehicles burned.\n\nMore.';
    const change = atLeastChange(text, 2, '54 vehicles');
    expect(change).toMatchObject({ insert: 'at least ', expected: '' });
    const after = `${text.slice(0, change.from)}${change.insert}${text.slice(change.to)}`;
    expect(after).toBe('# T\n\nAbout 54 vehicles were seen,\nand then **at least 54** vehicles burned.\n\nMore.');
    // the paragraph holds it hedged only: nothing to write
    expect(atLeastChange('At least 54 vehicles.', 0, '54 vehicles')).toBeNull();
    expect(atLeastChange('Nothing here.', 0, '54 vehicles')).toBeNull();
    expect(atLeastChange('54 vehicles.', 4, '54 vehicles')).toBeNull();
  });

  it('writes a chart’s own fix into its block, the rest of the note untouched', () => {
    const text = 'Intro.\n\n::: chart\ntitle: Losses\ncount: At least\n| A | At least |\n| --- | --- |\n| x | 3 |\n:::\n\nEnd.';
    const change = chartFixChange(text, 3, [['title', 'At least 3 losses']]);
    const after = `${text.slice(0, change.from)}${change.insert}${text.slice(change.to)}`;
    expect(after).toBe(text.replace('title: Losses', 'title: At least 3 losses'));
    expect(change.expected).toBe(text.slice(change.from, change.to));
    expect(chartFixChange(text, 0, [['title', 'X']])).toBeNull();
  });

  it('reads a chart’s rows again from this note’s table or from elsewhere, as Read again does', async () => {
    const table = '| Model | Grade |\n| --- | --- |\n| Cougar | Confirmed |\n| Kirpi | Almost sure |';
    const text = `# Register\n\n${table}\n\n::: chart\ntitle: By model\nfrom: note:n1\n| Model | Grade |\n| --- | --- |\n| Cougar | Confirmed |\n:::\n`;
    const line = text.split('\n').indexOf('from: note:n1');
    const local = await readAgainChange(text, line, { noteId: 'n1' });
    expect(local.insert).toContain('| Kirpi | Almost sure |');
    const elsewhere = text.replace('from: note:n1', 'from: sheet:s1');
    const rows = vi.fn(async () => ({ found: true, name: 'Register', text: table }));
    const read = await readAgainChange(elsewhere, line, { noteId: 'n1', caseId: 'c1', rows });
    expect(rows).toHaveBeenCalledWith({ caseId: 'c1', origin: 'sheet:s1', fresh: true });
    expect(read.insert).toContain('| Kirpi | Almost sure |');
    // the same rows already: nothing to read again
    expect(await readAgainChange(text.replace('| Kirpi | Almost sure |\n', ''), line - 1, { noteId: 'n1' })).toBeNull();
  });
});

describe('each fix is the action that exists elsewhere', () => {
  const actions = () => ({
    noteId: 'n1', caseId: 'c1', text: () => 'We saw 12 trucks.', write: vi.fn(() => true), rows: vi.fn(),
    archive: vi.fn(), bookmark: vi.fn(async () => {}), round: vi.fn(), open: vi.fn(),
  });

  it('writes, opens the archive, files the bookmarks, rounds and opens the claim', async () => {
    const done = actions();
    expect(await runFix({ line: 0, fix: { id: 'atleast', phrase: '12 trucks' } }, done)).toBe(true);
    expect(done.write).toHaveBeenCalledWith({ from: 7, to: 7, insert: 'at least ', expected: '' }, expect.any(String));
    expect(await runFix({ fix: { id: 'archive' } }, done)).toBe(false);
    expect(done.archive).toHaveBeenCalledOnce();
    const links = [{ text: 'A', url: 'https://a.example.org', line: 2 }];
    expect(await runFix({ fix: { id: 'bookmark', links } }, done)).toBe(true);
    expect(done.bookmark).toHaveBeenCalledWith(links);
    await runFix({ fix: { id: 'round' } }, done);
    await runFix({ fix: { id: 'unround' } }, done);
    expect(done.round.mock.calls).toEqual([[true], [false]]);
    await runFix({ fix: { id: 'claim', entity: 'c9' } }, done);
    expect(done.open).toHaveBeenCalledWith('c9');
  });
});
