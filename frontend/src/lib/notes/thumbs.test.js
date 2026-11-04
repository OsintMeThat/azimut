import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./preview.js', () => ({ fetchPreview: vi.fn() }));
vi.mock('./pdfjs.js', () => ({ openPdf: vi.fn(), drawPage: vi.fn(), releaseCanvas: vi.fn() }));

const { forgetThumbs, templateThumb, thumbKey } = await import('./thumbs.js');

afterEach(() => forgetThumbs());

function tools() {
  const order = [];
  const destroy = vi.fn();
  return {
    order,
    destroy,
    fetch: vi.fn(async (request) => { order.push(`fetch ${request.title}`); return { data: new ArrayBuffer(4) }; }),
    open: vi.fn(async () => ({ destroy })),
    draw: vi.fn(async () => ({ id: 'canvas' })),
    toUrl: vi.fn(() => 'data:image/png;base64,AAAA'),
  };
}

describe('page 1 of a template, drawn small', () => {
  it('asks the server for the template filled in, as a template prints, and lets the PDF go', async () => {
    const options = tools();
    const url = await templateThumb({ name: 'Brief', body: '## {today}\n', look: { style: 'brief', cover: { image: 'm1' } } }, options);
    expect(url).toBe('data:image/png;base64,AAAA');
    const request = options.fetch.mock.calls[0][0];
    expect(request.title).toBe('Brief');
    expect(request.text).toMatch(/^## \d{4}-\d{2}-\d{2}\n$/);
    expect(request.look).toMatchObject({ style: 'brief', cover: { image: '' } });
    expect(options.draw.mock.calls[0][1]).toBe(0);
    expect(options.destroy).toHaveBeenCalled();
  });

  it('draws the same template once, and an edited one again', async () => {
    const options = tools();
    const template = { name: 'Brief', body: 'A', look: null };
    await Promise.all([templateThumb(template, options), templateThumb({ ...template }, options)]);
    expect(options.fetch).toHaveBeenCalledTimes(1);
    await templateThumb({ ...template, body: 'B' }, options);
    expect(options.fetch).toHaveBeenCalledTimes(2);
    expect(thumbKey(template)).toBe(thumbKey({ ...template, look: { style: 'plain' } }));
  });

  it('draws one at a time, in the order they were asked', async () => {
    const options = tools();
    let release;
    options.open.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ destroy: vi.fn() }); }));
    const first = templateThumb({ name: 'One', body: '' }, options);
    const second = templateThumb({ name: 'Two', body: '' }, options);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(options.order).toEqual(['fetch One']);
    release();
    await Promise.all([first, second]);
    expect(options.order).toEqual(['fetch One', 'fetch Two']);
  });

  it('tries a template that failed again, the next time it is seen', async () => {
    const options = tools();
    options.fetch.mockRejectedValueOnce(new Error('Azimut is not running.'));
    await expect(templateThumb({ name: 'X', body: '' }, options)).rejects.toThrow('not running');
    await expect(templateThumb({ name: 'X', body: '' }, options)).resolves.toMatch(/^data:/);
    expect(options.fetch).toHaveBeenCalledTimes(2);
  });
});
