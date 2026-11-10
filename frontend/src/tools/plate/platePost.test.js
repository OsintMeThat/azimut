import { describe, expect, it } from 'vitest';
import { POST_FORMATS, namedPlate, plateFiled, platePostAbout } from './platePost.js';

describe('what a plate files for its post', () => {
  it('names the plate, the day and step a page shows, and its credits', () => {
    expect(plateFiled({ name: 'Front', format: 'png', day: '2026-10-12', step: 's1', credits: 'Esri · Made with Azimut' }))
      .toEqual({ plate: 'Front', kind: 'page', day: '2026-10-12', step: 's1', attribution: 'Esri · Made with Azimut' });
  });

  it('files the days side by side as a sheet, and a played plate with no day of its own', () => {
    expect(plateFiled({ name: 'Front', format: 'sheet', day: '2026-10-12', step: 's1' })).toEqual({ plate: 'Front', kind: 'sheet' });
    expect(plateFiled({ name: 'Front', format: 'mp4', day: '2026-10-12', credits: 'Esri' })).toEqual({ plate: 'Front', attribution: 'Esri' });
    expect(plateFiled({ name: 'Front', format: 'gif' })).toEqual({ plate: 'Front' });
  });

  it('carries a picture or a video, never a PDF', () => {
    expect(POST_FORMATS).toEqual(['png', 'sheet', 'gif', 'mp4']);
  });
});

describe('what the post is told of the plate', () => {
  it('says the day a page shows, or the first and the last day played', () => {
    expect(platePostAbout({ title: 'Front, October', format: 'png', at: '2026-10-12', credits: ' Esri ' }))
      .toEqual({ title: 'Front, October', description: 'Front, October', dates: ['2026-10-12'], credits: 'Esri' });
    expect(platePostAbout({ title: 'Front', format: 'mp4', at: '2026-10-12', days: ['2026-09-01', '2026-09-15', '2026-10-01'] }).dates)
      .toEqual(['2026-09-01', '2026-10-01']);
    expect(platePostAbout({ title: 'Front', format: 'png', at: '' }).dates).toEqual([]);
  });

  it('opens the post\'s text with the plate\'s title only when the analyst named it', () => {
    expect(namedPlate('Kherson map', 'Kherson')).toBe(false);
    expect(namedPlate('Kherson map 2', 'Kherson')).toBe(false);
    expect(namedPlate('Map plate', '')).toBe(false);
    expect(namedPlate('Front line on 12 October', 'Kherson')).toBe(true);
    expect(namedPlate('', 'Kherson')).toBe(false);
    expect(platePostAbout({ title: 'Kherson map', caseName: 'Kherson', format: 'gif' }).description).toBe('');
  });
});
