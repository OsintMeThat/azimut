import { describe, expect, it, vi } from 'vitest';
import { createNoteFrame } from './noteFrame.svelte.js';

const FRAME = { points: [[44.19, 15.37], [44.2, 15.36]], angle: 0 };

function tool() {
  const arm = vi.fn();
  const disarm = vi.fn();
  return { arm, disarm, frame: createNoteFrame({ arm, disarm }) };
}

describe('the frame tool armed for a note', () => {
  it('arms the tool and answers the frame drawn, which is the put’s alone', async () => {
    const { arm, disarm, frame } = tool();
    const asked = frame.ask();
    expect(arm).toHaveBeenCalledOnce();
    expect(frame.waiting).toBe(true);
    expect(frame.take(FRAME)).toBe(true);
    await expect(asked).resolves.toEqual(FRAME);
    expect(disarm).toHaveBeenCalledOnce();
    expect(frame.waiting).toBe(false);
    // a frame drawn for the export afterwards is the export's
    expect(frame.take(FRAME)).toBe(false);
  });

  it('is called off quietly by Escape or a click, by the put’s Cancel, and by another put', async () => {
    const { disarm, frame } = tool();
    const escaped = frame.ask();
    frame.drop();
    await expect(escaped).rejects.toMatchObject({ name: 'AbortError' });

    const controller = new AbortController();
    const cancelled = frame.ask({ signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError', message: 'No area was drawn' });
    expect(disarm).toHaveBeenCalledOnce();
    expect(frame.waiting).toBe(false);

    const first = frame.ask();
    const second = frame.ask();
    await expect(first).rejects.toMatchObject({ name: 'AbortError', message: 'Another area was asked for' });
    frame.take(FRAME);
    await expect(second).resolves.toEqual(FRAME);
  });

  it('leaves a later put alone when an earlier one’s signal aborts', async () => {
    const { frame } = tool();
    const earlier = new AbortController();
    const first = frame.ask({ signal: earlier.signal });
    const second = frame.ask();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    earlier.abort();
    expect(frame.waiting).toBe(true);
    frame.take(FRAME);
    await expect(second).resolves.toEqual(FRAME);
  });

  it('never arms for a put already cancelled', async () => {
    const { arm, frame } = tool();
    const controller = new AbortController();
    controller.abort();
    await expect(frame.ask({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(arm).not.toHaveBeenCalled();
    expect(frame.waiting).toBe(false);
  });
});
