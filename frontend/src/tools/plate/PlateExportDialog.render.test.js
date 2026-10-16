// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlateExportDialog from './PlateExportDialog.svelte';

let held = null;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });
const settle = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); flushSync(); };
function show(props) {
  const onexport = vi.fn(async () => {});
  const onclose = vi.fn();
  held = mount(PlateExportDialog, { target: document.body, props: { onexport, onclose, ...props } });
  flushSync();
  return { onexport, onclose };
}
const radio = (value) => document.body.querySelector(`input[value="${value}"]`);
const go = () => [...document.body.querySelectorAll('.acts .btn-primary')][0];

describe('exporting a plate', () => {
  it('writes one page at print resolution by default, and offers no days without a tracked layer', async () => {
    const { onexport, onclose } = show({ moments: [] });
    expect(radio('mp4').disabled).toBe(true);
    expect(radio('sheet').disabled).toBe(true);
    go().click(); await settle();
    expect(onexport).toHaveBeenCalledWith({ format: 'png', quality: 'print', width: 1920, days: null, interval: 900,
      filename: 'Map plate', pixels: 0, transparent: false });
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('plays a plate\'s steps without a tracked layer, and says how long it runs', async () => {
    const runtime = vi.fn(() => 83);
    const { onexport } = show({ moments: [], stepped: true, runtime });
    expect(radio('mp4').disabled).toBe(false);
    expect(radio('sheet').disabled).toBe(true);
    radio('mp4').click(); flushSync();
    expect(document.body.querySelector('select[aria-label="First day"]')).toBeNull();
    expect(document.body.textContent).toContain('Runs 1:23');
    // an MP4 counts its transitions, a GIF has none
    expect(runtime).toHaveBeenLastCalledWith([], 900, 'mp4');
    go().click(); await settle();
    expect(onexport).toHaveBeenCalledWith(expect.objectContaining({ format: 'mp4', days: [] }));
  });

  it('plays the days between the two picked, at the width and pace asked', async () => {
    const { onexport } = show({ moments: ['2026-09-01', '2026-09-15', '2026-10-01', '2026-10-12'] });
    radio('mp4').click(); flushSync();
    const [first] = document.body.querySelectorAll('select');
    first.value = '2026-09-15'; first.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    expect(document.body.textContent).toContain('3 changes, one picture each');
    [...document.body.querySelectorAll('button')].find((node) => node.textContent.trim() === '1280 px').click(); flushSync();
    go().click(); await settle();
    expect(onexport).toHaveBeenCalledWith({ format: 'mp4', quality: 'print', width: 1280,
      days: ['2026-09-15', '2026-10-01', '2026-10-12'], interval: 900, filename: 'Map plate', pixels: 0, transparent: false });
  });

  it('names the file, sizes a PNG for a post, keeps its paper see-through and copies the page', async () => {
    const oncopy = vi.fn(async () => {});
    const { onexport } = show({ moments: [], name: 'Front, October', oncopy, preview: 'data:image/png;base64,AAAA' });
    expect(document.body.querySelector('img.preview')).not.toBeNull();
    const field = document.body.querySelector('input[aria-label="File name"]');
    expect(field.value).toBe('Front, October');
    field.value = 'Front for the post'; field.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    const size = document.body.querySelector('select[aria-label="Picture width"]');
    size.value = '1080'; size.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    // a width in pixels replaces the print resolution
    expect(document.body.querySelector('[aria-label="Resolution"]')).toBeNull();
    document.body.querySelector('.check input').click(); flushSync();
    [...document.body.querySelectorAll('.acts .btn')].find((node) => node.textContent.trim() === 'Copy image').click(); await settle();
    expect(oncopy).toHaveBeenCalledOnce();
    go().click(); await settle();
    expect(onexport).toHaveBeenCalledWith(expect.objectContaining({ format: 'png', filename: 'Front for the post', pixels: 1080, transparent: true }));
  });

  it('stays open when the export fails, so it can be tried again', async () => {
    const onexport = vi.fn(async () => { throw new Error('refused'); });
    const onclose = vi.fn();
    held = mount(PlateExportDialog, { target: document.body, props: { moments: [], onexport, onclose } });
    flushSync();
    go().click(); await settle();
    expect(onclose).not.toHaveBeenCalled();
    expect(go().disabled).toBe(false);
  });
});
