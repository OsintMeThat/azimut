import { describe, expect, it, vi } from 'vitest';
import { SHEET_DAYS, faceCredits, figureName, pageOffer, sheetOffer, sheetRefusal } from './plateNote.js';

describe('a Map plate put in a note', () => {
  it('is named after the plate, then the day and the step it shows', () => {
    expect(figureName({ title: 'Port strike', day: '2026-03-02', step: 'Step 2' })).toBe('Port strike, 2 Mar 2026, Step 2');
    // an hour is written as a file name can carry it
    expect(figureName({ title: 'Port strike', day: '2026-03-02T10:00' })).toBe('Port strike, 2 Mar 2026 10h00');
    expect(figureName({ title: ' ' })).toBe('Map plate');
    expect(figureName({ title: 'Port strike', day: '2026-03-02', sheet: true })).toBe('Port strike, days side by side');
  });

  it('carries the credits its face prints, each once', () => {
    expect(faceCredits({ a: 'Esri, Maxar', b: 'Esri, Maxar', c: ' ' })).toBe('Esri, Maxar');
    expect(faceCredits({ a: 'Esri', b: 'OpenStreetMap' })).toBe('Esri · OpenStreetMap');
    // no credits box on the page: what the plate owes is still said
    expect(faceCredits({}, 'Esri, Maxar')).toBe('Esri, Maxar');
  });

  it('refuses a sheet of fewer than two days, or more than the sheet holds, in a sentence', () => {
    expect(sheetRefusal(1)).toMatch(/two days or more/);
    expect(sheetRefusal(SHEET_DAYS)).toBe('');
    expect(sheetRefusal(SHEET_DAYS + 1)).toBe(`A sheet holds ${SHEET_DAYS} days at most and this plate plays ${SHEET_DAYS + 1}. Skip some days first`);
  });

  it('files the page once and sizes it to the page of the note by its shape', async () => {
    const keep = vi.fn().mockResolvedValue({ entity: { id: 'e_page' }, label: 'Port strike, 2 Mar 2026', fresh: true, width: 3508, height: 2480 });
    const offer = pageOffer({ keep });
    expect(offer).toMatchObject({ id: 'plate-page', label: 'This page', picture: true });
    const signal = new AbortController().signal;
    expect(await offer.put({ signal })).toEqual({ text: '[[media:e_page|Port strike, 2 Mar 2026]]{width=100%}', filed: ['e_page'] });
    expect(keep).toHaveBeenCalledWith({ signal });
    // an upright page is kept within the height of the page: A4 upright is 1.41 tall, so it fits whole
    keep.mockResolvedValue({ entity: { id: 'e_tall' }, label: 'Story', fresh: false, width: 1080, height: 1920 });
    expect(await offer.put({})).toEqual({ text: '[[media:e_tall|Story]]{width=79%}', filed: [] });
  });

  it('files the days side by side at the page width, and cites one filed before without filing it again', async () => {
    const keep = vi.fn().mockResolvedValue({ entity: { id: 'e_sheet' }, label: 'Port strike, days side by side', fresh: false });
    const offer = sheetOffer({ keep });
    expect(offer).toMatchObject({ id: 'plate-sheet', picture: true });
    expect(await offer.put({})).toEqual({ text: '[[media:e_sheet|Port strike, days side by side]]{width=100%}', filed: [] });
  });

  it('refuses with a sentence when nothing was filed', async () => {
    await expect(pageOffer({ keep: async () => ({ entity: null }) }).put({})).rejects.toThrow('could not be filed');
    await expect(sheetOffer({ keep: async () => ({}) }).put({})).rejects.toThrow('could not be filed');
  });
});
