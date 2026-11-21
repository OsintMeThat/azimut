import { afterEach, describe, expect, it, vi } from 'vitest';

const { get, post, put, del } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
const drawDiagrams = vi.hoisted(() => vi.fn(async () => ({ k1: '<svg/>' })));
vi.mock('./api.js', () => ({ api: { get, post, put, del } }));
vi.mock('./notesExport.js', () => ({ drawDiagrams, asSvg: (svg) => svg }));

const { categoriesOf, checkFolder, deleteCategory, keepAddedCategories, moveToCategory, publishNote, readCategories, readGitHub, readState, renameCategory,
  saveGitHub, startLegalNotice, updateSite, watchBuild } =
  await import('./githubPages.js');

afterEach(() => vi.clearAllMocks());

describe('the GitHub Pages site, as Settings and the dialog read it', () => {
  it('reads the site from this machine only, never a token', async () => {
    get.mockResolvedValue({ github: { account: 'octo', repo: 'articles', branch: 'main', site: '', token: { set: true, hint: '…abcd' } } });
    expect(await readGitHub()).toEqual({ account: 'octo', repo: 'articles', branch: 'main', site: '',
      base: 'https://octo.github.io/articles/', token: { set: true, hint: '…abcd' },
      website: { title: '', logo: false, counting: '' }, categories: [], added: [] });
    expect(get).toHaveBeenCalledWith('/api/publishing');
    expect(post).not.toHaveBeenCalled();
    // a server that knows nothing of GitHub yet reads as nothing set
    expect(readState(undefined)).toEqual({ account: '', repo: 'articles', branch: 'main', site: '', base: '',
      token: { set: false, hint: '' }, website: { title: '', logo: false, counting: '' }, categories: [], added: [] });
    expect(readState({ account: 'octo', site: 'javascript:alert(1)' }).site).toBe('');
    put.mockResolvedValue({ account: 'octo' });
    await saveGitHub({ token: 'github_pat_x' });
    expect(put).toHaveBeenCalledWith('/api/publishing/github', { token: 'github_pat_x' });
  });

  it('reads the website the server makes: its title as it reads, its logo, its counter and its categories', () => {
    const read = readState({ account: 'octo', website: { title: 'Desk', logo: true, counting: 'cloudflare' },
      categories: ['Conflict Watch', ' conflict  watch ', '', 'Methods & Tools', 7] });
    expect(read.website).toEqual({ title: 'Desk', logo: true, counting: 'cloudflare' });
    // once each, whatever the case, as many words as the look keeps
    expect(read.categories).toEqual(['Conflict Watch', 'Methods & Tools', '7']);
    expect(readState({ website: { counting: 'plausible' } }).website.counting).toBe('');
    expect(categoriesOf(['x'.repeat(90)])[0]).toHaveLength(60);
    expect(categoriesOf('Harbour')).toEqual([]);
    expect(readState({ added: ['Rail yards', 'rail yards', 3] }).added).toEqual(['Rail yards', '3']);
  });

  it('keeps an added category on this machine, and sends a change of categories to GitHub on its press only', async () => {
    put.mockResolvedValue({ added: ['Bridges'], categories: ['Bridges', 'Harbour'] });
    expect(await keepAddedCategories(['Bridges', ' bridges '])).toEqual({ added: ['Bridges'], categories: ['Bridges', 'Harbour'] });
    expect(put).toHaveBeenCalledWith('/api/publishing/github/categories/added', { names: ['Bridges'] });
    post.mockResolvedValue({ ok: true });
    await renameCategory('Harbour', 'Ports');
    expect(post).toHaveBeenLastCalledWith('/api/publishing/github/categories/rename', { name: 'Harbour', to: 'Ports' });
    await deleteCategory('Harbour');
    expect(post).toHaveBeenLastCalledWith('/api/publishing/github/categories/delete', { name: 'Harbour' });
    await moveToCategory('2026/01/old', '');
    expect(post).toHaveBeenLastCalledWith('/api/publishing/github/site/category', { folder: '2026/01/old', category: '' });
    expect(get).not.toHaveBeenCalled();
  });

  it('reaches GitHub only on the presses: Update the site, Read the categories, the check, the Legal notice', async () => {
    post.mockResolvedValue({ ok: true });
    await updateSite();
    expect(post).toHaveBeenLastCalledWith('/api/publishing/github/site');
    await readCategories();
    expect(post).toHaveBeenLastCalledWith('/api/publishing/github/categories');
    await checkFolder('c1', 'n1', 'port-strike');
    expect(post).toHaveBeenLastCalledWith('/api/cases/c1/notes/n1/github/check', { short_name: 'port-strike' });
    await checkFolder('c1', null, 'port-strike');
    expect(post).toHaveBeenLastCalledWith('/api/cases/c1/notes/case/github/check', { short_name: 'port-strike' });
    await startLegalNotice('c1');
    expect(post).toHaveBeenLastCalledWith('/api/cases/c1/notes/legal-notice');
    expect(get).not.toHaveBeenCalled();
  });

  it('publishes with the diagrams drawn as SVG, the short name and what the dialog asked', async () => {
    post.mockImplementation(async (path) => {
      if (path.endsWith('/pdf/diagrams')) return { diagrams: [{ key: 'k1', source: 'graph TD; A-->B' }] };
      return { published: true, address: 'https://octo.github.io/articles/port-strike/', commit: 'c'.repeat(40) };
    });
    const said = await publishNote('c1', 'n1', { shortName: 'port-strike', roundPov: true, changes: ' Fixed a date. ' });
    expect(post).toHaveBeenCalledWith('/api/cases/c1/notes/pdf/diagrams', { notes: ['n1'], edition: 'public' });
    expect(drawDiagrams.mock.calls[0][1].toPng('<svg/>')).toBe('<svg/>');
    // its maps live unless the dialog keeps them offline
    expect(post).toHaveBeenLastCalledWith('/api/cases/c1/notes/n1/github', {
      short_name: 'port-strike', diagrams: { k1: '<svg/>' }, round_pov: true, changes: 'Fixed a date.', offline_maps: false });
    expect(said.address).toBe('https://octo.github.io/articles/port-strike/');
    // what the dialog chose for the site goes with it; a choice it did not make is left to the note's look
    await publishNote('c1', 'n1', { shortName: 'port-strike', category: '  Conflict   Watch ', role: 'page' });
    expect(post.mock.calls.at(-1)[1]).toMatchObject({ category: 'Conflict Watch', role: 'page' });
    await publishNote('c1', 'n1', { shortName: 'port-strike', category: '', role: 'article' });
    expect(post.mock.calls.at(-1)[1]).toMatchObject({ category: '', role: 'article' });
    await publishNote('c1', 'n1', { shortName: 'port-strike', role: 'scroll' });
    expect('category' in post.mock.calls.at(-1)[1] || 'role' in post.mock.calls.at(-1)[1]).toBe(false);
    post.mockImplementation(async (path) => (path.endsWith('/pdf/diagrams') ? { diagrams: [] }
      : { published: false, needs: 'pages', detail: 'Pages is off for octo/articles.' }));
    expect(await publishNote('c1', null, { shortName: 'x' })).toEqual({ published: false, needs: 'pages', detail: 'Pages is off for octo/articles.' });
    expect(post).toHaveBeenLastCalledWith('/api/cases/c1/notes/case/github', expect.objectContaining({ short_name: 'x' }));
  });
});

describe('watching a page being built', () => {
  const clock = () => {
    let at = 0;
    return { now: () => at, wait: async (ms) => { at += ms; } };
  };

  it('asks until Pages has built the commit', async () => {
    const answers = ['building', 'building', 'built'];
    const ask = vi.fn(async () => ({ state: answers.shift() }));
    expect(await watchBuild('c'.repeat(40), { ask, ...clock() })).toEqual({ state: 'built' });
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('says GitHub could not build it, in its words', async () => {
    const ask = async () => ({ state: 'errored', detail: 'Page build failed.' });
    expect(await watchBuild('c', { ask, ...clock() })).toEqual({ state: 'errored', detail: 'Page build failed.' });
  });

  it('stops asking after a bounded time, a failed ask counted as building', async () => {
    const ask = vi.fn(async () => { throw new Error('offline'); });
    expect(await watchBuild('c', { ask, within: 20_000, every: 5_000, ...clock() })).toEqual({ state: 'slow' });
    expect(ask.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('stops when the dialog closes', async () => {
    const controller = new AbortController();
    const ask = vi.fn(async () => { controller.abort(); return { state: 'building' }; });
    expect(await watchBuild('c', { ask, signal: controller.signal, ...clock() })).toEqual({ state: 'stopped' });
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
