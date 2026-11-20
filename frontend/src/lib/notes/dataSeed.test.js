import { describe, expect, it } from 'vitest';
import { blankRows, chartSeed, infographicSeed, matchColumns, renamed } from './dataSeed.js';
import { columnsFor } from './editor/chartFormText.js';

const CHART = `::: chart
kind: timeline
title: The announcements
| When | What happened | Kind |
| --- | --- | --- |
| 5 Oct 2026 | Offensive opens | Claim |
| 9 Oct 2026 | The strait cleared | Claim |
:::`;

describe('a new sheet for a figure', () => {
  it('takes a chart’s own columns and rows, named after its title', () => {
    expect(chartSeed(CHART)).toEqual({
      title: 'The announcements', columns: ['When', 'What happened', 'Kind'],
      rows: [['5 Oct 2026', 'Offensive opens', 'Claim'], ['9 Oct 2026', 'The strait cleared', 'Claim']],
    });
  });

  it('gives a chart with no table the columns its kind reads, and no row', () => {
    expect(chartSeed('::: chart\nkind: timeline\n:::')).toEqual({ title: 'Chart data', columns: ['When', 'What happened', 'Kind'], rows: [] });
    expect(columnsFor('stacked bars')).toEqual(['Category', 'Split', 'Count']);
    expect(columnsFor('pictures')).toEqual(['Picture', '#', 'Words', 'Group', 'Grade']);
    expect(columnsFor('waffle')).toEqual(['Part', 'Count']);
    expect(columnsFor('nothing')).toEqual([]);
    expect(blankRows(['A', 'B'])).toEqual([['', ''], ['', ''], ['', '']]);
  });

  it('gives an infographic the rows its panels share, or else the columns they read', () => {
    const same = `:::: infographic\ntitle: Losses\n\n${CHART.replace('title: The announcements', 'title: One')}\n\n${CHART.replace('title: The announcements', 'title: Two').replace('| 9 Oct 2026 | The strait cleared | Claim |\n', '')}\n::::`;
    const seed = infographicSeed(same);
    expect(seed.title).toBe('Losses');
    expect(seed.rows).toHaveLength(2);
    const mixed = `:::: infographic\ntitle: Losses\n\n${CHART}\n\n::: chart\nkind: bars\n| Model | Count |\n| --- | ---: |\n| Cougar | 8 |\n:::\n::::`;
    expect(infographicSeed(mixed)).toEqual({ title: 'Losses', columns: ['When', 'What happened', 'Kind', 'Model', 'Count'], rows: [] });
  });

  it('matches pasted columns to the ones a figure reads, by a near name, and renames only those', () => {
    const matches = matchColumns(['When', 'What happened', 'Kind'], ['Date', 'what', 'Kind of claim', 'Link']);
    expect(matches).toEqual([{ want: 'When', from: '' }, { want: 'What happened', from: 'what' }, { want: 'Kind', from: 'Kind of claim' }]);
    matches[0] = { ...matches[0], from: 'Date' };
    expect(renamed(['Date', 'what', 'Kind of claim', 'Link'], matches)).toEqual(['When', 'What happened', 'Kind', 'Link']);
    // a paste naming every column already needs no match
    expect(matchColumns(['Model', 'Count'], ['model', 'count'])).toEqual([]);
  });
});
