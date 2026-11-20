// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import NotesHome from './NotesHome.svelte';

const row = (id, title, look = null) => ({
  id, title, folder: '', excerpt: '', updated_at: '2026-11-20T10:00:00Z', look,
  tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0, includes: 0,
});

let app;
let target;

function home(rows) {
  target = document.createElement('div');
  document.body.append(target);
  app = mount(NotesHome, { target, props: { caseId: 'c1', rows, loading: false, templates: [], selected: [] } });
  flushSync();
  return target.textContent;
}

afterEach(() => {
  unmount(app);
  target.remove();
});

describe('the notes of the case under their heading', () => {
  it('says every note is a report when the reports above hold them all', () => {
    const said = home([row('case', 'Case notes'), row('n1', 'Front', { style: 'report' }), row('n2', 'Brief', { style: 'brief' })]);
    expect(said).toContain('Reports · 2');
    expect(said).toContain('Every note here is a report, listed above.');
    expect(said).not.toContain('No note yet');
  });

  it('shows the plain notes under it, with no such line', () => {
    const said = home([row('case', 'Case notes'), row('n1', 'Front', { style: 'report' }), row('n2', 'Lead')]);
    expect(said).not.toContain('Every note here is a report');
    expect(target.querySelector('[data-guide="notebook.cards"]')?.textContent).toContain('Lead');
  });

  it('still says there is no note yet in a case with none', () => {
    const said = home([row('case', 'Case notes')]);
    expect(said).toContain('No note yet');
    expect(said).not.toContain('Every note here is a report');
  });
});
