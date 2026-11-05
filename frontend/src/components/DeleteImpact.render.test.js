// @vitest-environment happy-dom
/**
 * The delete dialog, mounted, asking what its delete touches.
 *
 * The guard is in the timing as much as the words: the confirm button has to wait
 * for the answer, or a quick Enter deletes before the analyst sees what goes with it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const post = vi.fn();
vi.mock('../lib/api.js', () => ({ api: { post }, ApiError: Error }));

const { default: ConfirmDialog } = await import('./ConfirmDialog.svelte');

const live = [];

function open(props) {
  const target = document.createElement('div');
  document.body.append(target);
  live.push(mount(ConfirmDialog, { target, props: { title: 'Delete this media?', message: 'x', confirmLabel: 'Delete', oncancel: () => {}, ...props } }));
  flushSync();
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  flushSync();
}

const dialog = () => document.querySelector('[role="alertdialog"]');
const confirmButton = () => [...dialog().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete');

afterEach(() => {
  while (live.length) unmount(live.pop());
  document.body.innerHTML = '';
  post.mockReset();
});

describe('a delete that says what it touches', () => {
  it('holds the confirm button until the answer is in, then lists it', async () => {
    let answer;
    post.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    open({ impact: { caseId: 'c1', paths: ['media/a.png'] } });

    expect(post).toHaveBeenCalledWith('/api/cases/c1/delete-impact', {
      ids: [], paths: ['media/a.png'], named: [],
    });
    expect(dialog().textContent).toContain('Checking what else it touches');
    expect(confirmButton().disabled).toBe(true);

    answer({
      cascade: [{ id: 'w1', type: 'inspect-session', label: 'Clip work' }],
      tombstone: [{ id: 'p1', type: 'proof', label: 'Bridge strike' }],
      touched: [{ id: 'pl1', type: 'map-plate', label: 'Day 3', how: ['shows it'] }],
      counts: { cascade: 1, tombstone: 1, touched: 5 },
    });
    await settle();

    expect(confirmButton().disabled).toBe(false);
    const text = dialog().textContent;
    expect(text).toContain('Linked to 7 other items in the case.');
    // what goes with it reads as a warning; what stays does not
    const blocks = [...dialog().querySelectorAll('.conseq')];
    expect(blocks[0].classList.contains('danger')).toBe(true);
    expect(blocks[0].textContent).toContain('Clip work');
    expect(blocks[1].classList.contains('danger')).toBe(false);
    expect(text).toContain('Kept with a record of its missing source');
    expect(text).toContain('Bridge strike');
    expect(text).toContain('Day 3 · shows it');
    expect(text).toContain('and 4 more');
  });

  it('says so when nothing else uses it', async () => {
    post.mockResolvedValue({ cascade: [], tombstone: [], touched: [], counts: { cascade: 0, tombstone: 0, touched: 0 } });
    open({ impact: { caseId: 'c1', ids: ['e1', 'e2'] } });
    await settle();

    expect(dialog().textContent).toContain('Nothing else in the case uses them.');
    expect(confirmButton().disabled).toBe(false);
  });

  it('frees the button when the question fails, and says it could not look', async () => {
    post.mockRejectedValue(new Error('offline'));
    open({ impact: { caseId: 'c1', ids: ['e1'] } });
    await settle();

    expect(confirmButton().disabled).toBe(false);
    expect(dialog().textContent).not.toContain('Checking');
    expect(dialog().textContent).toContain('Could not check what else it touches.');
  });

  it('keeps the button off when the delete would be refused, and says by what', async () => {
    post.mockResolvedValue({
      blocking: [{ id: 'r1', type: 'analysis-follow-up', label: 'Weekly', how: ['watches it'] }],
      cascade: [], tombstone: [], touched: [],
      counts: { blocking: 1, cascade: 0, tombstone: 0, touched: 0 },
    });
    open({ impact: { caseId: 'c1', ids: ['area-1'] } });
    await settle();

    expect(dialog().textContent).toContain('Take it out of these first');
    expect(dialog().textContent).toContain('Weekly · watches it');
    expect(confirmButton().disabled).toBe(true);
  });

  it('asks nothing for a dialog that deletes nothing in the case', () => {
    open({});
    expect(post).not.toHaveBeenCalled();
    expect(confirmButton().disabled).toBe(false);
  });
});
