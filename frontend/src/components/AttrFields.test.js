import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AttrFields.svelte', import.meta.url), 'utf8');

describe('generated fields', () => {
  it('renders whatever the registry declares rather than a form per type', () => {
    expect(source).toContain(
      "import { entityFields, withHeadings } from '../lib/entityTypes.svelte.js'"
    );
    expect(source).toContain('const fields = $derived(entityFields(type))');
    expect(source).toContain('{#each shown as field (field.key)}');
  });

  it('reads each field with the editor its kind asks for', () => {
    expect(source).toContain("{:else if field.kind === 'number'}");
    expect(source).toContain("{:else if field.kind === 'choice'}");
    expect(source).toContain("{:else if field.kind === 'temporal'}");
    expect(source).toContain("import TemporalInput from './TemporalInput.svelte'");
    expect(source).toContain('<TemporalInput');
    expect(source).toContain("{:else if field.kind === 'geojson'}");
    expect(source).not.toContain("field.kind === 'flag'");
    expect(source).toContain("type={field.kind === 'url' ? 'url' : 'text'}");
  });

  it('carries the registry bounds onto the input, so the form refuses what the API does', () => {
    expect(source).toContain('min={field.minimum ?? undefined}');
    expect(source).toContain('max={field.maximum ?? undefined}');
  });

  it('can leave fields to a dedicated Details tab without changing the registry', () => {
    expect(source).toContain('exclude = []');
    expect(source).toContain('if (exclude.includes(field.key)) return false;');
  });
});

describe('a field explains what it is for', () => {
  it('carries the registry’s own clause on the label, never one written here', () => {
    expect(source).toContain('title={field.hint}');
  });
});

describe('empty is a value', () => {
  it('clears to null rather than to zero or an empty string', () => {
    // a blank radius means "we do not know how precise this is"; 0 would claim
    // infinite precision, and undefined would be dropped from the body and read
    // as "leave it be"
    expect(source).toContain("values = { ...values, [key]: raw === '' || raw == null ? null : raw }");
    expect(source).toContain("set(key, raw === '' || !Number.isFinite(value) ? null : value)");
  });

  it('says unknown in the placeholder instead of asking for a value', () => {
    expect(source).toContain('placeholder="Unknown"');
    // no field is ever marked required — checked against the markup, since the
    // comment above it uses the word to promise exactly this
    const markup = source.slice(source.indexOf('</script>'));
    expect(markup).not.toMatch(/\brequired\b/);
  });
});

describe('the radius ladder', () => {
  it('offers the rungs the registry serves, never a list of its own', () => {
    expect(source).toContain('{#each field.rungs as rung (rung.value)}');
    expect(source).toContain('onclick={() => toggle(field.key, rung.value)}');
    expect(source).toContain('class:on={values?.[field.key] === rung.value}');
  });

  it('toggles: clicking the chosen rung again clears the field back to unknown', () => {
    // a rung picked by mistake must not force a trip to the metre box, and unknown
    // is a state the analyst is entitled to return to
    expect(source).toContain('set(key, values?.[key] === value ? null : value)');
    expect(source).toContain('aria-pressed={values?.[field.key] === rung.value}');
  });

  it('keeps the metre input beside the rungs, since a rung is a shortcut not a cage', () => {
    expect(source).toContain('type="number"');
  });
});

describe('a closed scale', () => {
  it('offers the options the registry serves, never a scale written here', () => {
    // the Admiralty letters are data: spelling them in the markup is how a picker
    // starts offering a grade the validator refuses
    expect(source).toContain('{#each field.options ?? [] as option (option.value)}');
    expect(source).toContain(
      "option.value.length <= 2 ? `${option.value} · ${option.label}` : option.label"
    );
    expect(source).not.toMatch(/Usually reliable|Cannot be judged/);
  });

  it('leads with a blank option, because ungraded is the normal state', () => {
    expect(source).toContain('<option value="">Unknown</option>');
  });
});

describe('a footprint', () => {
  it('is reported and droppable here, but only the map can trace one', () => {
    expect(source).toContain('footprintSummary(values[field.key])');
    expect(source).toContain('onclick={() => set(field.key, null)}');
  });

  it('is absent from the block entirely until a shape exists', () => {
    // no map offers the tracing gesture yet, so a label over a hint would read as a
    // control that has stopped working
    expect(source).toContain("return field.kind !== 'geojson' || values?.[field.key]");
    const markup = source.slice(source.indexOf('</script>'));
    expect(markup).not.toContain('Drawn on the map.');
  });
});

describe('one block, not loose inputs', () => {
  it('heads the fields with whatever the registry calls them, and nothing when it calls them nothing', () => {
    expect(source).toContain('withHeadings(');
    expect(source).toContain('{#if field.heads}<div class="attrs-h">{field.heads}</div>{/if}');
  });

  it('resolves the headings after the hidden fields are dropped, not before', () => {
    // an untraced footprint hides itself, and a heading resolved before that filter
    // could outlive every field it was heading
    const filtered = source.indexOf('withHeadings(fields.filter(');
    expect(filtered).toBeGreaterThan(-1);
  });

  it('renders nothing at all when no field has anything to show', () => {
    expect(source).toContain('{#if shown.length}');
  });

  it('shows old read-only fields only when a stored value exists', () => {
    expect(source).toContain('if (field.editable === false)');
    expect(source).toContain('<div class="legacy-value">');
    expect(source).toContain('<small>Older field</small>');
  });

  it('lays fields out as a responsive grid instead of a long loose list', () => {
    // `display: contents` put the label, the rungs and the input straight into the
    // host's layout, which is how four fields came out cramped mid-panel
    expect(source).not.toContain('display: contents');
    expect(source).toContain('grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));');
  });

  it('carries its own chip styling, since the class is per-component here', () => {
    const markup = source.slice(source.indexOf('</script>'));
    expect(markup).toContain('class="chip"');
    expect(source).toMatch(/\.chip \{[^}]*border:/);
    expect(source).toMatch(/\.chip\.on \{[^}]*--accent/);
  });
});
