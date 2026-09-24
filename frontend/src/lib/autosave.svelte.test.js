import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosave } from './autosave.svelte.js';

/** A write the test finishes by hand, to hold one in flight. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createAutosave', () => {
  it('writes once, after the changes stop', async () => {
    const write = vi.fn(async () => {});
    const saver = createAutosave({ write, delay: 500 });

    saver.schedule();
    await vi.advanceTimersByTimeAsync(300);
    saver.schedule();
    await vi.advanceTimersByTimeAsync(300);
    expect(write).not.toHaveBeenCalled();
    expect(saver.state.status).toBe('pending');

    await vi.advanceTimersByTimeAsync(250);
    expect(write).toHaveBeenCalledTimes(1);
    expect(saver.state.status).toBe('saved');
  });

  it('never runs two writes at once, and writes a change made during one right after', async () => {
    const first = deferred();
    const write = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue();
    const saver = createAutosave({ write, delay: 100 });

    saver.schedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(saver.state.status).toBe('saving');
    saver.schedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(write).toHaveBeenCalledTimes(1);

    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('writes what is pending on flush, without waiting out the delay', async () => {
    const write = vi.fn(async () => {});
    const saver = createAutosave({ write, delay: 10_000 });

    saver.schedule();
    await saver.flush();

    expect(write).toHaveBeenCalledTimes(1);
    expect(saver.pending).toBe(false);
  });

  it('waits for a write in flight on flush', async () => {
    const running = deferred();
    const write = vi.fn(() => running.promise);
    const saver = createAutosave({ write, delay: 10 });
    saver.schedule();
    await vi.advanceTimersByTimeAsync(10);

    let flushed = false;
    saver.flush().then(() => (flushed = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(false);

    running.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('says a failed write failed, and tries again when asked', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue();
    const saver = createAutosave({ write, delay: 10 });

    saver.schedule();
    await vi.advanceTimersByTimeAsync(10);
    expect(saver.state.status).toBe('error');
    expect(saver.state.error).toBe('disk full');

    saver.schedule();
    await saver.flush();
    expect(saver.state.status).toBe('saved');
    expect(saver.state.error).toBe('');
  });

  it('forgets a pending write for a document being thrown away', async () => {
    const write = vi.fn(async () => {});
    const saver = createAutosave({ write, delay: 50 });

    saver.schedule();
    saver.cancel();
    await vi.advanceTimersByTimeAsync(100);
    await saver.flush();

    expect(write).not.toHaveBeenCalled();
    expect(saver.state.status).toBe('idle');
  });
});
