// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn();
vi.mock('../lib/api.js', () => ({ api: { get } }));
vi.mock('../lib/state.svelte.js', () => ({ reloadCase: vi.fn(), toast: vi.fn() }));
vi.mock('../lib/navigate.js', () => ({ openInTimeline: vi.fn() }));

const { default: EntityTime } = await import('./EntityTime.svelte');

const VIDEO = { id: 'e_clip', type: 'media', label: 'clip', attrs: { path: 'media/clip.mp4', kind: 'video' } };
const claim = (id, extra = {}) => ({
  id: `temporal:claim:${id}`, owner_id: id, category: 'statement', kind: 'claim', label: `Material of ${id} was taken`,
  raw: '2025-10-24', earliest: '2025-10-24T00:00:00Z', latest: '2025-10-25T00:00:00Z', tz: null, time_role: 'observed',
  subjects: ['e_clip'], places: [], sources: [], ...extra,
});

let live = null;

async function show(items) {
  get.mockResolvedValue({ items, next_cursor: null });
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(EntityTime, { target, props: { caseId: 'case-a', entity: VIDEO } });
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  flushSync();
  return target;
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

describe('a date a proof states for moments of a video', () => {
  it('reads the moments before the date, and the whole video as the date alone', async () => {
    const target = await show([
      claim('bridge', { span: { path: 'media/clip.mp4', moments: [{ start: 130, end: 158 }] } }),
      claim('depot', { span: { path: 'media/clip.mp4', moments: [{ start: 30, end: 45 }, { start: 100, end: null }, { start: 190, end: 200 }] } }),
      claim('roundabout'),
    ]);

    const values = [...target.querySelectorAll('.time-value')];
    const date = values[2].textContent;
    expect(date).toContain('2025');
    expect(values.map((v) => v.textContent)).toEqual([`2:10–2:38 · ${date}`, `0:30–0:45 +2 · ${date}`, date]);
    // the hover says every moment, and the date as stated
    expect(values[1].title).toBe('0:30–0:45 · 1:40 · 3:10–3:20 · 2025-10-24');
    expect(values[2].title).toBe('2025-10-24');
  });
});
