import { describe, expect, it } from 'vitest';
import {
  DIAGRAM_COLOURS, DIAGRAM_KINDS, addBox, addEvent, addLink, canStandUnder, categoriesOf, categoryChoices, changeBox, changeEvent,
  changeLink, colourFor, convertModel, diagramFence, fenceSource, moveItem, newModel, readDiagram, removeBox, removeEvent, removeLink,
  starterModel, withColours, writeDiagram,
} from './diagramText.js';

/**
 * A diagram's form writes plain Mermaid, line for line as below, and reads back exactly
 * what it wrote; Mermaid it could not have written is not read at all.
 */

const lines = (...all) => all.join('\n');

/** What a model reads back as, once written: the round trip a form relies on. */
function roundTrip(model) {
  const written = writeDiagram(model);
  const back = readDiagram(written);
  expect(back, written).not.toBeNull();
  expect(writeDiagram(back)).toBe(written);
  return back;
}

describe('the Mermaid each kind writes', () => {
  it('writes a flow: its boxes by shape, its links solid or dashed with their words', () => {
    expect(writeDiagram(starterModel('flow'))).toBe(lines(
      'flowchart LR',
      '  n1["What was seen"]',
      '  n2{"Can it be checked?"}',
      '  n3("Confirmed")',
      '  n4["Left open"]',
      '  n1 --> n2',
      '  n2 -->|"Yes"| n3',
      '  n2 -.->|"No"| n4',
    ));
  });

  it('writes a network: its kind said, a person shape, links without arrows, a category a class with its legend', () => {
    expect(writeDiagram(starterModel('network'))).toBe(lines(
      'flowchart LR',
      '  %% kind: network',
      '  n1@{ shape: person, label: "Account A" }',
      '  n2@{ shape: person, label: "Account B" }',
      '  n3("Channel")',
      '  n1 ---|"posts in"| n3',
      '  n2 ---|"posts in"| n3',
      '  n2 -.-|"reposts"| n1',
      '  classDef c1 fill:#dde9f8,stroke:#2a78d6,color:#202124',
      '  classDef c2 fill:#fce7df,stroke:#eb6834,color:#202124',
      '  class n1,n2 c1',
      '  class n3 c2',
      '  %% legend c1: Account',
      '  %% legend c2: Channel',
    ));
  });

  it('writes an organisation in the Book look: its title and theme up top, a plain line from each box to the one under it', () => {
    const starter = starterModel('org');
    const model = { ...starter, style: 'book', title: 'Who answers to whom', boxes: starter.boxes.map((one, at) => ({ ...one, category: at ? 'Units' : '' })) };
    expect(writeDiagram(model)).toBe(lines(
      '---',
      'title: "Who answers to whom"',
      'config:',
      '  theme: base',
      '  themeVariables:',
      '    background: "#efe6d3"',
      '    primaryColor: "#f7f1e3"',
      '    primaryBorderColor: "#57534a"',
      '    primaryTextColor: "#1d1d1b"',
      '    lineColor: "#3d3a33"',
      '    textColor: "#1d1d1b"',
      '    edgeLabelBackground: "#efe6d3"',
      '    fontFamily: "\\"Noto Serif\\", Georgia, \\"Times New Roman\\""',
      '---',
      'flowchart TD',
      '  %% kind: org',
      '  n1["Command"]',
      '  n2["Unit A"]',
      '  n3["Unit B"]',
      '  n4["Team"]',
      '  n1 --- n2',
      '  n1 --- n3',
      '  n2 --- n4',
      '  classDef c1 fill:#c8d0d4,stroke:#2a78d6,color:#1d1d1b',
      '  class n2,n3,n4 c1',
      '  %% legend c1: Units',
    ));
  });

  it('writes a timeline: one colour without phases, a day of two events on one line', () => {
    expect(writeDiagram(starterModel('timeline'))).toBe(lines(
      '---',
      'config:',
      '  theme: base',
      '  timeline:',
      '    disableMulticolor: true',
      '  themeVariables:',
      '    cScale0: "#2a78d6"',
      '    cScaleLabel0: "#ffffff"',
      '---',
      'timeline',
      '  1 Oct : First report',
      '  5 Oct : Offensive begins',
      '  15 Nov : Withdrawal',
    ));
    let model = starterModel('timeline');
    model = changeEvent(changeEvent(model, 'n1', { category: 'Before' }), 'n2', { category: 'The offensive' });
    model = changeEvent(addEvent(model).model, 'n4', { when: '15 Nov', text: 'Tour of the front' });
    expect(writeDiagram({ ...model, direction: 'TD', title: 'Two phases' })).toBe(lines(
      '---',
      'config:',
      '  theme: base',
      '  timeline:',
      '    disableMulticolor: false',
      '  themeVariables:',
      '    cScale0: "#2a78d6"',
      '    cScaleLabel0: "#ffffff"',
      '    cScale1: "#eb6834"',
      '    cScaleLabel1: "#ffffff"',
      '---',
      'timeline TD',
      '  title Two phases',
      '  section Before',
      '    1 Oct : First report',
      '  section The offensive',
      '    5 Oct : Offensive begins',
      '    15 Nov : Withdrawal : Tour of the front',
    ));
  });

  it('writes a mind map as a tree of indents, each branch its colour and the middle in the look’s ink', () => {
    expect(writeDiagram(starterModel('mindmap'))).toBe(lines(
      '---',
      'config:',
      '  theme: base',
      '  themeVariables:',
      '    git0: "#52514e"',
      '    gitBranchLabel0: "#ffffff"',
      '    cScale1: "#2a78d6"',
      '    cScaleLabel1: "#ffffff"',
      '    cScale2: "#eb6834"',
      '    cScaleLabel2: "#ffffff"',
      '    cScale3: "#1baf7a"',
      '    cScaleLabel3: "#ffffff"',
      '---',
      'mindmap',
      '  n1(("The question"))',
      '    n2["Who"]',
      '    n3["Where"]',
      '    n4["When"]',
    ));
  });

  it('writes a sequence in the Dark look: its people, a group a box of its colour, its messages in order', () => {
    let model = starterModel('sequence');
    model = changeBox(changeBox(model, 'n1', { category: 'Outside' }), 'n2', { category: 'Our team' });
    expect(writeDiagram({ ...model, style: 'dark' })).toBe(lines(
      '---',
      'config:',
      '  theme: base',
      '  themeVariables:',
      '    darkMode: true',
      '    background: "#12161b"',
      '    primaryColor: "#1e252d"',
      '    primaryBorderColor: "#8a929c"',
      '    primaryTextColor: "#e8ebef"',
      '    lineColor: "#b9c0c8"',
      '    textColor: "#e8ebef"',
      '    edgeLabelBackground: "#12161b"',
      '---',
      'sequenceDiagram',
      '  box rgba(42,120,214,0.24) Outside',
      '    actor n1 as Source',
      '  end',
      '  box rgba(235,104,52,0.24) Our team',
      '    actor n2 as Analyst',
      '  end',
      '  participant n3 as Editor',
      '  n1->>n2: Sends a video',
      '  n2->>n3: Geolocates it',
      '  n3-->>n2: Approves',
    ));
  });

  it('writes a legend switched off, and every shape of a flow', () => {
    const model = newModel('flow', {
      legend: false,
      boxes: ['box', 'round', 'diamond', 'cylinder', 'person'].map((shape, at) => ({ id: `n${at + 1}`, text: shape, shape, category: 'Side' })),
      links: [{ from: 'n1', to: 'n2', arrow: false }, { from: 'n2', to: 'n3', dashed: true, arrow: false }],
    });
    expect(writeDiagram(model)).toBe(lines(
      'flowchart LR',
      '  n1["box"]',
      '  n2("round")',
      '  n3{"diamond"}',
      '  n4[("cylinder")]',
      '  n5@{ shape: person, label: "person" }',
      '  n1 --- n2',
      '  n2 -.- n3',
      '  classDef c1 fill:#dde9f8,stroke:#2a78d6,color:#202124',
      '  class n1,n2,n3,n4,n5 c1',
      '  %% legend c1: Side',
      '  %% legend: off',
    ));
  });

  it('writes the whole fence, and reads what a fence holds', () => {
    const fence = diagramFence(starterModel('flow'));
    expect(fence.startsWith('```mermaid\nflowchart LR\n')).toBe(true);
    expect(fence.endsWith('\n```')).toBe(true);
    expect(fenceSource(fence)).toBe(writeDiagram(starterModel('flow')));
  });
});

describe('the round trip', () => {
  it('reads back every kind’s starter exactly, in every look', () => {
    for (const { kind } of DIAGRAM_KINDS) {
      for (const style of ['report', 'book', 'dark']) {
        const model = { ...starterModel(kind), style };
        const back = roundTrip(model);
        expect(back.kind).toBe(kind);
        expect(back.style).toBe(style);
        expect(back).toEqual(withColours(newModel(kind, model)));
      }
    }
  });

  it('reads back a flow’s words, shapes, categories, colours, links, direction and legend', () => {
    const model = newModel('flow', {
      title: 'The "withdrawal": <why>', direction: 'TD', legend: false,
      boxes: [
        { id: 'n1', text: 'Houthi gains\naround Taiz', category: 'Houthis' },
        { id: 'n2', text: 'Hold #7; or go?', shape: 'diamond', category: 'Government side' },
        { id: 'n3', text: 'An adviser', shape: 'person', category: 'Government side' },
        { id: 'n4', text: 'Say "it" & <more>', shape: 'cylinder' },
      ],
      links: [{ from: 'n1', to: 'n2', text: 'cuts supply' }, { from: 'n2', to: 'n3', dashed: true, arrow: false }],
      colours: { Houthis: '#e34948', 'Government side': '#1baf7a' },
    });
    const back = roundTrip(model);
    expect(back.title).toBe('The “withdrawal”: <why>');
    expect(back.direction).toBe('TD');
    expect(back.legend).toBe(false);
    expect(back.boxes.map((one) => one.text)).toEqual(['Houthi gains\naround Taiz', 'Hold #7; or go?', 'An adviser', 'Say “it” & <more>']);
    expect(back.boxes.map((one) => one.shape)).toEqual(['box', 'diamond', 'person', 'cylinder']);
    expect(back.boxes.map((one) => one.category)).toEqual(['Houthis', 'Government side', 'Government side', '']);
    expect(back.colours).toEqual({ Houthis: '#e34948', 'Government side': '#1baf7a' });
    expect(back.links).toEqual([
      { from: 'n1', to: 'n2', text: 'cuts supply', dashed: false, arrow: true },
      { from: 'n2', to: 'n3', text: '', dashed: true, arrow: false },
    ]);
  });

  it('keeps the characters Mermaid cannot hold as look-alikes, and reads them back as themselves', () => {
    const written = writeDiagram(newModel('flow', { boxes: [{ id: 'n1', text: 'a < b > c, #7; `x`' }] }));
    expect(written).toContain('n1["a \u2039 b \u203a c, #\u200b7; \u02cbx\u02cb"]');
    expect(readDiagram(written).boxes[0].text).toBe('a < b > c, #7; `x`');
    const sequence = newModel('sequence', { boxes: [{ id: 'n1', text: 'Pres; idency' }, { id: 'n2', text: '' }], links: [{ from: 'n1', to: 'n2', text: 'one; two' }] });
    const said = writeDiagram(sequence);
    // a `;` ends a sequence's line: a Greek question mark looks the same
    expect(said).toContain('participant n1 as Pres\u037e idency');
    expect(said).toContain('participant n2 as \u00a0');
    expect(said).toContain('n1->>n2: one\u037e two');
    expect(roundTrip(sequence).boxes.map((one) => one.text)).toEqual(['Pres; idency', '']);
    const timeline = newModel('timeline', { events: [{ id: 'n1', when: '14:30 #1', text: 'said: hello' }], title: 'T: x' });
    expect(writeDiagram(timeline)).toContain('14\ua78930 \uff031 : said\ua789 hello');
    const back = roundTrip(timeline);
    expect(back.events[0]).toMatchObject({ when: '14:30 #1', text: 'said: hello' });
    expect(back.title).toBe('T: x');
  });

  it('reads back an organisation’s tree, a mind map’s branches and their colours, a timeline’s phases', () => {
    const org = roundTrip(starterModel('org'));
    expect(org.boxes.map((one) => one.parent)).toEqual(['', 'n1', 'n1', 'n2']);
    const mind = roundTrip({ ...starterModel('mindmap'), colours: { Who: '#e34948' } });
    expect(mind.boxes.map((one) => [one.text, one.parent, one.shape])).toEqual([['The question', '', 'circle'], ['Who', 'n1', 'box'], ['Where', 'n1', 'box'], ['When', 'n1', 'box']]);
    expect(mind.colours.Who).toBe('#e34948');
    let timeline = changeEvent(starterModel('timeline'), 'n2', { category: 'The offensive' });
    timeline = changeEvent(timeline, 'n3', { category: 'The offensive' });
    // a phase is said where it starts: the event after it carries it on
    expect(roundTrip(timeline).events.map((one) => one.category)).toEqual(['', 'The offensive', '']);
  });
});

describe('Mermaid typed by hand', () => {
  it('reads a plain flowchart: boxes written in their links, ids as words', () => {
    const model = readDiagram('flowchart LR\n  A[Tip] --> B[Check]\n  B --> C[Confirmed]');
    expect(model.kind).toBe('flow');
    expect(model.boxes.map((one) => [one.id, one.text])).toEqual([['A', 'Tip'], ['B', 'Check'], ['C', 'Confirmed']]);
    expect(model.links).toHaveLength(2);
    expect(readDiagram('graph TD\n  A --- B\n  class A c1\n  classDef c1 fill:#ffffff,stroke:#2a78d6,color:#000000').boxes[0])
      .toMatchObject({ text: 'A', category: 'c1' });
    expect(readDiagram('sequenceDiagram\n  Alice->>Bob: Hello').boxes.map((one) => one.id)).toEqual(['Alice', 'Bob']);
    expect(readDiagram('mindmap\n  Root\n    A branch').boxes.map((one) => [one.text, one.parent])).toEqual([['Root', ''], ['A branch', 'n1']]);
  });

  it('does not read what it would not write, which then opens as its source', () => {
    for (const source of [
      'flowchart LR\n  subgraph Side\n  A --> B\n  end',
      'flowchart LR\n  A --> B\n  style A fill:#f00',
      'flowchart LR\n  A --> B --> C',
      'flowchart LR\n  A([Stadium]) --> B',
      'flowchart LR\n  A ==> B',
      'flowchart RL\n  A --> B',
      'flowchart LR\n  %% a note to myself\n  A --> B',
      '%%{init: {"theme": "dark"}}%%\nflowchart LR\n  A --> B',
      '---\nconfig:\n  layout: elk\n---\nflowchart LR\n  A[Tip] --> B[Confirmed]',
      'sequenceDiagram\n  Alice->>Bob: Hello\n  Note right of Bob: thinks',
      'sequenceDiagram\n  loop Every day\n  Alice->>Bob: Hello\n  end',
      'timeline\n  title A\n  section\n',
      'mindmap\n  Root\n  Another root',
      'xychart-beta\n  bar [1, 2]',
      'pie\n  "A" : 1',
      '',
    ]) expect(readDiagram(source), source).toBeNull();
  });
});

describe('the gestures', () => {
  it('adds a box with a new id, under the root of a tree, in the kind’s first shape', () => {
    const flow = addBox(starterModel('flow'));
    expect(flow.id).toBe('n5');
    expect(flow.model.boxes.at(-1)).toEqual({ id: 'n5', text: '', shape: 'box', category: '', parent: '' });
    expect(addBox(starterModel('org')).model.boxes.at(-1).parent).toBe('n1');
    expect(addBox(starterModel('network')).model.boxes.at(-1).shape).toBe('round');
    expect(addBox(newModel('mindmap')).model.boxes[0].shape).toBe('circle');
  });

  it('adds a link from the box before the last to the last, without an arrow in a network', () => {
    expect(addLink(starterModel('flow')).model.links.at(-1)).toEqual({ from: 'n3', to: 'n4', text: '', dashed: false, arrow: true });
    expect(addLink(starterModel('network')).model.links.at(-1).arrow).toBe(false);
    expect(addLink(newModel('flow')).index).toBe(-1);
  });

  it('takes a box out with its links; the boxes under it go under the one above, a mind map’s root passes to its first branch', () => {
    const flow = removeBox(starterModel('flow'), 'n2');
    expect(flow.boxes.map((one) => one.id)).toEqual(['n1', 'n3', 'n4']);
    expect(flow.links).toEqual([]);
    expect(removeBox(starterModel('org'), 'n2').boxes.find((one) => one.id === 'n4').parent).toBe('n1');
    const mind = removeBox(starterModel('mindmap'), 'n1');
    expect(mind.boxes.map((one) => [one.id, one.parent])).toEqual([['n2', ''], ['n3', 'n2'], ['n4', 'n2']]);
    expect(readDiagram(writeDiagram(mind))).not.toBeNull();
    expect(removeLink(starterModel('flow'), 0).links).toHaveLength(2);
    expect(removeEvent(starterModel('timeline'), 'n2').events.map((one) => one.id)).toEqual(['n1', 'n3']);
  });

  it('moves a row up or down, held at the ends', () => {
    const model = starterModel('flow');
    expect(moveItem(model, 'boxes', 1, -1).boxes.map((one) => one.id)).toEqual(['n2', 'n1', 'n3', 'n4']);
    expect(moveItem(model, 'boxes', 0, -1)).toBe(model);
    expect(moveItem(model, 'links', 2, 1)).toBe(model);
    expect(moveItem(model, 'links', 0, 1).links.map((one) => one.to)).toEqual(['n3', 'n2', 'n4']);
  });

  it('never puts a box under itself or one of its own', () => {
    const org = starterModel('org');
    expect(canStandUnder(org, 'n2', 'n4')).toBe(false);
    expect(canStandUnder(org, 'n2', 'n2')).toBe(false);
    expect(canStandUnder(org, 'n4', 'n3')).toBe(true);
  });

  it('changes one field of one box, one link, one event', () => {
    expect(changeBox(starterModel('flow'), 'n1', { text: '  New words  ' }).boxes[0].text).toBe('New words');
    expect(changeLink(starterModel('flow'), 0, { dashed: true }).links[0].dashed).toBe(true);
    expect(changeEvent(starterModel('timeline'), 'n1', { when: '2 Oct' }).events[0].when).toBe('2 Oct');
  });
});

describe('the colours', () => {
  const PALETTE = [{ name: 'Houthis', colour: '#C8231B' }, { name: 'Coalition', colour: '#0072b2' }];

  it('paints a category the case names in the case’s colour, else the next of the charts’ order the case does not use', () => {
    const model = newModel('flow', { boxes: [{ id: 'n1', category: 'houthis' }, { id: 'n2', category: 'Others' }] });
    expect(colourFor(model, 'houthis', PALETTE)).toBe('#c8231b');
    expect(colourFor(model, 'Others', PALETTE)).toBe(DIAGRAM_COLOURS[0]);
    expect(withColours(model, PALETTE).colours).toEqual({ houthis: '#c8231b', Others: '#2a78d6' });
    // a colour the diagram gave a category stays its own
    expect(withColours({ ...model, colours: { Others: '#000000', Gone: '#ffffff' } }, PALETTE).colours).toEqual({ houthis: '#c8231b', Others: '#000000' });
  });

  it('offers the diagram’s categories, then the case’s names', () => {
    const model = newModel('flow', { boxes: [{ id: 'n1', category: 'Houthis' }, { id: 'n2', category: 'Units' }] });
    expect(categoriesOf(model)).toEqual(['Houthis', 'Units']);
    expect(categoryChoices(model, PALETTE)).toEqual(['Houthis', 'Units', 'Coalition']);
  });
});

describe('another kind', () => {
  it('draws a flow as an organisation, each box under the first box a link reaches it from', () => {
    const org = convertModel(starterModel('flow'), 'org');
    expect(org.kind).toBe('org');
    expect(org.direction).toBe('TD');
    expect(org.boxes.map((one) => [one.id, one.parent])).toEqual([['n1', ''], ['n2', 'n1'], ['n3', 'n2'], ['n4', 'n2']]);
    expect(org.links).toEqual([]);
    const back = convertModel(org, 'network');
    expect(back.links.map((one) => [one.from, one.to, one.arrow])).toEqual([['n1', 'n2', false], ['n2', 'n3', false], ['n2', 'n4', false]]);
  });

  it('keeps a sequence’s people and messages as boxes and links, and a person a person', () => {
    const flow = convertModel(starterModel('sequence'), 'flow');
    expect(flow.boxes.map((one) => one.shape)).toEqual(['person', 'person', 'box']);
    expect(flow.links).toHaveLength(3);
    expect(convertModel(starterModel('flow'), 'sequence').boxes.map((one) => one.shape)).toEqual(['box', 'box', 'box', 'box']);
  });

  it('draws no timeline as another kind, and nothing else as a timeline', () => {
    expect(convertModel(starterModel('timeline'), 'flow')).toBeNull();
    expect(convertModel(starterModel('flow'), 'timeline')).toBeNull();
  });
});
