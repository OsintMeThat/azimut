import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The guards in Inspect that a render test cannot easily reach: work that returns
 * after the file it was started for has closed, a save sent while the page goes,
 * and the one route every preview is rendered through. Behaviour is driven in
 * `Inspector.render.test.js`.
 */
const source = readFileSync(new URL('./Inspector.svelte', import.meta.url), 'utf8');

describe('Inspect — work that outlives the file it was started for', () => {
  it('drops a frame whose file was closed while it rendered', () => {
    // A capture is two round trips. The frame is evidence, so one that returns
    // after the analyst switched file must not land in the file now open.
    expect(source).toMatch(/async function capture\(time\) \{[\s\S]*?const run = openRun;/);
    expect(source).toMatch(/const dim = await imageSize\(url\);\s*\n\s*if \(run !== openRun\) return;/);
    expect(source).toMatch(/function closeFile\(\) \{\s*\n\s*openRun \+= 1;/);
  });

  it('saves to the case the work was opened in, even after the case changed', () => {
    expect(source).toContain('await api.put(`/api/cases/${work.caseId}/inspect/work`');
    expect(source).toContain('if (work.caseId && work.caseId !== caseState.current?.id) closeFile();');
  });

  it('writes before letting go of a file', () => {
    expect(source).toMatch(/async function open\(item\) \{[\s\S]*?await autosave\.flush\(\);/);
    expect(source).toContain("if (uiState.tool !== 'inspect') {\n      autosave.flush();");
    expect(source).toContain('$effect(() => () => autosave.flush());');
  });

  it('sends a pending save with the page as it closes', () => {
    expect(source).toContain('<svelte:window onkeydown={onWindowKeydown} {onpagehide} />');
    expect(source).toContain('if (autosave.pending) writeWork({ keepalive: true }).catch(() => {});');
  });

  it('files nothing for a file that was only looked at', () => {
    expect(source).toContain('if (!work.name && isPristine(work, filters, videoFilters)) return;');
  });
});

describe('Inspect — crop keys', () => {
  it('lets Escape leave the crop it found rather than applying the new one', () => {
    expect(source).toContain("if (e.key === 'Enter') { e.preventDefault(); commitCrop(); }");
    expect(source).toContain("else if (e.key === 'Escape') { e.preventDefault(); cancelCrop(); }");
    expect(source).toContain('if (activeFrame) activeFrame.crop = cropBefore;');
    expect(source).toContain('cropBefore = activeFrame.crop ? { ...activeFrame.crop } : null;');
  });
});

describe('Inspect → Reverse Search', () => {
  it('hands the frame over as it reads here, rendered without filing it', () => {
    expect(source).toContain(
      'const blob = await renderBlob(frame.path, frame.time, buildFrameOps(filters, frame));'
    );
    expect(source).toContain('openInReverseSearch({ blob, label:');
    expect(source).toContain('reverse={reverseFrame}');
  });

  it('keeps one render route for frames, previews and the handoff', () => {
    expect(source.match(/inspect\/render-preview/g)).toHaveLength(1);
  });
});

describe('Inspect — words', () => {
  it('no longer speaks of sessions to open, name or discard', () => {
    const markup = source.slice(source.indexOf('</script>'));
    expect(markup).not.toMatch(/session/i);
    expect(markup).not.toContain('Discard');
  });
});
