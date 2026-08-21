import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./Graph.svelte', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../lib/graph.js', import.meta.url), 'utf8');
const viewport = readFileSync(new URL('../lib/graphViewport.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

describe('the graph answers what the table cannot', () => {
  it('opens on the whole case, not on a root to expand from', () => {
    // A case is a subject before it is a set of statements: a conflict followed
    // over months has no single node to start at. Expansion is the drill-down.
    expect(source).toContain('let root = $state(null)');
    expect(source).toContain("if (root) return ['/graph/neighborhood'");
    expect(source).toContain('Whole case');
  });

  it('reads the lenses and orderings from the server, keeping no copy', () => {
    expect(source).toContain("api.get('/api/cases/graph-lenses')");
    expect(source).not.toMatch(/const LENSES\s*=/);
  });

  it('says how much of the case it left out instead of presenting a slice', () => {
    // Counted over the drawing and stated against the case's own total, so a first
    // draw says what it is a part of rather than passing a slice off as the whole.
    expect(source).toContain('{nodes.length} of {payload.total}');
    expect(source).toContain('payload.truncated');
  });

  it('shows what nobody has connected, which no table column reports', () => {
    expect(source).toContain('payload.isolated');
    expect(source).toContain('unconnected');
  });
});

describe('the interaction', () => {
  it('fades the far context instead of hiding it, so selection keeps your place', () => {
    expect(source).toContain('const focused = $derived.by');
    expect(source).toContain('circle.opacity(isNear ? 1 : 0.16)');
    // Edges fade with the nodes rather than out: the shape of the rest of the case
    // is what keeps your place, and it is in the lines as much as in the dots.
    expect(source).toContain('faded ? 0.12 : 0.45');
  });

  it('fades on a selection only, never under a moving mouse', () => {
    // Hover restyling the whole case made the picture strobe, and left Escape
    // looking broken: the highlight stayed while the pointer sat on the node.
    expect(source).toMatch(/const lit = hovered \?\? selected/);
    expect(source).toMatch(/if \(!selected \|\| selected === root\) return null/);
  });

  it('does not grey out the hops an expansion was asked for', () => {
    // Asking for three hops and getting two of them greyed contradicts the
    // question, so the root of a neighbourhood never narrows its own view.
    expect(source).toContain('selected === root');
  });

  it('puts the cost of a click on the node before it is paid', () => {
    expect(source).toContain('Around this ({chosen.degree})');
    expect(source).toContain('connection{tip.degree === 1');
  });

  it('words the act that replaces the case apart from the act that grows it', () => {
    // Both were called expanding, in two surfaces that look alike, for opposite
    // acts: "Around this" swaps the case for one node's hops, expanding adds a
    // node's missing neighbours to the case already drawn.
    expect(source).toContain('Around this ({chosen.degree})');
    expect(source).toContain('Expand {away} more connection');
    expect(source).toContain('function focusOn(id)');
    expect(source).toContain('function expandNode(id)');
  });

  it('groups a node’s connections by what they say, biggest group first', () => {
    // Forty rows with "posted" written on twelve of them say less than one heading
    // that says twelve. What a node mostly is, is the first thing to say about it.
    expect(source).toContain('const neighbourGroups = $derived.by');
    expect(source).toMatch(/b\.rows\.length - a\.rows\.length \|\| a\.reading\.localeCompare/);
    expect(source).toContain('<span class="verb">{group.reading}</span>');
    expect(source).toContain('<em>{group.rows.length}</em>');
  });

  it('lists the first few of a group and asks before listing forty', () => {
    expect(source).toContain('const GROUP_ROWS = 8');
    expect(source).toContain('group.rows.slice(0, GROUP_ROWS)');
    expect(source).toContain('Show all {group.rows.length}');
    expect(source).toContain('!all && group.rows.length > GROUP_ROWS');
  });

  it('forgets which groups were unfolded when another node is read', () => {
    // How one node is being read now, not a setting about how nodes are read: the
    // next one would otherwise open half-unfolded on whichever verbs it shares.
    expect(source).toMatch(/let allOf = \$state\(\[\]\);\s*\$effect\(\(\) => \{\s*void selected;\s*allOf = \[\];/);
  });

  it('lights the edge a row stands for, since they are the same connection', () => {
    expect(source).toContain('onmouseenter={() => (hoveredLink = row.link.id)}');
    expect(source).toContain('onmouseleave={() => (hoveredLink = null)}');
    // Reachable by keyboard too: the panel is the way into a canvas without a mouse.
    expect(source).toContain('onfocus={() => (hoveredLink = row.link.id)}');
  });

  it('narrows to the one edge singled out, or the row answers with all of them', () => {
    // Selecting a node already lights every edge it has and writes every verb, so
    // pointing at one row lit nothing new. One edge under the pointer or the panel
    // now stands alone, which is the question the rows exist to answer.
    expect(source).toContain('const singled = Boolean(chosenLink || hoveredLink)');
    expect(source).toMatch(
      /: singled\s*\? picked\s*: Boolean\(lit && \(link\.from === lit \|\| link\.to === lit\)\)/,
    );
  });

  it('follows a connection without lurching the view at every step', () => {
    // The layout puts linked nodes next to each other, so the neighbour is usually
    // already on screen — and recentring on each one makes the drawing move under
    // the reading. A running search survives it: following is not answering it.
    expect(source).toContain('function followTo(id)');
    expect(source).toMatch(/selected = id;\s*if \(!inSight\(id\)\) bringUnderEye\(id\);/);
    expect(source).toContain('function inSight(id)');
    // The same row means whatever gesture is armed: it names the far end of a
    // question, steps a walk, or reads the neighbour. An armed gesture owns every way
    // of pointing at a node, or the keyboard is left out of it.
    expect(source).toContain('asking\n                  ? wayTo(row.entity.id)');
    expect(source).toContain(': followTo(row.entity.id)}');
  });

  it('states the connections the drawing does not hold, which the list cannot', () => {
    // The list is built from the edges on screen, so a node with forty connections
    // and three of them drawn read as a node with three.
    expect(source).toContain('{away} more not drawn');
    // The act itself is the switch in the row above, said once.
    expect(source).toContain('onclick={() => toggleAround(chosen.id)}');
    // And the empty state never claims nothing connects while something does.
    expect(source).toContain('{:else if !neighbours.length}');
  });

  it('counts what is missing over the links the drawing holds', () => {
    // A loop is dropped by the canvas and kept by the view, so counting off the
    // drawable set left a node reporting one missing connection for ever, under a
    // control no expansion could ever satisfy. The tally matches the server's, which
    // counts one row per end — so a loop is two on both sides. Counted over the drawn
    // links rather than the sent ones, so a fold shows up in the number.
    expect(source).toMatch(/const offScreen = \$derived\.by[\s\S]{0,900}?for \(const link of links\)/);
    expect(source).toContain('for (const end of [link.from, link.to]) held.set(end');
  });

  it('does not offer an expansion in a view whose read takes none', () => {
    // A neighbourhood is read one hop further; it sends no `expand`, so "Open" there
    // was a live control that could only appear to do nothing. The count still gets
    // said, with the reason it cannot be pressed.
    expect(source).toContain('{away} more, further than {hops} hop{hops === 1 ? \'\' : \'s\'}');
    expect(source).toContain('disabled={!away || Boolean(root)}');
  });

  it('pans from the empty space, not only from a node', () => {
    // The bug this guards: a draggable Konva group only drags where the pointer
    // hits one of its own shapes, so the empty space — most of a graph — did
    // nothing at all and the canvas could only be moved by grabbing a node.
    expect(source).not.toContain('draggable: true');
    expect(source).toContain('onpointerdown={onPointerDown}');
    expect(source).toContain('function onPointerMove');
    expect(source).toContain('DRAG_SLOP');
    // Neither a pan nor a node's own drag may also select.
    expect(source).toContain('if (dragged || arranged) return;');
  });

  it('zooms at the pointer, fits back and says where it is', () => {
    expect(source).toContain('function onWheel');
    expect(source).toContain('stage?.getPointerPosition()');
    expect(source).toContain('function fitView');
    expect(source).toContain('{Math.round(zoom * 100)}%');
  });

  it('clamps the zoom so a case cannot be lost off-screen', () => {
    // The bound and the anchored zoom live in `lib/graphViewport.js`, which is
    // where they are exercised (`graphViewport.test.js`); the tool only calls them.
    expect(viewport).toContain('export const ZOOM_MIN');
    expect(viewport).toContain('export const ZOOM_MAX');
    expect(viewport).toContain('Math.min(ZOOM_MAX, Math.max(ZOOM_MIN');
    expect(source).toContain("from '../lib/graphViewport.js'");
    expect(source).toContain('zoomAround(factor,');
  });

  it('gives the whole screen to the drawing, toolbar included', () => {
    // The tool element, not the canvas: full screen without the toolbar is a picture
    // that can no longer be steered. The canvas is measured with `bind:clientWidth`,
    // so the stage follows the new size on its own.
    expect(source).toContain('<div class="graph-tool" bind:this={toolElement}>');
    expect(source).toContain('await toolElement.requestFullscreen()');
    expect(source).toContain('await document.exitFullscreen()');
    expect(source).toContain("fullscreen ? 'Exit full screen' : 'Full screen'");
    // Esc leaves it without telling us, so the flag is read back off the document.
    expect(source).toContain('fullscreen = document.fullscreenElement === toolElement');
    expect(source).toContain(".addEventListener('fullscreenchange', changed)");
    expect(source).toContain('.graph-tool:fullscreen');
  });

  it('reaches the same actions from the keyboard as from the canvas', () => {
    expect(source).toContain('onkeydown={onKey}');
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain("event.key === '0'");
  });

  it('clears the hover with the selection, so Escape leaves nothing lit', () => {
    // Shallowest thing first: the search, the handful, the edge, the hiding, then
    // the selection.
    expect(source).toMatch(
      /else if \(find\) find = '';[\s\S]{0,600}?else if \(selected\) selected = null;\s*hovered = null;\s*tip = null;/,
    );
  });

  it('leaves the keys of a field being typed into alone', () => {
    // Without this, naming a node "0" fits the view and an arrow key moves the
    // case instead of the text cursor. Escape still reaches the field, because
    // leaving it is what Escape is for there.
    expect(source).toContain('INPUT|TEXTAREA|SELECT');
    expect(source).toContain('if (typing) return;');
  });

  it('names the few busiest nodes at any zoom, since that is the question', () => {
    // A wide view of unnamed dots answers "what sits at the centre of this case"
    // only as a shape. Six, because labels are held at a fixed size on screen.
    expect(source).toContain('const hubs = $derived.by');
    expect(source).toContain('hubs.has(id)');
    expect(source).toContain('ranked.slice(0, 6)');
  });

  it('does not repeat a card in a tooltip over it', () => {
    expect(source).toContain('if (named) return;');
    expect(source).toContain("answerTo(card.findOne('.bg'), data, { named: true, moves: card })");
  });

  it('offers the ordering only when the case is too large to draw whole', () => {
    // It picks which nodes survive the cut, and nothing else: on a case that fits
    // it changed nothing on screen and read as a sort order.
    expect(source).toContain('{:else if payload?.truncated}');
  });

  it('finds a node by name, since a canvas has no keyboard path into it', () => {
    // Also the only practical way to a particular entity once a case is drawn at
    // a few hundred nodes: hunting one by eye does not work.
    expect(source).toContain("aria-label=\"Find a node\"");
    expect(source).toContain('function jumpTo');
    expect(source).toContain('a.degree'); // matches ranked most-connected first
  });

  it('searches the case, not the picture of it', () => {
    // A view is bounded, so on a case larger than the budget most of it is not on
    // screen — and a search reading only the drawing answered "no such entity" for
    // entities the case plainly holds. Nothing told "not in the case" from "not in
    // this picture", which is the worse of the two silences.
    expect(source).toContain('let elsewhere = $state([])');
    expect(source).toContain('buildCatalogQuery(caseId, { query: term, limit: 12 })');
    // The narrowing is ignored on purpose, as `expand` already ignores it.
    expect(source).not.toMatch(/buildCatalogQuery\([^)]*pickFolder/);
  });

  it('lights what a typed name matches instead of removing what it does not', () => {
    // Removing the rest takes the shape with it, and the shape is what the analyst
    // is holding their place with. Dimming answers the same question and keeps it.
    expect(source).toContain('const found = $derived.by');
    expect(source).toContain('const matched = found.has(id)');
    expect(source).toMatch(/isSelected \|\| id === hovered \|\| matched\s*\? colours\.accent/);
  });

  it('lights every match, not only the eight the list can hold', () => {
    // The count over the drawing states one number and the drawing has to show it:
    // lighting eight of twenty-three answers a different question from the one
    // written above it. The cap belongs to the dropdown, which is a handful to pick
    // from rather than a reading of the case.
    expect(source).toMatch(/const found = \$derived\.by[\s\S]{0,420}?hit\.add\(node\.id\)/);
    expect(source).not.toMatch(/const found = \$derived\.by[\s\S]{0,420}?slice\(0, 8\)/);
    expect(source).toMatch(/const matches = \$derived\.by[\s\S]{0,600}?slice\(0, 8\)/);
  });

  it('lights an edge only when both of its ends match', () => {
    // An edge with one end in the answer joins the answer to something else, which
    // is a statement about the case the search did not make.
    expect(source).toContain('near && !(near.has(link.from) && near.has(link.to))');
  });

  it('narrows the picture from one question at a time, the latest asked', () => {
    // Typing a name while a node was selected composited two fades over each other:
    // not a third reading, an unreadable one. A search outranks the selection, which
    // still rings its node and opens its panel — what a click is actually for.
    expect(source).toMatch(
      /if \(found\.size\) return found;\s*if \(singled\) return singled;\s*return focused;\s*\}\);/,
    );
    expect(source).toContain('const near = narrowing;');
  });

  it('counts the matches over the drawing, which is not the case', () => {
    // "No match drawn" and "no such entity" are different answers, and the second
    // one is the list's to give: it asks the catalog rather than the picture.
    expect(source).toContain('no match drawn');
    expect(source).toContain("{found.size} match{found.size === 1 ? '' : 'es'}");
    expect(source).toContain('{#if find.trim()}');
  });

  it('narrows without moving anything, so the shape survives the typing', () => {
    // The layout is derived from the nodes, so a search that filtered them would
    // re-run the relaxation and slide the whole case under the letters being typed.
    expect(source).toMatch(/void find;/);
    expect(source).not.toMatch(/nodes\.filter\([^)]*\)\s*,\s*mode/);
  });

  it('puts the list away when the case is pressed, keeping what is lit', () => {
    // The list is a panel over the answer now that the typing lights the drawing:
    // every click that follows a search lands under it. Pressing the case puts it
    // away without giving the search up, and the field asks for it back.
    expect(source).toContain('let listing = $state(true)');
    expect(source).toContain('{#if listing && (matches.length || elsewhere.length)}');
    expect(source).toMatch(/function onPointerDown\(event\) \{[\s\S]{0,200}?listing = false;/);
    expect(source).toContain('onfocus={() => (listing = true)}');
    expect(source).toContain('oninput={() => (listing = true)}');
  });

  it('brings a found entity into the picture through the one mechanism for it', () => {
    // `expand` keeps the named node whatever the ranking and the filters would have
    // done with it, and brings what touches it: an entity alone in a picture about
    // connections says nothing.
    expect(source).toContain('function bringIn(entity)');
    expect(source).toMatch(/bringing = id;[\s\S]{0,240}if \(!expanded\.includes\(id\)\) expanded = \[/);
    // And a name typed outranks a removal made earlier, or the case answers the search
    // with the same unchanged picture that removal left.
    expect(source).toMatch(/function bringIn[\s\S]{0,700}backIn\(\[id\]\)/);
    expect(source).toContain('function settleArrival()');
    expect(source).toContain('requestAnimationFrame(() => jumpTo(id))');
  });

  it('refuses a name this reading does not draw before asking the case', () => {
    // A lens is the one narrowing a name cannot outrank. Asked anyway, the case would
    // answer with an unchanged picture and the sentence would blame the budget for a
    // refusal the reading made.
    expect(source).toContain("if (lensHides.includes(type))");
    expect(source).toContain("say('Not drawn in this lens. My work draws it.')");
    // And the row says it before it is pressed, rather than offering an act that
    // cannot land.
    expect(source).toContain("{filed ? 'in My work' : 'bring in'}");
  });

  it('says so when the budget kept the entity out rather than staying silent', () => {
    expect(source).toContain("say('That one did not fit in the view.");
  });

  it('asks the case once a name is typed, not once a letter is', () => {
    expect(source).toContain('FIND_AFTER');
    expect(source).toContain('FIND_MIN');
    expect(source).toContain('return () => clearTimeout(timer)');
    // A later keystroke owns the field, so a slow answer never overwrites a newer one.
    expect(source).toContain('run !== lookupRun');
    expect(source).toContain('caseState.current?.id !== caseId');
    expect(source).toContain('term !== find.trim()');
  });

  it('offers nothing to bring in from a neighbourhood, which takes no expansion', () => {
    expect(source).toContain('if (!cid || root || term.length < FIND_MIN)');
  });

  it('keeps the zoom when it jumps, so finding does not lose the view', () => {
    expect(source).toContain('const scale = group.scaleX()');
    expect(source).toContain('width / 2 - spot.x * scale');
  });

  it('declutters labels by zoom, keeping the one in hand and its neighbours named', () => {
    // A selection is read as a sentence, and an unnamed neighbour cannot be read.
    expect(source).toContain('LABEL_SCALE');
    expect(source).toMatch(
      /const named =\s*isSelected \|\| id === hovered \|\| Boolean\(near\) \|\| hubs\.has\(id\) \|\| scale >= LABEL_SCALE/,
    );
  });

  it('restyles a selection without rebuilding, so panning survives a click', () => {
    // A rebuild would reset the transform and throw the view back to the start
    // every time a node was picked.
    expect(source).toContain('function restyle()');
    expect(source).toContain('function rebuild()');
    expect(source).toMatch(/void selected;\s*void hovered;[\s\S]{0,1600}?untrack\(restyle\);/);
  });

  it('keeps the drawing effects from tracking what they draw', () => {
    // The teleport this guards: `rebuild` ends in `restyle`, which reads the
    // selection — so the rebuild effect tracked hover, and every mouseover threw
    // the view back to its starting transform.
    expect(source).toContain("import { tick, untrack } from 'svelte'");
    expect(source).toMatch(/void height;\s*untrack\(rebuild\);/);
  });

  it('keeps where the analyst had panned to across a rebuild', () => {
    expect(source).toContain('const keep = group && !resetView');
    expect(source).toContain('group.position({ x: keep.x, y: keep.y })');
  });
});

describe('the focus is locked, sized, and walked back out of', () => {
  it('sizes the focus rather than fixing it at one hop', () => {
    // One hop answers "what touches this". Two answers "what does this sit
    // between", which is the shape a click could never show.
    expect(source).toContain('let focusHops = $state(1)');
    expect(source).toContain('return ringsAround(edges, selected, focusHops)');
  });

  it('walks the edges already drawn, so a wider reach owes no read', () => {
    // The second and third rings are in the payload already. Asking the case for
    // them would make a highlight cost a round trip, and would let the fade claim
    // a connection the drawing cannot show.
    expect(source).toContain('ringsAround(edges');
    expect(source).not.toMatch(/focusHops[^\n]*\/graph/);
    expect(layout).toContain('export function ringsAround');
  });

  it('offers the reach on the keys beside the one that fits the case', () => {
    expect(source).toMatch(/event\.key === '1' \|\| event\.key === '2' \|\| event\.key === '3'/);
    expect(source).toContain('setFocusHops(Number(event.key))');
    // Under the guard that gives a field being typed into its own keys, or naming a
    // node "2" would resize the focus instead of moving the cursor.
    expect(source.indexOf('if (typing) return;')).toBeLessThan(
      source.indexOf('setFocusHops(Number(event.key))'),
    );
  });

  it('does nothing with the reach keys when nothing is focused', () => {
    expect(source).toMatch(/function setFocusHops\(count\) \{\s*if \(!focused \|\| focusHops === count\) return;/);
  });

  it('keeps the reach across a change of node, and drops it with the focus', () => {
    // How far you are looking is a stance, not a property of what you clicked.
    expect(source).not.toMatch(/selected = id;\s*focusHops = 1/);
    expect(source).toMatch(/if \(selected\) return;[\s\S]{0,200}focusHops = 1;/);
  });

  it('hides rather than dims once the subset is what is being worked on', () => {
    expect(source).toContain('let onlyThis = $state(false)');
    expect(source).toContain(
      'const hiding = $derived(onlyThis && !tracing && !found.size && !singling ? focused : null)',
    );
    expect(source).toContain('const drawn = !hiding || hiding.has(id)');
    expect(source).toContain('circle.visible(drawn && !carded)');
  });

  it('lets a search outrank the hiding, as it outranks the fade', () => {
    // Hiding everything outside the matches strands them: an edge needs both ends,
    // so the answer to a search would have been a scatter of unconnected dots.
    expect(source).toContain('onlyThis && !tracing && !found.size');
  });

  it('drops an edge whose far end is off the screen', () => {
    expect(source).toContain('if (hiding && !(hiding.has(link.from) && hiding.has(link.to)))');
  });

  it('takes the annotations off a hidden node instead of painting over them', () => {
    // A glyph or a pin mark left drawn is the tell that a node was removed by
    // opacity rather than by being left out.
    expect(source).toContain('styleGlyph(entry, data, { scale, carded, isNear, drawn })');
    expect(source).toContain('marked: drawn && isNear && marked.has(id)');
    expect(source).toContain('inHand: drawn && isNear && inHand.has(id)');
    expect(source).toMatch(/if \(!carded \|\| !drawn\) \{/);
    expect(source).toContain('label.visible(drawn && !carded');
  });

  it('refuses a connection landed on a node that is not on screen', () => {
    expect(source).toContain('const landable = over && (!hiding || hiding.has(over))');
  });

  it('never touches the nodes, so switching back puts the case where it was', () => {
    // `placed` is derived from `arrange`: filtering the list would re-run the
    // relaxation and give every surviving node a new resting place.
    expect(source).not.toMatch(/arrange\(\s*nodes\.filter/);
    expect(source).toContain('void onlyThis;');
    expect(source).toContain('beforeOnly = { x: group.x(), y: group.y(), scale: group.scaleX() }');
    expect(source).toMatch(/function letGoOnly\(\)[\s\S]{0,300}zoom = beforeOnly\.scale;/);
  });

  it('frames the subset when it is asked for and when its size changes', () => {
    expect(source).toMatch(/function frameOnly\(\)[\s\S]{0,200}placed\.filter\(\(node\) => focused\.has\(node\.id\)\)/);
    expect(source).toMatch(/focusHops = count;\s*if \(onlyThis\) frameOnly\(\);/);
  });

  it('does not reframe on every step of a walk', () => {
    // A view that jumps on each click is the lurch `followTo` exists to avoid.
    expect(source).toMatch(/function followTo\(id\) \{\s*selected = id;\s*if \(!inSight\(id\)\) bringUnderEye\(id\);\s*\}/);
  });

  it('gives the case back before it gives the node up', () => {
    expect(source).toMatch(/else if \(chosenLink\) chosenLink = null;[\s\S]{0,300}else if \(onlyThis\) letGoOnly\(\);\s*else if \(selected\) selected = null;/);
  });

  it('takes the unconnected park off a picture of what one node reaches', () => {
    expect(source).toContain('tray?.visible(!hiding)');
    expect(source).toContain('caption?.visible(!hiding)');
  });

  it('keeps no history of what was clicked, which was never a path', () => {
    // A breadcrumb strip was built here and removed: it recorded every selection,
    // and a selection arrives from a search, a canvas click or a bring-in as readily
    // as from a connection followed. Chevrons between its labels claimed an
    // adjacency nothing guaranteed, which in a tool whose whole grammar is "an edge
    // is a statement" is a picture asserting what the case does not say. Walking a
    // path is now a gesture that can only step along an edge.
    expect(source).not.toContain('trail');
    expect(source).not.toContain('crumb');
  });

  it('says what the focus is on, and never on the root of a neighbourhood', () => {
    expect(source).toContain('{:else if focused && chosen}');
    expect(source).toContain('Only this');
    expect(source).toContain('aria-pressed={focusHops === step}');
  });
});

describe('a path is walked, not remembered', () => {
  it('records the edge arrived by, not only the node arrived at', () => {
    // Two nodes joined by `posted` and by `mentions` are two different findings, and
    // a path kept as nodes alone cannot tell them apart when both edges exist.
    expect(source).toContain('let path = $state([])');
    expect(source).toContain('path = [...path, { id, via: link.id }]');
    expect(source).toContain('new Set(path.map((step) => step.via).filter(Boolean))');
  });

  it('is an armed gesture, so no click can wander into it', () => {
    // Unarmed, a click on a non-neighbour has only bad answers: ignore it, read the
    // node and leave a half-path beside it, or break six hops on a slip.
    expect(source).toContain('let tracing = $state(false)');
    expect(source).toContain('Walk by hand');
    expect(source).toMatch(/if \(tracing\) \{\s*stepTo\(data\.id\);\s*return;\s*\}/);
  });

  it('asks the case for a route by naming two nodes', () => {
    // The common question, and the one the tool existed without. Armed like a
    // connection: the act is named, then the click that follows means that act.
    expect(source).toContain('let asking = $state(null)');
    expect(source).toContain('function askWayFrom(id)');
    expect(source).toContain('Path to…');
    expect(source).toMatch(/if \(asking\) \{\s*wayTo\(data\.id\);\s*return;\s*\}/);
  });

  it('takes the far end from a name too, since it is often not drawn', () => {
    // The view holds five hundred nodes of a thousand, and "are these two connected"
    // is asked about things far enough apart to be off screen. A node that cannot be
    // clicked would otherwise be a node that cannot be asked about.
    expect(source).toMatch(/function jumpTo\(id\) \{[\s\S]{0,600}if \(asking\) \{\s*wayTo\(id\);/);
  });

  it('takes a connection target from Find, which is the keyboard way into the canvas', () => {
    expect(source).toMatch(
      /function jumpTo\(id\) \{[\s\S]{0,500}if \(drawing\) \{[\s\S]{0,120}landOn\(id\);/,
    );
  });

  it('dims nothing while the question waits, unlike a connection', () => {
    // A relation has a vocabulary that rules a pair out before the press. A route has
    // none: the case is searched, not the drawing, so a node with no route on screen
    // may be two hops away in the case. Greying it would be the picture asserting
    // what only the server can know.
    //
    // The narrowing has to be *dropped*, not merely left unset: the question is armed
    // on a selected node, so without this the focus fade stays on and the drawing
    // says "only these five can be pressed" over a strip that says click anything.
    // The first version of this test asserted the absence of a dim keyed on `asking`,
    // which was true of code that had the defect.
    expect(source).toMatch(/const narrowing = \$derived\.by[\s\S]{0,600}if \(asking\) return null;/);
    expect(source).toContain('within ${body.searched} hops');
  });

  it('lights every route that tied for shortest, and reads one of them', () => {
    // Two accounts reaching the same place through two different sources is what
    // independence looks like, and an answer that drew one would hide the finding.
    expect(source).toContain('let routes = $state([])');
    expect(source).toContain('new Set(routes.flatMap((route) => route.links))');
    expect(source).toContain('new Set(routes.flatMap((route) => route.nodes))');
    expect(source).toContain('{routeAt + 1} / {routes.length}');
    expect(source).toContain('function readRoute(index)');
  });

  it('leaves the answer behind when a step is taken by hand', () => {
    // The tied routes were the reply to one question; stepping asks a different one.
    expect(source).toMatch(/function stepTo\(id\) \{[\s\S]{0,200}routes = \[\];/);
  });

  it('gives an armed question up before a route already drawn', () => {
    expect(source).toMatch(
      /else if \(asking\) asking = null;[\s\S]{0,300}else if \(tracing\) traceStop\(\);/,
    );
  });

  it('offers both ways to fill a path where a node’s acts are named', () => {
    expect(source).toContain('chose(askWayFrom)');
    expect(source).toContain('chose(traceFrom)');
  });

  it('lights what the walk can reach before the click, as the connection does', () => {
    expect(source).toMatch(/const nextSteps = \$derived\.by/);
    expect(source).toContain('if (!far || pathIds.has(far) || steps.has(far)) continue');
    // The offered steps keep full strength: a walk whose choices were dimmed into
    // the context is a walk taken blind.
    expect(source).toContain('if (tracing) return new Set([...pathIds, ...nextSteps.keys()])');
  });

  it('outranks the search and the focus, being the latest question asked', () => {
    expect(source).toMatch(
      /if \(tracing\) return new Set[\s\S]{0,120}if \(found\.size\) return found;\s*if \(singled\) return singled;\s*return focused;/,
    );
    // And the hiding stands down, since its subset is not what is being asked about.
    expect(source).toContain('onlyThis && !tracing && !found.size');
  });

  it('walks back onto a step already taken instead of looping through it', () => {
    // A route that visits a node twice is not a path, so the same click truncates.
    expect(source).toContain('const back = path.findIndex((step) => step.id === id)');
    expect(source).toContain('path = path.slice(0, back + 1)');
  });

  it('gives the walk up whole, as a half-drawn relation is given up', () => {
    expect(source).toMatch(/else if \(tracing\) traceStop\(\);\s*else if \(find\) find = '';/);
    expect(source).toMatch(/function traceStop\(\) \{\s*tracing = false;\s*path = \[\];/);
  });

  it('tells a path edge apart by its stroke, not by its colour', () => {
    // A graph that reaches a report gets printed, and a printed graph is grey. Every
    // free hue is spoken for anyway: the families own the palette, accent is the
    // selection, and blue is the actor family.
    expect(source).toContain('? style.width + 3');
    expect(source).toContain('arrow.dash(onPath ? []');
    expect(css).not.toMatch(/--graph-path/);
  });

  it('tells a step taken apart from a step offered', () => {
    expect(source).toContain('const stepped = tracing && pathIds.has(id)');
    expect(source).toContain('const offered = tracing && nextSteps.has(id)');
    expect(source).toMatch(/stepped \? 3\.6 : offered \? 2 :/);
  });

  it('reads the path as a sentence, in the direction the case states it', () => {
    // A drawing says these are joined; a sentence says what the joining is, and an
    // account that posted a video is not a video that mentions an account.
    expect(source).toContain('const sentence = $derived.by');
    // Every step reads forwards, in the order it was walked: an edge crossed against
    // its arrow takes the registry's inverse wording, exactly as the node panel does.
    // Writing the plain verb with a reversed arrow made a true sentence unreadable —
    // "A <- made from B <- made from C" has to be walked backwards to be understood.
    expect(source).toContain("relationReading(link.type, forward ? 'out' : 'in')");
    expect(source).toContain('const forward = link ? link.from === path[index - 1].id : true');
  });

  it('stores nothing, because a stored path goes false in silence', () => {
    // Its edges can be deleted. What gets kept is the sentence, in a note, written
    // by a person — and if a path is ever saved it will be the question rather than
    // the answer, recomputed on open.
    expect(source).not.toMatch(/api\.(post|put|patch)\([^)]*path/i);
    expect(source).not.toMatch(/localStorage[\s\S]{0,40}path/);
  });

  it('walks the drawn edges, so it can claim no connection the picture cannot show', () => {
    expect(source).toMatch(/const nextSteps = \$derived\.by[\s\S]{0,300}for \(const link of edges\)/);
  });
});

describe('a node close up', () => {
  it('draws as a card past the zoom that has room for one', () => {
    // A card in canvas units would overlap its neighbours at every zoom, since the
    // placement spaces nodes 130 apart; sized off the screen it fits.
    expect(source).toContain('const asCards = scale >= CARD_SCALE');
    expect(source).toContain('card.scale({ x: unit, y: unit })');
    expect(source).toContain('circle.visible(drawn && !carded)');
  });

  it('measures the card and everything hung off it with the same unit', () => {
    // The rim an arrow stops at, the ring, the pin and the switch all sit on the
    // card's edge. Measured any other way they drift off it as the card grows.
    expect(source).toContain('const unit = cardFactor(scale)');
    expect(source).toContain('const rim = { x: (CARD.w / 2) * unit, y: (CARD.h / 2) * unit }');
    expect(source).toContain('Math.hypot(CARD.w / 2, CARD.h / 2) * unit');
    expect(source).toContain('const margin = CARD.w * 2 * cardFactor(scale)');
  });

  it('shows the preview the case already holds, never the file itself', () => {
    // A few hundred nodes reaching for their own full-size image would download
    // the case to draw it. The thumbnail is the one the Media Library uses.
    expect(source).toContain('fileUrl(cid, thumb)');
    expect(source).toContain('previews.set(url, image)');
    expect(source).toContain("previews.set(url, 'failed')");
  });

  it('fills the picture column instead of letterboxing a thumbnail into it', () => {
    // A wide capture fitted inside a square left a strip floating in a hole, which
    // read as a broken card. The column is filled from the middle of the picture,
    // over a ground that holds the shape while it loads or if it never does.
    expect(source).toContain(
      'art.crop(cropToFill(image.naturalWidth, image.naturalHeight, CARD.art / CARD.h))',
    );
    expect(source).toContain("name: 'ground'");
    expect(source).toContain("card.findOne('.ground')?.fill(colours.surface)");
  });

  it('falls back to the entity glyph from the one icon set', () => {
    expect(source).toContain("import Icon, { paths } from '../components/Icon.svelte'");
    expect(source).toContain('paths[entityIcon(data)]');
  });

  it('only builds and only fetches for what is on screen', () => {
    expect(source).toContain('function onScreen(');
    expect(source).toContain('entry.card ??= buildCard(data)');
  });

  it('stops an edge at the side of a card rather than under it', () => {
    expect(source).toContain('boxRadius(rim.x, rim.y');
  });

  it('gives a card and a dot the same behaviour, since they are the same node', () => {
    expect(source).toContain('function answerTo(shape, data,');
    expect(source).toContain('answerTo(circle, data)');
    expect(source).toContain("answerTo(card.findOne('.bg'), data,");
  });

  it('asks the canvas for a real font stack, which `inherit` is not', () => {
    // `12px inherit` is an invalid font shorthand: every label silently rendered
    // in the browser's default face instead of the app's.
    expect(source).not.toContain("fontFamily: 'inherit'");
    expect(source).toContain("pick('--font-sans'");
  });
});

describe('drawing on canvas', () => {
  it('resolves the palette off the document, because canvas has no CSS variables', () => {
    // The bug this guards: `stroke: 'var(--accent)'` silently draws nothing.
    expect(source).toContain('function readColours()');
    expect(source).toContain('getComputedStyle(document.documentElement)');
    expect(source).not.toMatch(/stroke\(['"]var\(--/);
    expect(source).not.toMatch(/fill\(['"]var\(--/);
  });

  it('re-reads the palette when the theme changes under an open tab', () => {
    expect(source).toContain('MutationObserver');
    expect(source).toContain("attributeFilter: ['data-theme', 'class']");
  });

  it('takes its family hues from the shared palette in both themes', () => {
    for (const family of [
      'actor', 'asset', 'class', 'identifier', 'collected', 'document', 'place', 'claim',
    ]) {
      expect(css.match(new RegExp(`--graph-${family}:`, 'g'))).toHaveLength(2);
    }
  });

  it('costs no new dependency, drawing with the Konva already in the bundle', () => {
    expect(source).toContain("import Konva from 'konva'");
    expect(source).not.toMatch(/from ['"](d3|cytoscape|vis-network|sigma)/);
  });

  it('leaves the meaning of an edge on its stroke, for a graph that gets printed', () => {
    expect(layout).toContain('export function edgeStyle');
    expect(source).toContain('style.dash.map((n) => n / scale)');
  });

  it('draws every edge with a head, since the vocabulary is directed', () => {
    expect(source).toContain('new Konva.Arrow(');
    expect(source).toContain('arrow.pointerLength(');
  });

  it('explains its strokes instead of leaving four dash patterns unexplained', () => {
    expect(layout).toContain('export const EDGE_KINDS');
    expect(source).toContain('const strokes = $derived.by');
    expect(source).toContain('stroke-dasharray={entry.dash.join(\' \')}');
  });

  it('writes the verb along the edges under the eye, with the arrow, not against it', () => {
    expect(source).toContain('function styleVerb');
    expect(source).toContain('function lineReads(link)');
    expect(source).toContain('const verb = relationVerb(link.type)');
  });

  it('writes what kind of tie on the line, not a panel away', () => {
    // "is associated with" is the thin half of the statement; *sister* is the half
    // worth reading, and a picture that hides it makes the analyst click every edge.
    expect(source).toContain('if (link.nature) return `${verb} (${link.nature})`');
  });

  it('draws a proposal as one, as every other surface does', () => {
    expect(source).toContain("data.status === 'suggested'");
  });

  it('destroys the stage when the tab closes', () => {
    expect(source).toContain('stage?.destroy()');
  });

  it('keeps Konva off the buffer canvas, which is what makes the graph pannable', () => {
    // Measured, not guessed: a shape with a fill *and* a stroke *and* an opacity is
    // composited through a buffer canvas the size of the stage, so 45 faded arrows
    // allocated and cleared a full-screen canvas per frame of a drag — 246ms of a
    // 247ms redraw. Without it the same redraw is 3ms. Anything here that gains a
    // fill beside its stroke has to opt out too.
    const shapes = source.match(/new Konva\.(Arrow|Circle|Rect|Text)\(\{/g) ?? [];
    const optedOut = source.match(/perfectDrawEnabled: false/g) ?? [];
    expect(shapes.length).toBeGreaterThan(3);
    expect(optedOut.length).toBeGreaterThanOrEqual(5);
  });

  it('draws once per frame while panning, not once per pointer report', () => {
    expect(source).toContain('requestAnimationFrame');
    expect(source).toContain('cancelAnimationFrame');
    // Nothing can be picked mid-pan, so the hit canvas is not redrawn on the way.
    expect(source).toContain('layer?.listening(false)');
    expect(source).toContain('layer?.listening(true)');
  });
});

describe('arranging the case by hand', () => {
  it('lets a node be picked up and put somewhere', () => {
    expect(source).toContain('function grabbable');
    expect(source).toContain('moves.draggable(true)');
    expect(source).toContain('function moveNode');
  });

  it('gives a dot and a card the same grip, since they are the same node', () => {
    // A card that could not be dragged while the dot could would be a trapdoor at
    // one particular zoom. The card moves as a group: the picture, the title and
    // the stripe travel with it, not just the rectangle under the pointer.
    expect(source).toContain('function answerTo(shape, data, { named = false, moves = shape }');
    expect(source).toContain('{ named: true, moves: card }');
  });

  it('keeps a node drag from also panning the case', () => {
    // Konva dispatches shape events from a div inside the host, so stopping the
    // native event there is what keeps the container's pan listener out of it.
    expect(source).toContain("shape.on('pointerdown'");
    expect(source).toContain('event.evt?.stopPropagation()');
  });

  it('tolerates the same tremor a click does, so a shake never pins a node', () => {
    expect(source).toContain('moves.dragDistance(DRAG_SLOP)');
  });

  it('does not re-arrange the case when one node is dropped', () => {
    // The rule the whole feature rests on: if the layout re-ran on every drop,
    // every other node would slide out from under the hand. The drop moves the one
    // shape it holds and leaves `placed` alone, which is why the pin map is not
    // reactive state.
    expect(source).toContain('const pins = new Map();');
    expect(source).not.toMatch(/const pins = \$state/);
    expect(source).toContain('return arrange(placementNodes, mode, links, pins, settled)');
    expect(source).toMatch(
      /if \(ownsViewArrangement\(\)\) \{\s*arrangementSaveRevision \+= 1;\s*record\(\);\s*return;/,
    );
  });

  it('files a move as it is made rather than behind a Save button', () => {
    expect(source).toContain('setTimeout(flushPins, SAVE_AFTER)');
    expect(source).toContain("api.put(`/api/cases/${cid}/graph/pins`");
  });

  it('keeps a failed save in hand instead of losing the arrangement', () => {
    expect(source).toContain('for (const entry of batch) pending.set(');
  });

  it('says a failed arrangement without covering the drawing it failed over', () => {
    // `failed` draws a message where the drawing would be, which is only true when
    // there is no drawing. A pin that did not save put a permanent sentence over a
    // live graph, and nothing cleared it until the next read.
    expect(source).toContain("say(err.message || 'The arrangement could not be saved.')");
    expect(source).toContain("say(err.message || 'The pin could not be removed.')");
    expect(source).toContain("say(err.message || 'The arrangement could not be cleared.')");
    expect(source).not.toMatch(/failed = err\.message \|\| 'The (arrangement|pin)/);
  });

  it('files what is pending before reading the case back', () => {
    // Otherwise the answer overwrites the drag with the position it replaced.
    expect(source).toMatch(
      /await flushPins\(\);\s*if \(run !== loadRun \|\| caseState\.current\?\.id !== cid\) return;\s*loading = true/,
    );
  });

  it('files a move in the case where the drag happened', () => {
    expect(source).toContain('savingCase ??= cid;');
    expect(source).toMatch(/const cid = savingCase;[\s\S]{0,900}?\/graph\/pins/);
    expect(source).toContain('caseState.current?.id === cid && reading === lens');
  });

  it('offers a way out of an autosave, one node and all of them', () => {
    expect(source).toContain('function unpinNode');
    expect(source).toContain('function resetLayout');
    expect(source).toContain("api.del(`/api/cases/${cid}/graph/pins/${id}?lens=${lens}`)");
    expect(source).toContain("api.del(`/api/cases/${cid}/graph/pins?lens=${lens}`)");
    expect(source).toContain('Let it go');
  });

  it('counts the pins in the case, not the ones on screen', () => {
    // The way back has to be offered even when the pinned nodes were cut from the
    // view, or the cut hides it.
    expect(source).toContain('pinCount = payload.pinned ?? 0');
    expect(source).toContain('{#if pinCount > 0}');
  });

  it('marks a node it placed, so ignoring the layout is not a mystery', () => {
    expect(source).toContain('function styleMark');
    expect(source).toContain('data: paths.pushpin');
  });

  it('reaches the same act from the keyboard, which a canvas otherwise cannot', () => {
    expect(source).toContain('function nudge');
    expect(source).toContain('ArrowLeft');
    expect(source).toContain('event.shiftKey');
  });

  it('only arranges the whole case, never a neighbourhood', () => {
    // Distance from the root owns the horizontal axis there, so a node moved off
    // its column would contradict what that view is drawn to show.
    expect(source).toContain('const canArrange = $derived(!root && !snapshotReading)');
    expect(source).toContain('if (canArrange) grabbable(shape, moves, data)');
  });

  it('saves a drag caught by the debounce when the tab goes', () => {
    expect(source).toMatch(/flushPins\(\);\s*stage\?\.destroy\(\)/);
  });

  it('files an arrangement against the reading it was built in', () => {
    // A lens is a reading: it draws its own nodes and edges and clusters them its
    // own way, so one shared arrangement would anchor every reading into the shape
    // of whichever one it was built in.
    expect(source).toContain('lens: reading,');
    expect(source).toContain('const reading = savingFor ?? lens');
    expect(source).toContain('Each lens keeps its own arrangement');
  });

  it('gathers a handful with ctrl and moves all of it at once', () => {
    expect(source).toContain('event.evt?.ctrlKey || event.evt?.metaKey');
    expect(source).toContain('function toggleHeld');
    expect(source).toContain('if (held.includes(data.id))');
    // One delta for the whole handful, read off copies of where they started rather
    // than off seats the move is in the middle of rewriting.
    expect(source).toContain('for (const [id, start] of grip.at) moveNode(id, start.x + dx, start.y + dy)');
    expect(source).toContain('for (const id of grip ? grip.at.keys() : [data.id]) dropNode(id)');
  });

  it('keeps the handful apart from the selection', () => {
    // Selection is what the panel reads and what the fade is computed from; a set
    // would make "one hop from the selected node" a question with no single answer.
    expect(source).toContain('let held = $state([])');
    expect(source).toContain('let selected = $state(null)');
  });

  it('says a handful is gathered, and how to let it go', () => {
    expect(source).toContain('{held.length} held');
    expect(source).toContain('Let go of the handful (Escape)');
  });

  it('rings a held node without borrowing the meaning of a dash', () => {
    // A dashed outline means "proposed" everywhere else in the picture.
    expect(source).toContain('function styleHeld');
    expect(source).not.toMatch(/ring\.dash\(/);
  });

  it('lets the arrows move the handful too', () => {
    expect(source).toContain('const moving = held.length ? held : selected ? [selected] : []');
  });

  it('drops the handful when the reading changes', () => {
    // Half of it may not even be drawn in the next lens.
    expect(source).toMatch(/pinCount = payload\.pinned \?\? 0;[\s\S]{0,180}?held = \[\];/);
  });
});

describe('growing a drawing costs the arrivals, not the case', () => {
  it('remembers where the drawing came to rest, outside the reactive graph', () => {
    // Writing it back must not re-derive the thing it was read from, which is the
    // same reason the pin map is a plain Map.
    expect(source).toContain('const settled = new Map();');
    expect(source).not.toMatch(/const settled = \$state/);
    expect(source).toMatch(/\$effect\(\(\) => \{\s*for \(const seat of placed\) \{/);
    expect(source).toContain('if (!seat.parked) settled.set(seat.id, { x: seat.x, y: seat.y });');
  });

  it('leaves the parked column out of what is remembered', () => {
    // The park is placed against the cluster's edge rather than against the case, so
    // a spot remembered beside a cluster that has grown since would strand it.
    expect(source).toContain('if (!seat.parked)');
  });

  it('hands one node back to the layout without dropping the arrangement', () => {
    // "Let it go" is asked about one node. Forgetting the whole drawing to answer it
    // would take the reading down with it.
    expect(source).toMatch(/pins\.delete\(id\);\s*settled\.delete\(id\);/);
  });

  it('forgets every spot when the arrangement is reset, or the reset does nothing', () => {
    // A case whose every node is a fixed point has nothing left to place, so "let the
    // layout place these again" would answer with the picture it was asked to drop.
    expect(source).toMatch(/pins\.clear\(\);[\s\S]{0,300}?settled\.clear\(\);/);
  });
});

describe('what a node is, not only which family it belongs to', () => {
  it('says what a media node holds, since one type covers all of them', () => {
    // "Media" answers a question nobody asked: the analyst wants to know it is a
    // video. The map lives beside the icons, so no two surfaces can disagree.
    expect(source).toContain('entityKindLabel(data, entityLabel(data.type))');
    expect(source).toContain('entityKindLabel(tip, entityLabel(tip.type))');
    expect(source).toContain('kind: data.kind ?? ');
  });

  it('tells material the case made from material it collected', () => {
    // A frame pulled out of a video and a photograph somebody handed over were the
    // same node: same type, same family, same glyph. A video with twelve saved
    // frames drew as thirteen pictures with nothing saying which twelve came out of
    // the first. The card says the act, and the panel says where it came from.
    expect(source).toContain('madeHereLabel(data) ?? entityKindLabel(data, entityLabel(data.type))');
    expect(source).toContain('madeHereLabel(tip) ?? entityKindLabel(tip, entityLabel(tip.type))');
    expect(source).toContain('origin: data.origin ?? ');
    expect(source).toContain('{#if madeHereBy(chosen)}');
    expect(source).toContain('Made in {madeHereBy(chosen)} out of material the case already holds.');
  });

  it('says nothing about a file the case collected, rather than labelling every one', () => {
    // The backend leaves `origin` off an upload, so the mark is the whole signal.
    // A card reading "Upload" on everything imported is a mark on nothing.
    expect(source).not.toContain("'upload'");
    expect(source).not.toContain('Imported');
  });

  it('draws each dot with its own glyph, once the dot is big enough to hold one', () => {
    // The cost this bounds: a wide zoom is where a case draws the most nodes and
    // where an icon is a smudge, so the glyph is gated on the drawn size.
    expect(source).toContain('function styleGlyph');
    expect(source).toContain('GLYPH_MIN');
    expect(source).toContain('across >= GLYPH_MIN');
  });

  it('offers previews as a choice, and asks for no pictures when they are off', () => {
    expect(source).toContain('let showPreviews = $state(true)');
    expect(source).toContain('if (showPreviews && data.thumb)');
    expect(source).toContain('{#if showPreviews && tip.thumb && caseState.current}');
    // A card is built once and kept, so the toggle has to throw the built ones away.
    expect(source).toContain('function forgetCards');
  });

  it('draws the park as a region rather than floating a caption over it', () => {
    // Set apart only reads if the area they are set apart into is drawn, and the
    // toolbar already counts them — so this names them once, in one word.
    expect(source).toContain("name: 'parked-tray'");
    expect(source).toContain("text: 'Unconnected'");
    expect(source).not.toContain('nothing connects to these');
  });
});

describe('it does not rebuild what already exists', () => {
  it('opens rows in the one Details panel every other surface uses', () => {
    expect(source).toContain("import EntityDetails from '../components/EntityDetails.svelte'");
  });

  it('names verbs and types from the registries rather than a local map', () => {
    expect(source).toContain('relationReading,');
    expect(source).toContain("} from '../lib/relations.svelte.js'");
    expect(source).toContain("from '../lib/entityIcon.js'");
    expect(source).not.toContain('const VERB_LABELS');
  });

  it('reads an incoming edge with the registry inverse, not with an arrow glyph', () => {
    // The wording heads the group now, which is also why the direction is part of
    // the key: one heading over both directions would read as the wrong one for half
    // the rows under it.
    expect(source).toContain("const way = row.outgoing ? 'out' : 'in'");
    expect(source).toContain('relationReading(row.link.type, way)');
    expect(source).toContain('const key = `${row.link.type} ${way}`');
  });

  it('keeps the placement pure and out of the component', () => {
    expect(source).toContain("from '../lib/graph.js'");
    expect(source).not.toContain('Math.random');
  });
});

describe('the view grows instead of being replaced', () => {
  it('expands a node by adding it to the expansion, not by re-rooting the view', () => {
    // The gesture the whole tool turns on: what was on screen stays on screen.
    expect(source).toContain('function expandNode(id)');
    expect(source).toContain('expanded = [...expanded, id]');
    expect(source).toContain("shape.on('dblclick dbltap'");
    expect(source).toMatch(/dblclick dbltap[\s\S]{0,200}toggleAround\(data\.id\)/);
  });

  it('sends the opened nodes to the same read the case opens on', () => {
    expect(source).toContain("params.expand = expanded.join(',')");
    expect(source).toContain("return ['/graph', params]");
  });

  it('offers to open only what is not already on screen', () => {
    // A view that already holds every one of a node's neighbours has nothing left
    // to bring in, which is most of the time on a case that fits. Offering the act
    // there was offering one that could only appear to do nothing.
    expect(source).toContain('const offScreen = $derived.by');
    expect(source).toContain('All its connections are drawn');
    expect(source).toContain('disabled={!away || Boolean(root)}');
  });

  it('offers one way back for the whole picture, not one per list', () => {
    // Four lists edit one drawing, and four counts in the toolbar meant reading all
    // of them to work out which was in the way.
    expect(source).toContain('function resetDrawing()');
    expect(source).toMatch(
      /function resetDrawing\(\) \{\s*expanded = \[\];\s*kept = \[\];\s*omitted = \[\];\s*collapsed = \[\];/,
    );
    expect(source).toContain('Reset view');
    // The arrangement is not part of it: that one undoes work done by hand.
    expect(source).toMatch(/function resetDrawing[\s\S]{0,200}\}/);
    expect(source).not.toMatch(/function resetDrawing\(\)[\s\S]{0,200}pins\.clear/);
  });

  it('says the three acts on the drawing in three words and no others', () => {
    // One act, one word, everywhere it is offered. The tool used to say Open, Fold
    // back, Fold it back, Take it out and Bring back for what is really three things.
    expect(source).toContain('Expand {away} more connection');
    expect(source).toContain('Collapse {takes}');
    expect(source).toContain('Hide it');
    expect(source).not.toMatch(/>\s*Fold back/);
    expect(source).not.toMatch(/Fold it back/);
    expect(source).not.toMatch(/Take it out of the drawing/);
    expect(source).not.toMatch(/Bring back \{/);
  });

  it('takes the case at its word about what is open', () => {
    // A node deleted in another tab must stop being offered as foldable.
    expect(source).toContain('if (Array.isArray(payload.expanded)) expanded = payload.expanded');
  });
});

describe('a comfort number, not a ceiling', () => {
  it('states no ceiling, because the drawing has none', () => {
    // A limit that refuses is the app overruling the analyst about their own picture.
    // What was left of it here was a gauge, a greyed control and a refusal in words.
    expect(source).not.toContain('viewFull');
    expect(source).not.toContain('payload?.room');
    expect(source).not.toContain('The view is full');
  });

  it('says what a heavy drawing costs instead of refusing to draw one', () => {
    // Measured, not guessed: the relaxation is O(n²) on the main thread, so a
    // thousand nodes cost about a second and two thousand freeze the tab.
    expect(source).toContain('const HEAVY = 1000');
    expect(source).toContain('const FREEZING = 2000');
    expect(source).toMatch(
      /const weight = \$derived\([\s\S]{0,160}nodes\.length >= FREEZING \? 'freezing'/,
    );
    expect(source).toContain('Every change now freezes the tab for a few seconds');
  });

  it('answers an expansion whole, so a second press has nothing to ask for', () => {
    // The budget used to serve part of an answer and report the node open, which
    // greyed the one control offering to open it.
    expect(source).toMatch(
      /function expandNode\(id\)[\s\S]{0,900}if \(expanded\.includes\(id\)\) return;/,
    );
    expect(source).toMatch(/if \(away > 0\) return \{ id, act: 'expand', count: away \};/);
  });

  it('hands a hidden node back from the node it was hanging on', () => {
    // Undoing one node of a hiding used to cost the whole drawing, since Reset view is
    // the only way back and it puts every other edit back with it.
    expect(source).toContain('let putAway = $state({})');
    expect(source).toMatch(/function takeOut\(ids\)[\s\S]{0,700}putAway = record;/);
    expect(source).toMatch(/function expandNode\(id\)[\s\S]{0,700}if \(bringBackAt\(id\)\) return;/);
    expect(source).toMatch(/function bringBackAt\(id\)[\s\S]{0,300}omitted = omitted\.filter/);
    // Counted as missing, or the node would say every connection was drawn while the
    // analyst was looking at the gap they had just made.
    expect(source).toContain('(putAway[id]?.length ?? 0)');
    // And forgotten the moment it is drawn again, whatever brought it back.
    expect(source).toMatch(/function backIn\(ids\)[\s\S]{0,400}forgetHidden\(ids\)/);
    expect(source).toMatch(/function resetDrawing\(\)[\s\S]{0,160}putAway = \{\};/);
  });

});

describe('the drawing is a set you own', () => {
  it('tells drawing a node from drawing a node and one hop', () => {
    // One list conflated the two acts, so a named node always arrived with its whole
    // neighbourhood. Right for a node being read, wrong for everything else.
    expect(source).toContain('function holdOn(ids)');
    expect(source).toContain('kept = [...new Set([...kept, ...named])]');
    expect(source).toContain("params.keep = kept.join(',')");
    expect(source).toContain("params.expand = expanded.join(',')");
  });

  it('draws a route as itself instead of one neighbourhood per step', () => {
    // A four-node answer used to arrive inside a crowd of forty, which is the sentence
    // being drawn and then buried.
    expect(source).toMatch(/routing = body\.routes;\s*holdOn\(body\.routes\.flatMap/);
  });

  it('takes any node out, not only one that was opened', () => {
    expect(source).toContain('function takeOut(ids)');
    expect(source).toContain("params.omit = omitted.join(',')");
    // Both surfaces a node states its acts in, and the panel is the keyboard path:
    // the menu is a right-click, which no key sends.
    expect(source).toContain('onclick={() => takeOut([chosen.id])}');
    expect(source).toContain('onclick={() => chose((id) => takeOut([id]))}');
    expect(source).toContain('Hide it');
  });

  it('words it clear of the edge panel’s Remove, which deletes a statement', () => {
    // Two acts, one word, in two panels a click apart: "Remove" on an edge takes the
    // case's own row away, where this takes a node out of a picture.
    expect(source).toContain('>\n              Hide\n            </button>');
    expect(source).toMatch(/takeOut\(\[chosen\.id\]\)[\s\S]{0,200}not out of the case/);
    expect(source).not.toMatch(/onclick=\{\(\) => takeOut\(\[chosen\.id\]\)\}>\s*Remove/);
  });

  it('lets the panel’s acts wrap rather than clipping the last one’s label', () => {
    // The row grew a fourth act, and a fixed-width panel squeezed it until
    // *Collapse (35)* read as *Collapse* — a button clipped to its first word naming a
    // different act than the one it performs.
    expect(source).toMatch(/\.actions \{[^}]*flex-wrap: wrap;/);
  });

  it('adds to the removals and prunes nothing, so bringing back is a whole undo', () => {
    // The case applies the removals last, so they already win over the name that drew
    // the node and the hop that reached it. Pruning those lists would make the way back
    // a half-undo: a node in the picture only because it was named would not return.
    expect(source).toMatch(/function takeOut\(ids\)[\s\S]{0,900}omitted = \[\.\.\.new Set\(\[\.\.\.omitted, \.\.\.going\]\)\]/);
    expect(source).not.toMatch(/function takeOut\(ids\)[\s\S]{0,900}kept = kept\.filter/);
  });

  it('offers a way back out of a removal, as a control rather than an undo', () => {
    // The same way back as for every other edit: the nodes cannot be named the way an
    // expansion's are — they are not on screen to have a label — so naming the lists
    // apart bought nothing and cost the analyst a choice.
    expect(source).toContain('function resetDrawing()');
    expect(source).toContain('Draw the case the way it opened');
  });

  it('lets a name asked for again outrank a removal made earlier', () => {
    expect(source).toContain('function backIn(ids)');
    expect(source).toContain('omitted = omitted.filter((id) => !named.has(id))');
  });

  it('lets go of what a removed node was carrying, before the read lands', () => {
    // A node on its way out of the picture must not be left being read, and half a
    // path is not worth keeping — the bargain Escape already makes with a walk.
    expect(source).toContain('if (going.has(selected)) selected = null');
    expect(source).toContain('if (path.some((step) => going.has(step.id))) traceStop()');
  });

  it('grows and empties by the group, not one node per read', () => {
    // Five nodes opened one at a time is five reads and five arrivals landing in five
    // places, where the analyst asked one question about five nodes.
    expect(source).toContain('function expandGathered()');
    expect(source).toContain('Expand {held.length}');
    expect(source).toContain('Hide {held.length}');
    expect(source).toContain('onclick={() => takeOut(held)}');
  });

  it('takes the case at its word about what it drew by name', () => {
    // A node deleted in another tab, or of a type this reading does not draw, must
    // stop being carried in the list the client sends back.
    expect(source).toContain('if (Array.isArray(payload.kept)) kept = payload.kept');
  });

  it('never offers to edit the drawing in a view that is one node’s hops', () => {
    // A neighbourhood's root is the question being asked, and its read takes none of
    // these lists.
    expect(source).toMatch(/\{#if !root\}[\s\S]{0,600}takeOut\(\[chosen\.id\]\)/);
    expect(source).toMatch(/\{#if !root\}[\s\S]{0,600}Hide it/);
  });

  it('rereads without refitting or replacing the drawing after an edit', () => {
    // Growing, folding and removing are the same question. Only a lens, an order, a
    // folder, a family or a question handed over by the Board is a new one — and the
    // key that decides that carries none of the three lists.
    expect(source).toMatch(/cid,[\s\S]{0,260}?String\(rev\),\s*lens,\s*order,\s*root \?\? '',\s*hops/);
    expect(source).toContain('JSON.stringify(searchTerms), JSON.stringify(temporalTerms), catalogViews.snapshotId');
    expect(source).toMatch(/kept\.join\(','\),\s*expanded\.join\(','\),\s*omitted\.join\(','\),/);
  });

  it('rereads when another surface changes the case', () => {
    expect(source).toContain('const rev = caseState.rev;');
    expect(source).toContain('String(rev),');
    expect(source).toContain('`${cid}|${caseState.rev}`');
  });

  it('lets only the latest case read own the canvas', () => {
    expect(source).toContain('let loadRun = 0;');
    expect(source).toContain('const run = ++loadRun;');
    expect(source).toContain('run !== loadRun || caseState.current?.id !== cid');
    expect(source).toContain('const next = await api.get');
  });

  it('starts a new case with no edits carried over from the last one', () => {
    // Ids from another case name nothing here, and a removal carried over would take a
    // node out of a picture nobody has looked at yet.
    expect(source).toMatch(/function startCase\(cid\)[\s\S]{0,500}?root = null;/);
    expect(source).toMatch(/function startCase\(cid\)[\s\S]{0,900}?pickFolder = '';/);
    expect(source).toMatch(/function startCase\(cid\)[\s\S]{0,1200}?fromBoard = null;/);
    expect(source).toMatch(/function startCase\(cid\)[\s\S]{0,1600}?find = '';/);
    expect(source).toMatch(/function startCase\(cid\)[\s\S]{0,2200}?creating = null;/);
  });
});

describe('the drawing folds, including the part the case opened on', () => {
  it('folds without asking the case anything', () => {
    // The whole reason this act exists beside the other three: it reads the drawing
    // already on screen, so it reaches the nodes that were there before the analyst
    // touched anything — which no server-side list can do.
    expect(source).toContain('let collapsed = $state([])');
    expect(source).toContain('function foldNode(id)');
    expect(source).toContain('collapsed = [...collapsed, id]');
    // Never sent, unlike the three lists that edit the set.
    expect(source).not.toMatch(/params\.\w+ = collapsed/);
    // And never a reason to re-read the case.
    expect(source).not.toMatch(/loadedFor = null;[\s\S]{0,60}collapsed/);
  });

  it('takes the folded nodes out at the seam everything else reads', () => {
    // One filter, before the placement, so the legend, the search, the focus and the
    // edges are all folded at once without any of them knowing folding exists.
    expect(source).toContain('const folds = $derived(foldAway(collapsed, sentNodes, sentLinks');
    expect(source).toMatch(/const nodes = \$derived\([\s\S]{0,140}folds\.hidden\.has\(node\.id\)/);
    expect(source).toMatch(/const links = \$derived\([\s\S]{0,220}folds\.hidden\.has\(link\.from\)/);
  });

  it('never folds a node the analyst placed by hand', () => {
    // An arrangement somebody built outranks a rule that tidies.
    expect(source).toContain('foldAway(collapsed, sentNodes, sentLinks, new Set(pinnedIds))');
  });

  it('refuses a fold that would do nothing rather than answering with the same picture', () => {
    expect(source).toMatch(
      /function foldNode\(id\)[\s\S]{0,500}if \(!foldableCount\(id, nodes, links[\s\S]{0,60}return;/,
    );
  });

  it('states what the switch will do before it is pressed', () => {
    // A canvas teaches no gesture, so the count is the teaching: plus grows the
    // picture, minus shrinks it, in all three states of the same switch.
    expect(source).toContain('const switchFor = $derived.by');
    expect(source).toContain("act: 'unfold'");
    expect(source).toContain("act: 'expand'");
    expect(source).toContain("act === 'fold' ? '−' : '+'");
  });

  it('grows before it tidies, so one switch never has to be remembered', () => {
    // A node holding folded nodes gives them back; one with neighbours off screen
    // fetches them; one with everything already around it puts that away.
    expect(source).toMatch(
      /function toggleAround\(id\) \{\s*if \(collapsed\.includes\(id\)\) unfoldNode\(id\);\s*else if \(!root && offScreen\(id\) > 0\) expandNode\(id\);\s*else foldNode\(id\);/,
    );
  });

  it('draws the switch on the node in hand, not on all three hundred', () => {
    // A count pinned to every dot is a few hundred numbers competing with the shape
    // of the case, which is the one thing the tool exists to show.
    expect(source).toContain('function stylePill(');
    expect(source).toMatch(/const on = switchFor\?\.id === data\.id \? switchFor : null/);
    // A node that is holding something says so whether or not it is under the eye.
    expect(source).toContain('const holding = collapsed.includes(data.id)');
  });

  it('keeps the switch off an armed gesture, which owns the press', () => {
    expect(source).toMatch(/count > 0 && !drawing && !tracing && !asking/);
  });

  it('lets a name, a route or a connection outrank a fold', () => {
    // Left standing, a fold answers the thing just asked for with the picture it was
    // already showing.
    expect(source).toContain('function showAgain(ids)');
    expect(source).toMatch(/function backIn\(ids\)[\s\S]{0,520}showAgain\(ids\)/);
    expect(source).toMatch(/function jumpTo\(id\) \{[\s\S]{0,260}showAgain\(\[id\]\)/);
    expect(source).toMatch(/function settleRoute\(\)[\s\S]{0,320}showAgain\(/);
  });

  it('finds a folded node where it is instead of fetching it again', () => {
    expect(source).toMatch(/const matches = \$derived\.by[\s\S]{0,600}sentNodes/);
    expect(source).toContain("{folds.hidden.has(row.id) ? 'folded' : row.degree}");
    // And the catalog list does not offer to bring in what the drawing already has.
    expect(source).toContain('const drawn = new Set(sentNodes.map((node) => node.id))');
  });

  it('counts what is drawn rather than what the case sent', () => {
    // A number that argues with the picture is worse than no number.
    expect(source).toContain('{nodes.length} of {payload.total}');
    expect(source).toContain('{foldedCount} folded');
  });

  it('gives every fold back at once, and for free', () => {
    expect(source).toMatch(/function unfoldAll\(\) \{\s*collapsed = \[\];\s*\}/);
    expect(source).toContain('Give back everything the folds are holding');
  });
});

describe('an edge is a thing to read and to rule on', () => {
  it('lets the pointer reach an edge at all', () => {
    // A one-pixel stroke is unhittable, so the hit region is widened rather than
    // the line: the picture is unchanged.
    expect(source).toContain('hitStrokeWidth: 14');
    expect(source).toContain('const wires = new Konva.Group();');
  });

  it('reads the chosen edge in the panel the nodes use', () => {
    expect(source).toContain('const chosenEdge = $derived(');
    expect(source).toContain('{relationVerb(chosenEdge.type)}');
  });

  it('rules on a proposal from the picture', () => {
    expect(source).toContain("ruleOn(chosenEdge.id, 'confirmed')");
    expect(source).toContain("api.patch(`/api/cases/${cid}/links/${linkId}`, { status })");
  });

  it('lights an edge under the pointer the way a node lights', () => {
    expect(source).toContain('const picked = link.id === chosenLink || link.id === hoveredLink');
  });

  it('judges the edge where it is read, instead of a panel away', () => {
    // Reading a line here and grading it used to mean leaving the drawing for the
    // node's Details and finding the row again among its grouped connections. On a
    // worked case the finding is more often on the edge than on either node.
    expect(source).toContain('async function rateEdge(linkId, raw)');
    expect(source).toContain('confidence: raw === \'\' ? null : Number(raw)');
    expect(source).toContain('onchange={(event) => rateEdge(chosenEdge.id, event.currentTarget.value)}');
  });

  it('offers the two controls because the registry declares them, not because the edge holds one', () => {
    // A qualifier belongs to the verb and a rating to a ratable one, so a derivation
    // and a mention offer neither — the same rule Details follows, and what keeps a
    // free note off the rest of the vocabulary.
    expect(source).toContain('{@const qualifier = relationQualifier(chosenEdge.type)}');
    expect(source).toContain(
      '{@const gradable = isRatable(chosenEdge.type) && confidenceLevels().length}',
    );
  });

  it('reads the levels from the registry and offers clearing as the absence of one', () => {
    // One list, so the picker cannot offer a value the API would refuse; and "not
    // assessed" is a state to return to rather than a fifth level.
    expect(source).toContain('{#each confidenceLevels() as level (level.value)}');
    expect(source).toContain('<option value="">Not assessed</option>');
  });

  it('never grades a proposal, which the API refuses before it is reviewed', () => {
    // Reviewing a machine's claim and grading it are two gestures: the confirm has to
    // land first, so the control is not there to be pressed.
    expect(source).toContain(
      "{#if !snapshotReading && chosenEdge.provenance?.status !== 'suggested'}",
    );
  });

  it('lets the line carrying a qualifier be the line that changes it', () => {
    // The drawing already wrote *is associated with (sister)* and could not correct
    // it: readable in the picture, editable only outside it.
    expect(source).toContain('if (link.nature) return `${verb} (${link.nature})`');
    expect(source).toContain('async function qualifyEdge(link, raw)');
    expect(source).toContain('{ nature: value || null }');
    // On change, and not on a value the edge already holds: `change` fires on blur, so
    // clicking through the panel would otherwise re-read the case for nothing.
    expect(source).toContain("if (!cid || value === (link.nature ?? '')) return");
  });

  it('re-reads the case after a judgement, because the rating can change the stroke', () => {
    expect(source).toMatch(
      /confidence: raw === ''[\s\S]{0,200}loadedFor = null;\s*await load\(\);/,
    );
  });
});

describe('two entities can be connected from the graph', () => {
  it('offers the act in a menu, where people look for what a thing can do', () => {
    // Two drag gestures were tried first. A rim band covered most of a small node,
    // so moving one started a link by accident; a visible handle was still a drag,
    // fiddly on a trackpad and invisible until you knew it was there.
    expect(source).toContain("shape.on('contextmenu'");
    expect(source).toContain('function openMenu(id, at)');
    expect(source).toContain('Connect to…');
    expect(source).not.toContain('function onRim');
    expect(source).not.toContain('function placeHandle');
  });

  it('names the other end with a click, not with a held button', () => {
    expect(source).toContain('function landOn(id)');
    expect(source).toContain('if (drawing && landOn(data.id)) return');
  });

  it('asks the vocabulary once, when the connection is armed', () => {
    // The answer cannot change while the pointer travels, and asking per move would
    // run the registry over every node a hundred times a second.
    expect(source).toMatch(/function startDrawing[\s\S]{0,300}relationOptions\(from, node\)\.length/);
    expect(source).toContain('drawing.targets.has(over)');
  });

  it('refuses a pair the vocabulary has no reading for, in words', () => {
    expect(source).toContain('The vocabulary has no connection between those two.');
  });

  it('moves only the arrow while the case is panned under it', () => {
    // A pan deliberately does not restyle. Paying for a few hundred shapes on every
    // frame of one to keep a single line in step would undo the reason it draws
    // that way.
    expect(source).toMatch(/group\.position\(drag\.to\);[\s\S]{0,320}if \(drawing\) styleBand\(/);
    expect(source).toContain('const origin = drag?.to ?? { x: group.x(), y: group.y() }');
  });

  it('lets the case be panned while a connection is armed', () => {
    // The two nodes worth joining are often nowhere near each other, and a mode that
    // pinned the view would make exactly those the hard ones.
    expect(source).toMatch(/if \(drawing\) drawTo\(event\);\s*if \(!drag/);
  });

  it('says it is mid-gesture, and offers the way out', () => {
    // A mode with no words is a mode nobody can get out of.
    expect(source).toContain('Connecting from');
    expect(source).toMatch(
      /if \(menu\) menu = null;\s*else if \(blank\) blank = null;\s*else if \(offer\) offer = null;\s*else if \(drawing\)/
    );
  });

  it('files the relation through the route every other surface uses', () => {
    expect(source).toMatch(
      /api\.post\(`\/api\/cases\/\$\{cid\}\/links`, \{\s*from_id: from,\s*to_id: to,\s*type: option\.type,\s*\}\)/,
    );
  });

  it('heads a pointer apart from a statement, as the registry does', () => {
    // "mentions" in the same unheaded list as "owns" makes a document naming a
    // place look like a statement about it (ONTOLOGY §3). The heading is the
    // registry's own, so no wording is invented on the canvas.
    expect(source).toContain('const offerGroups = $derived.by(');
    expect(source).toContain('{#if set.group}<p class="heading">{set.group}</p>{/if}');
  });

  it('speaks up only when a filed edge is not drawn by the current lens', () => {
    // The edge appearing is the confirmation. A lens that does not hold the verb
    // draws nothing new, and a write with no visible result reads as one that failed.
    expect(source).toContain("say('Filed, and not drawn in this lens.')");
    expect(source).toContain("!payload?.links?.some((edge) => edge.id === filed.id)");
  });

  it('calls nothing it does not define', () => {
    // A helper that was never written threw a ReferenceError into the catch that
    // exists to report a refused connection, so a relation filed successfully
    // reported an error naming the missing function.
    expect(source).not.toContain('loadLeads');
    expect(source).not.toContain('saveRelation');
  });

  it('does not offer the menu where a node cannot be arranged', () => {
    // A neighbourhood lays out by distance from its root; a link drawn there would
    // fight the axis that view exists to show.
    expect(source).toMatch(/contextmenu[\s\S]{0,200}if \(!canArrange\) return/);
  });

  it('leaves the ctrl-click that gathers alone on macOS', () => {
    // One press, one act: that same press is a right-click there.
    expect(source).toContain('if (event.evt?.ctrlKey && event.evt?.button === 0) return');
  });

  it('redraws the armed arrow once per frame, not once per pointer report', () => {
    expect(source).toMatch(/frame \|\|= requestAnimationFrame\(\(\) => \{\s*frame = 0;\s*restyle\(\);/);
  });
});

describe('the view does not move under the analyst', () => {
  it('refits on a new question and never on a growth', () => {
    // Opening a node and watching the whole case slide to a new position is the
    // fastest way to lose your place — the thing growing in place was built to stop.
    expect(source).toMatch(/const fresh = asked !== askedFor;[\s\S]{0,120}resetView = fresh;/);
  });

  it('re-places on a new question and never on a growth, off the same seam', () => {
    // The same fact told twice would let the view and the arrangement disagree about
    // what a new question is, which is a picture that refits without re-placing.
    expect(source).toContain('if (fresh) settled.clear();');
  });

  it('clears what it said instead of leaving a banner nobody reads', () => {
    expect(source).toContain('function say(message)');
    expect(source).toContain("sayTimer = setTimeout(() => (saving = ''), 6000)");
  });
});

describe('the way back, one act at a time', () => {
  it('follows the state rather than the acts, so a new control is undoable by existing', () => {
    // Hooking each act is the version that rots: the next control is undoable only if
    // somebody remembered, and nothing fails when they did not.
    expect(source).toContain('const history = createHistory()');
    expect(source).toMatch(/\$effect\(\(\) => \{\s*record\(\);\s*\}\)/);
    expect(source).toContain('function record()');
    // The snapshot is read before the guard or the effect subscribes to nothing but
    // the case id, and the recorder goes deaf the moment it is anchored.
    expect(source).toMatch(
      /function record\(\) \{\s*const now = snapshotNow\(\);\s*if \(restoring \|\| !anchored/,
    );
    expect(source).toContain('history.push(now)');
  });

  it('records a drag itself, since its coordinates are not reactive state', () => {
    expect(source).toMatch(/function dropNode\(id\)[\s\S]{0,700}?record\(\);/);
  });

  it('anchors on the picture the case opened on, never before its first read', () => {
    // Anchored earlier, one undo too many would ask the case to drop every pin it had
    // not yet sent.
    expect(source).toContain('if (anchored !== cid)');
    expect(source).toContain('history.reset(snapshotNow())');
  });

  it('asks the case again even when only the arrangement moved', () => {
    // A restored arrangement changes nothing the reading is keyed on, and the picture
    // has to move all the same.
    expect(source).toContain('String(rereads)');
    expect(source).toContain('rereads += 1');
  });

  it('does not let the run that answers a restore undo the undo', () => {
    // Putting an arrangement back waits on the case, and an effect between the pins
    // landing and the lists being assigned would record a picture nobody asked for —
    // one entry off the state being restored, which forks the timeline and takes the
    // redo with it.
    expect(source).toContain('let restoring = $state(false)');
    expect(source).toContain('if (restoring || !anchored');
    expect(source).toMatch(/} finally \{\s*\/\/[\s\S]{0,180}?await tick\(\);\s*restoring = false;/);
  });

  it('touches an arrangement only inside the reading it was taken in', () => {
    // Pins are per lens and survive a switch, so diffing against the lens on screen
    // would take one reading's pins off with the other reading's list.
    expect(source).toContain('if (ownsViewArrangement() || was.lens === lens)');
    expect(source).toContain('arrangementDiff(arrangementNow(), wanted)');
  });

  it('binds the three chords the rest of the app binds, and gives up a gesture', () => {
    expect(source).toMatch(/if \(drawing \|\| tracing \|\| asking\) return;/);
    expect(source).toMatch(/chord === 'z'[\s\S]{0,160}?event\.shiftKey\) redo\(\);\s*else undo\(\)/);
    expect(source).toContain("chord === 'y'");
    // A field being typed into owns its own undo, and the guard above it is shared.
    expect(source).toMatch(/if \(typing\) return;\s*if \(event\.ctrlKey \|\| event\.metaKey\)/);
  });

  it('says so in the toolbar, because a canvas teaches no gesture', () => {
    expect(source).toContain('{#if canUndo}');
    expect(source).toContain('{#if canRedo}');
    expect(source).toContain('onclick={undo}');
    expect(source).toContain('Undo the last change to the drawing (Ctrl+Z)');
  });

  it('never reaches a write to the case', () => {
    // A stack mixing "I hid a node" with "I deleted a statement" rewrites the case on
    // the fourth press to get a view back, and a re-filed edge mints a new id, date
    // and author — an undo that forges the provenance it claims to restore.
    const restore = source.slice(source.indexOf('async function restore(text)'));
    const body = restore.slice(0, restore.indexOf('\n  }'));
    expect(body).not.toMatch(/api\.(post|del)\(/);
    expect(body).not.toContain('/links');
  });
});

describe('one finding on the ground is one arrow', () => {
  it('keeps the acts on it, because it is the row the case holds', () => {
    // Not a synthetic edge: the video really does state that point, so confirming or
    // withdrawing it stays possible and the merge is said beside those acts.
    expect(source).toContain('{#if chosenEdge.merged}');
    expect(source).toMatch(
      /\{#if chosenEdge\.merged\}[\s\S]{0,900}?\{#if chosenEdge\.provenance\?\.by\}/,
    );
  });

  it('hands back what it absorbed through the one mechanism for it', () => {
    expect(source).toContain('const back = link.folded?.open ?? link.merged?.open ?? []');
    expect(source).toContain('Show the {chosenEdge.merged.open.length}');
    expect(source).toContain('Stands for {chosenEdge.merged.sources} more, all the same material.');
  });

  it('says so without being pointed at, and carries the weight it took on', () => {
    // The count is the whole reason those nodes are not on screen, so leaving it to
    // the hover lost them. Written at every zoom it was three hundred sentences over
    // the shape of the case, so it waits for the zoom the nodes become cards at and
    // the extra weight carries it until then.
    expect(source).toContain('const stands = Boolean(link.folded || link.merged)');
    expect(source).toContain('styleVerb(entry, Boolean(touching) || (stands && asCards), scale)');
    expect(source).toContain('+ (stands ? 0.9 : 0)');
    // A bare count on a merged arrow: writing the material into the verb would put
    // words in the statement's mouth.
    expect(source).toContain('return `${verb} (+${link.merged.sources})`');
  });
});

describe('what came out of a node and was used by nothing', () => {
  it('says it on the node, in the act the analyst named it by', () => {
    // "3 medias made from it" spends the sentence saying nothing; "3 frames" is the
    // whole fact. Same words as the collapsed step, resolved on the same surface.
    expect(source).toContain('function rolledReads(rolled)');
    expect(source).toContain("const what = via.length === 1 ? madeAsWord(via[0]) : 'derivative'");
    expect(source).toContain('{rolledReads(chosen.rolled)} made from it, used by nothing.');
  });

  it('is one count and one offer, not two of each', () => {
    // The node prices its unused derivatives among the connections the drawing does
    // not hold, and expanding brings them like any other. Split off, the pill read
    // "+4" while the menu offered "1 more connection" for the same five nodes, and the
    // difference between the two numbers was about the mechanism rather than the case.
    expect(source).not.toContain("act: 'derived'");
    expect(source).not.toContain('Show {rolledReads(at.rolled)}');
    expect(source).toMatch(
      /function toggleAround\(id\) \{\s*if \(collapsed[\s\S]{0,120}?else if \(!root && offScreen\(id\) > 0\) expandNode\(id\);/,
    );
  });
});

describe('the wrapper is an edge, and the count is what it says', () => {
  it('writes what a folded edge stands for beside its verb', () => {
    // "cites" alone would be a thicker line saying less than the three it replaced.
    expect(source).toContain('function standsFor(link)');
    expect(source).toContain('return `${verb} ${standsFor(link)}`');
    // The account clause is left off where nothing published these: a proof has no
    // publisher, and "0 accounts" reads as a gap rather than as another kind of source.
    expect(source).toContain(
      "return accounts ? `${many} · ${accounts} account${accounts === 1 ? '' : 's'}` : many",
    );
  });

  it('writes a collapsed step as the act rather than as the type', () => {
    // "derived from 2 medias" spends the edge saying nothing: the step is what the
    // analyst named it by in Inspect, and the words live on the one surface for them.
    expect(source).toContain("const what = via.length === 1 ? madeAsWord(via[0]) : 'source'");
    expect(source).toContain('madeAsWord,');
  });

  it('hands back what it stands for through the one mechanism for it', () => {
    // A node the analyst named is never folded, so naming these draws them again —
    // named rather than opened, since a source is wanted as itself and opening it
    // would drag whatever else it touches in behind it.
    expect(source).toContain('function unfold(link)');
    expect(source).toMatch(/function unfold\(link\)[\s\S]{0,600}holdOn\(back\)/);
  });

  it('does not offer to confirm, remove or judge an edge that is not a row', () => {
    // Nothing may be written to a folded edge: the case has no such link, so the
    // controls would 404 on an act the panel had just offered. A rating and a
    // qualifier are writes like the other two, so they sit on the same side of the
    // branch — sliced rather than length-matched, since the row's half keeps growing.
    const start = source.indexOf('{#if chosenEdge.folded}');
    const split = source.indexOf('{#if chosenEdge.merged}', start);
    const end = source.indexOf('<ul class="neighbours">', split);
    expect(start).toBeGreaterThan(-1);
    expect(split).toBeGreaterThan(start);
    expect(source.slice(start, split)).not.toMatch(/dropLink|ruleOn|rateEdge|qualifyEdge/);
    const row = source.slice(split, end);
    expect(row).toContain('askDropLink(chosenEdge)');
    expect(row).toContain('rateEdge(chosenEdge.id');
    expect(row).toContain('qualifyEdge(chosenEdge,');
  });

  it('asks before a stated edge is removed, and not before a proposal', () => {
    // The panel is opened to read an edge, and Remove sat beside Confirm and the rating —
    // two controls that write nothing — as the one permanent act that asked nothing.
    // Nothing holds a removed edge: re-filing one mints a new id, date and author.
    expect(source).toContain('const words = retractionWarning(edge);');
    expect(source).toContain('if (words) retractingEdge = { id: edge.id, words };');
    expect(source).toContain('else dropLink(edge.id);');
    expect(source).toContain('onconfirm={() => dropLink(retractingEdge.id)}');
  });

  it('says where a folded type lives when it cannot be handed back', () => {
    // The safeguard's fold: this reading does not draw a note at all, so the panel
    // names the lens that does instead of offering an act it would refuse.
    expect(source).toContain('{#if chosenEdge.folded.open?.length}');
    expect(source).toContain('My work draws {chosenEdge.folded.via.join');
  });

  it('reads the independence off the edges, in the toolbar and on the statement', () => {
    // Three citations are not three sources when one account published all three.
    expect(source).toContain('payload.single_account > 0');
    expect(source).toContain('{payload.single_account} on one account');
    expect(source).toContain('Rests on {chosen.rests.sources} source');
    // It measures and concludes nothing, so it is marked rather than coloured as a
    // fault: whether it is a problem is the analyst's to say.
    expect(source).toContain('{#if chosen.rests.one}<em>all one account</em>{/if}');
  });

  it('reaches the set the number names instead of only counting it', () => {
    // A count that names a set and gives no way to it sends the analyst opening
    // statements one at a time to find out which ones it meant.
    expect(source).toContain('onclick={showResting}');
    expect(source).toContain('aria-pressed={singling}');
    expect(source).toMatch(/function showResting\(\) \{\s*singling = !singling;/);
  });

  it('lights those statements and one hop, which is where the finding is', () => {
    // The sources are folded into the edges, so the statement and what its edges
    // reach is the shape being reported.
    expect(source).toMatch(
      /const singled = \$derived\.by[\s\S]{0,600}?node\.rests\?\.one/,
    );
    expect(source).toContain('if (resting.has(link.from)) near.add(link.to);');
    // Collected into a second set: growing the one being read would turn the one hop
    // this promises into two.
    expect(source).toContain('const near = new Set(resting);');
  });

  it('fades nothing when the drawing holds no such statement', () => {
    // An empty narrowing fades the whole case, which answers the press with a
    // picture saying the opposite of what was asked.
    expect(source).toContain('if (!resting.size) return null;');
  });

  it('gives up the typed name rather than answering with an unchanged picture', () => {
    // A search outranks this question, so leaving one on would make the press do
    // nothing at all.
    expect(source).toMatch(/singling = !singling;\s*if \(singling\) find = '';/);
  });

  it('says in words what the number means, and how to undo the press', () => {
    expect(source).toContain(
      'These cite several sources, but one account published every one of them.',
    );
    expect(source).toContain('Click again to bring the rest of the case back.');
  });

  it('ranks the question under a search and over the selection', () => {
    expect(source).toMatch(/if \(found\.size\) return found;\s*if \(singled\) return singled;/);
  });

  it('lets it go with Escape, before the handful it costs nothing to rebuild', () => {
    expect(source).toMatch(/else if \(singling\) singling = false;\s*else if \(held\.length\)/);
  });
});

describe('what is drawn is chosen by role, then by family', () => {
  it('reads the types a lens leaves out rather than keeping a copy of the roles', () => {
    // A lens narrows nodes by role: what the analyst wrote is the filing rather than
    // the case. The roles live on the server, so a copy here would go stale the day a
    // type is added.
    expect(source).toContain(
      "const lensHides = $derived(lenses.find((entry) => entry.id === lens)?.hides ?? [])",
    );
    // A legend row whose every member this reading leaves out is a switch with
    // nothing behind it.
    expect(source).toContain('if (lensHides.includes(type)) continue');
  });

  it('switches a family off from the legend, where the colours are already read', () => {
    // The lens decides the reading; the family decides the budget. On a case larger
    // than the budget one family dwarfs the rest, and this is what spends it elsewhere.
    expect(source).toContain('function toggleFamily(family)');
    expect(source).toContain('let hiddenFamilies = $state([])');
    expect(source).toContain('aria-pressed={row.on}');
  });

  it('resolves families to types on the way out, as the Board does', () => {
    // The family layer is server vocabulary, so it resolves here rather than
    // needing a route of its own, and the catalog read already speaks types.
    expect(source).toContain('const familyTypes = $derived.by');
    expect(source).toContain('const legend = familyTypes.split(\',\');');
    // ...and it narrows a handed-over type set rather than replacing it: a legend
    // switch that widened the question it was applied to would do the opposite of
    // what it says, and an allow-list with nothing in it is a real, empty answer
    expect(source).toContain('legend.filter((type) => asked.includes(type))');
    expect(source).toContain('params.type = both.length ? both.join(\',\') : NOTHING;');
  });

  it('resolves against the types the case holds, not the registry\'s', () => {
    // A free-typed entity has no declared family, so an allowlist built from the
    // registry would drop it the moment any family was switched off.
    expect(source).toContain('caseTypes.length ? caseTypes :');
    expect(source).toContain('return !family || !hiddenFamilies.includes(family)');
  });

  it('keeps the last family on, since a blank canvas reads as the whole case', () => {
    // An empty type list is "no narrowing" server-side, so switching everything
    // off would draw the case back — a control doing the opposite of what it says.
    expect(source).toContain('if (!off && hiddenFamilies.length >= caseFamilies.length - 1) return');
  });

  it('lists the families the case holds, so one switched off can be switched back', () => {
    // Read off the drawing, a family disappears the moment it is left out, taking
    // the only control that could bring it back with it.
    expect(source).toContain('const caseFamilies = $derived.by');
    expect(source).toContain('caseTypes = Object.keys(body.by_type ?? {})');
  });

  it('reloads when a family or the folder changes', () => {
    expect(source).toMatch(/pickFolder,\s*hiddenFamilies\.join\(','\),/);
  });

  it('uses Search+ for the same typed, review, folder and field question as the Board', () => {
    expect(source).toMatch(
      /const params = \{\s*lens,\s*order,\s*\.\.\.searchTerms,\s*\.\.\.\(catalogViews\.snapshotId \? \{\} : temporalTerms\),\s*\};/
    );
    expect(source).toContain('bind:filter={searchFilter}');
    expect(source).toContain('if (pickFolder && !params.folder) params.folder = pickFolder;');
  });
});

describe('a question handed over by the Board', () => {
  it('is applied as the terms it was asked in, so any size of answer survives', () => {
    // a list of ids would be capped and would go stale; a question is something the
    // case can be asked again, and this one is spelled for this route already. The
    // fact-time window rides with it, except on a snapshot, which already answered.
    expect(source).toMatch(
      /const params = \{\s*lens,\s*order,\s*\.\.\.searchTerms,\s*\.\.\.\(catalogViews\.snapshotId \? \{\} : temporalTerms\),\s*\};/
    );
  });

  it('is announced over the drawing, with one press back to the case', () => {
    // a picture that silently answers somebody else's question looks broken
    expect(source).toContain('{#if fromBoard}');
    expect(source).toContain("fromBoard.label || 'A question from the Board'");
    expect(source).toContain('Show the whole case');
  });

  it('is taken out of the hand-off as it is read, so it cannot re-apply itself', () => {
    expect(source).toContain('uiState.drawInGraph = null;');
    expect(source).toContain('uiState.openGraphEntity = null;');
  });

  it('arrives on the whole case, never inside a neighbourhood', () => {
    // a question about the case answered with one node's surroundings is a different
    // question
    expect(source).toMatch(/uiState\.drawInGraph = null;[\s\S]{0,260}root = null;/);
  });

  it('refits the view, because it is a new question rather than a growth', () => {
    expect(source).toContain('JSON.stringify(searchTerms),');
  });
});

describe('the way back to the table', () => {
  it('reads a node in the Board, which is the half the hand-over was missing', () => {
    expect(source).toContain('uiState.openBoardEntity = chosen.id;');
    expect(source).toContain('In the Board');
  });
});

describe('filing from the drawing', () => {
  it('puts a new entity where the gesture aimed, on the empty space', () => {
    // the empty space used to answer a right-click with nothing, which made the
    // drawing a thing to read rather than a place to work
    expect(source).toContain('blank = { x: at.x, y: at.y, at: toCanvas(at) };');
    expect(source).toContain('New entity here');
    expect(source).toContain('creating = { at: blank.at, caseId: caseState.current?.id };');
  });

  it('files it once, through the arrival the search already uses', () => {
    // the reading effect sees `kept` change and reads the case once; reading here as
    // well would be two requests for one act
    expect(source).toContain('bringing = entity.id;');
    expect(source).toContain('holdOn([entity.id]);');
  });

  it('leaves stating the relation to the gesture that already does it', () => {
    // creating something and saying what it is are two acts, and the drawing already
    // has one for the second: file the entity, then connect it by hand
    expect(source).not.toContain('Connect to a new entity');
    expect(source).toContain('Connect to…');
  });

  it('takes a file dropped on the canvas, at the spot it was dropped', () => {
    expect(source).toContain('ondrop=');
    expect(source).toContain('importDropped(event.dataTransfer?.files');
    expect(source).toContain('/media/upload');
    expect(source).toContain('Drop to file it here');
  });

  it('keeps the creation off the drawing’s undo stack, and offers its own way back', () => {
    // a single stack mixing "I hid a node" with "I filed an entity" would write to the
    // case on the fourth press to get a view back
    expect(source).toContain("label: 'Undo',");
    expect(source).toContain('onClick: () => dropEntity(entity, caseId),');
    expect(source).toContain('async function dropEntity(entity, caseId = caseState.current?.id)');
    expect(source).toContain('api.del(`/api/cases/${cid}/entities/${entity.id}`)');
  });

  it('draws what it filed and pins it, which are edits to the view', () => {
    expect(source).toContain('holdOn([entity.id]);');
    expect(source).toContain('pins.set(entity.id, { x: at.x, y: at.y });');
    expect(source).toContain('dropNode(entity.id);');
  });

  it('says beforehand when this reading would not draw what is being filed', () => {
    expect(source).toContain('hidden={lensHides}');
    expect(source).toContain('This reading does not draw that type. My work does.');
  });

  it('shares the one create dialog rather than growing a second form', () => {
    expect(source).toContain("import EntityCreate from '../components/EntityCreate.svelte'");
  });
});

describe('a named live graph', () => {
  it('captures and restores its own arrangement and camera', () => {
    expect(source).not.toContain('delete graph.arrangement');
    expect(source).toContain('replaceViewArrangement(saved.arrangement ?? [], view.id)');
    expect(source).toContain("graph.camera = group");
    expect(source).toContain('cameraRevision += 1');
  });

  it('keeps view pins out of the case-wide pin routes', () => {
    expect(source).toMatch(
      /function dropNode\(id\)[\s\S]{0,500}?if \(ownsViewArrangement\(\)\)[\s\S]{0,160}?return;[\s\S]{0,220}?pending\.set\(id, spot\)/,
    );
    expect(source).toMatch(
      /async function unpinNode\(id\)[\s\S]{0,500}?if \(ownsViewArrangement\(\)\)[\s\S]{0,180}?return;[\s\S]{0,180}?api\.del/,
    );
    expect(source).toContain('node.pin ? { ...node, pin: null } : node');
  });

  it('tracks repeated drawing and camera edits for debounced autosave', () => {
    expect(source).toContain('let arrangementSaveRevision = $state(0)');
    expect(source).toContain('void arrangementSaveRevision');
    expect(source).toContain('catalogViews.changeVersion += 1');
  });
});

describe('a frozen analysis snapshot', () => {
  it('stays on its captured surface and opens retained details without writing', () => {
    expect(source).toContain('const snapshotReading = $derived(Boolean(catalogViews.snapshotId || payload?.snapshot))');
    expect(source).toContain('const canArrange = $derived(!root && !snapshotReading)');
    expect(source).toContain('disabled={snapshotReading}');
    expect(source).toContain('if (snapshotReading) return;');
    expect(source).toContain('{#if openId && !snapshotReading}');
    expect(source).toContain('>Captured details</button>');
    expect(source).toContain('<Modal title="Snapshot details"');
    expect(source).toContain('<SnapshotDetails');
    expect(source).toContain('{#if !snapshotReading}<button');
    expect(source).toContain('if (!from || !to)');
  });
});

describe('the canvas menu stays open', () => {
  it('ignores the release of the press that opened it', () => {
    // Konva reports a `click` on any button, so without this the right-click that
    // opened the menu closed it again on release, and it could only be read while
    // the button was held down
    expect(source).toContain("if (event?.evt?.button === 2 || event?.evt?.ctrlKey) return;");
  });
});

describe('what a control says it does', () => {
  const tooltips = () =>
    [...source.matchAll(/title="([^"{}]+)"/g)].map((match) => match[1]);

  it('says one thing per tooltip', () => {
    // A tooltip that runs to two sentences is a paragraph on a hover: the second
    // one is read by nobody and the first is what the control does.
    const wordy = tooltips().filter((text) => /\.\s+\S/.test(text));

    expect(wordy).toEqual([]);
  });

  it('states the guarantee on the act that needs it, and nowhere else', () => {
    // Undo, Reset view, Unfold and Collapse all used to end by promising the case
    // was untouched. Said five times it stops being read; said once, on the act
    // whose name sounds like a delete, it lands.
    const reassuring = tooltips().filter((text) =>
      /nothing (is|was) (deleted|hidden)|case is not touched/i.test(text)
    );

    expect(reassuring).toEqual([]);
    expect(source).toContain('Out of the drawing, not out of the case');
  });

  it('spells one act one way, wherever it is offered', () => {
    // Hide is offered on the panel, in the node menu and over a gathered handful.
    // Three wordings for one act read as three behaviours.
    const hiding = tooltips().filter((text) => text.includes('not out of the case'));

    expect(new Set(hiding).size).toBe(1);
    expect(hiding.length).toBeGreaterThan(1);
  });
});

describe('Ctrl+V on the drawing', () => {
  it('draws a pasted screenshot or link where the eye already is', () => {
    expect(source).toContain("import { listenForPaste, pasteImage, resolvePaste } from '../lib/clipboardPaste.js'");
    expect(source).toContain("import PasteDialog from '../components/PasteDialog.svelte'");
    expect(source).toContain("resolvePaste('graph', payload)");
    // a paste has no pointer position the way a drop does, so the viewport centre
    // is the honest spot
    expect(source).toContain('toCanvas({ x: width / 2, y: height / 2 })');
  });

  it('files it through the same arrival a created node uses', () => {
    // drewIn pins, reads once and offers Undo — a second path would be a second
    // set of rules about what happens after something is filed
    expect(source).toContain('drewIn(result.entity, at, cid)');
    expect(source).toContain('drewIn(entity, at, cid)');
  });

  it('only answers while it is the tool on screen', () => {
    expect(source).toMatch(/uiState\.tool !== 'graph'\) return;\s*return listenForPaste/);
  });

  it('refuses to write into a frozen reading, and says why', () => {
    expect(source).toContain("say('This snapshot is read-only. Leave it to paste.')");
    expect(source).toContain('{#if pasted && !snapshotReading}');
  });
});

describe('opening a saved view of the other surface', () => {
  it('draws the shared question where it stands, rather than opening the Board', () => {
    const body = source.slice(
      source.indexOf('async function openAnalysisView'),
      source.indexOf('async function leaveAnalysisReading'),
    );
    expect(body).toContain("if (view.surface !== 'graph') return;");
    // No tool switch here. The one on a node's panel stays: that one is asked for.
    expect(body).not.toContain('uiState.tool');
    // The mirror is what carries the question across, and it runs while hidden.
    expect(source).toContain('untrack(() => (searchFilter = normalizeFilter(analysisSearch.filter)))');
  });
});

describe('exporting the drawing', () => {
  it('serialises the scene the canvas is built from, rather than the canvas', () => {
    // No `toDataURL`, no second layout: the same placement, bends and byId the Konva
    // stage reads go to `lib/graphPlate.js`, which is why a plate cannot drift.
    expect(source).toContain('graphPlate({');
    expect(source).toContain('placed,\n      edges,\n      bends,\n      byId,');
    expect(source).toContain('hidden: hiding');
    expect(source).not.toContain('stage.toDataURL');
  });

  it('carries the reading, not just the picture', () => {
    expect(source).toContain("surface: 'Graph'");
    expect(source).toContain('lens: lensLabel');
    expect(source).toContain('question: searchSaid');
    expect(source).toContain('families: legend.filter((entry) => entry.on && entry.count)');
    expect(source).toContain('strokes,');
  });

  it('says how many nodes the folds and the focus are holding back', () => {
    // A narrowed picture presented as the whole case is the one lie a plate could tell,
    // and the drawing resizes to what is left either way — so both have to be written.
    expect(source).toContain('node${foldedCount === 1');
    expect(source).toContain('node${outsideFocus === 1');
    expect(source).toContain('placed.reduce((count, node) => count + (hiding.has(node.id) ? 0 : 1), 0)');
  });

  it('offers the export beside the saved views', () => {
    expect(source).toContain('<PlateExport surface="graph" plate={capturePlate}');
  });
});
