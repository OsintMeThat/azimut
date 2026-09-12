import { describe, expect, it } from 'vitest';
import { GUIDE, guideFor, guideSection, readingSection } from './guide.js';
import { CASE_WORKSPACE, TOOL_LABELS, WORKSPACES } from './workspaces.js';

const RAIL_AND_CASE = [...WORKSPACES, CASE_WORKSPACE];

/** Every sentence the guide puts on screen, whichever shape holds it. */
const prose = () =>
  GUIDE.flatMap((section) => [
    section.lead,
    ...(section.points ?? []).flatMap((point) => [point.label, point.text]),
    ...(section.recipes ?? []).flatMap((recipe) => [
      recipe.title,
      recipe.lead,
      ...recipe.steps.map((step) => step.text),
    ]),
    ...(section.keymap ?? []).flatMap((group) => group.keys.map((key) => key.does)),
    ...(section.fixes ?? []).flatMap((fix) => [fix.symptom, fix.fix]),
  ]);

describe('the guide tracks the app rather than falling behind it', () => {
  it('has a section for every workspace an analyst can stand in', () => {
    for (const ws of RAIL_AND_CASE) {
      expect(guideSection(ws.id), `no guide section for the ${ws.id} workspace`).toBeTruthy();
    }
  });

  it('names every tool of those workspaces', () => {
    // the gate that matters: adding a tab to a workspace fails here until somebody
    // writes down what it is for, which is the only thing keeping this page true
    const documented = new Set(GUIDE.flatMap((section) => section.tools));
    for (const ws of RAIL_AND_CASE) {
      for (const tool of ws.tools) {
        expect(documented.has(tool), `${tool} is in the rail and not in the guide`).toBe(true);
      }
    }
  });

  it('claims no tool that is not in a workspace', () => {
    const real = new Set(RAIL_AND_CASE.flatMap((ws) => ws.tools));
    for (const section of GUIDE) {
      for (const tool of section.tools) {
        expect(real.has(tool), `the guide covers ${tool}, which no workspace holds`).toBe(true);
      }
    }
  });

  it('files each tool under one section, so the per-tool mark has one answer', () => {
    const seen = new Set();
    for (const section of GUIDE) {
      for (const tool of section.tools) {
        expect(seen.has(tool), `${tool} is covered twice`).toBe(false);
        seen.add(tool);
      }
    }
  });

  it('opens on the two sections that set up, before any workspace', () => {
    // orient, then install the one thing worth installing, then the pipeline
    expect(GUIDE.map((section) => section.id).slice(0, 2)).toEqual(['start', 'extension']);
    expect(GUIDE[0].tools).toEqual([]);
    expect(GUIDE[1].tools).toEqual([]);
  });

  it('carries its own mark where its id names no workspace', () => {
    // the contents list reads a workspace icon where there is one, so the two cannot
    // drift; a section standing alone has to bring one
    const ids = new Set(RAIL_AND_CASE.map((ws) => ws.id));
    for (const section of GUIDE.filter((entry) => !ids.has(entry.id))) {
      expect(section.icon, `${section.id} has no mark`).toBeTruthy();
    }
  });

  it('says to install the extension in the section somebody reads first', () => {
    // it is the one setup step that changes what the app can do, so it leads
    expect(GUIDE[0].points[0].label).toContain('extension');
  });

  it('reaches a section from a tool, which is how a toolbar mark will ask', () => {
    expect(guideFor('satellite')?.id).toBe('map');
    expect(guideFor('graph')?.id).toBe('case');
    expect(guideFor('settings')).toBe(null);
  });

  it('is a labelled tool everywhere it is named', () => {
    for (const section of GUIDE) {
      for (const tool of section.tools) {
        expect(TOOL_LABELS[tool], `${tool} has no label`).toBeTruthy();
      }
    }
  });
});

describe('the register the guide is written in', () => {
  it('leads every section with one sentence', () => {
    for (const section of GUIDE) {
      expect(section.lead.split('. ').length, `${section.id} leads with a paragraph`).toBeLessThan(3);
      expect(section.lead.endsWith('.')).toBe(true);
    }
  });

  it('gives every point a label and a body', () => {
    for (const section of GUIDE) {
      for (const point of section.points ?? []) {
        expect(point.label.trim()).toBeTruthy();
        expect(point.text.trim().endsWith('.')).toBe(true);
      }
    }
  });

  it('says something in every section, in one form or another', () => {
    // a section is points, or recipes, or keys, or fixes — never a heading and a lead
    for (const section of GUIDE) {
      const body =
        (section.points?.length ?? 0) +
        (section.recipes?.length ?? 0) +
        (section.keymap?.length ?? 0) +
        (section.fixes?.length ?? 0);
      expect(body, `${section.id} says nothing`).toBeGreaterThan(2);
    }
  });

  it('uses no em-dash appositive, which the house copy rules refuse', () => {
    for (const line of prose()) {
      expect(line, 'em-dash in UI copy').not.toMatch(/—/);
    }
  });

  it('says what a key does wherever it lists one', () => {
    for (const section of GUIDE) {
      for (const group of section.keymap ?? []) {
        expect(group.where.trim()).toBeTruthy();
        expect(group.keys.length).toBeGreaterThan(0);
        for (const key of group.keys) {
          expect(key.combo.trim()).toBeTruthy();
          expect(key.does.trim()).toBeTruthy();
        }
      }
    }
  });

  it('lists keys under a tool the app actually has, or under everywhere', () => {
    // the one gate that keeps this page from naming a tab that was renamed or removed
    const labels = new Set(Object.values(TOOL_LABELS));
    for (const section of GUIDE) {
      for (const group of section.keymap ?? []) {
        expect(group.where === 'Anywhere' || labels.has(group.where), group.where).toBe(true);
      }
    }
  });

  it('walks a recipe through tools that exist, in the words the tabs use', () => {
    const real = new Set([...RAIL_AND_CASE.flatMap((ws) => ws.tools)]);
    for (const section of GUIDE) {
      for (const recipe of section.recipes ?? []) {
        expect(recipe.steps.length, `${recipe.title} is not a walk`).toBeGreaterThan(2);
        for (const step of recipe.steps) {
          expect(real.has(step.tool), `${recipe.title} sends the reader to ${step.tool}`).toBe(true);
          expect(TOOL_LABELS[step.tool], `${step.tool} has no label`).toBeTruthy();
          expect(step.text.trim().endsWith('.')).toBe(true);
        }
      }
    }
  });

  it('answers every symptom it raises', () => {
    for (const section of GUIDE) {
      for (const fix of section.fixes ?? []) {
        expect(fix.symptom.trim()).toBeTruthy();
        expect(fix.fix.trim().endsWith('.')).toBe(true);
      }
    }
  });
});

describe('which section the reader is in', () => {
  // one column, four headings, the line 120px below the top of it
  const marks = [
    { id: 'start', top: -900 },
    { id: 'extension', top: -40 },
    { id: 'collect', top: 620 },
    { id: 'map', top: 1400 },
  ];
  const line = 120;

  it('is the last heading at or above the line, not the first one on screen', () => {
    // `collect` is visible and `extension` is the one being read
    expect(readingSection(marks, { line })).toBe('extension');
  });

  it('counts a heading exactly on the line as reached', () => {
    expect(readingSection([{ id: 'a', top: 0 }, { id: 'b', top: 120 }], { line })).toBe('b');
  });

  it('holds the first section while the column is still at the top', () => {
    expect(readingSection([{ id: 'a', top: 0 }, { id: 'b', top: 900 }], { line })).toBe('a');
  });

  it('gives the last section the bottom of the page', () => {
    // a short final section can never reach the line however far down you scroll, so
    // without this the list sticks one entry short at the end
    expect(readingSection(marks, { line, atBottom: true })).toBe('map');
  });

  it('answers nothing when there is nothing to measure', () => {
    expect(readingSection([], { line })).toBe(null);
    expect(readingSection(undefined)).toBe(null);
  });

  it('never answers with a section it was not given', () => {
    const ids = new Set(marks.map((mark) => mark.id));
    for (const spot of [-5000, -100, 0, 120, 5000]) {
      expect(ids.has(readingSection(marks, { line: spot }))).toBe(true);
    }
  });
});
