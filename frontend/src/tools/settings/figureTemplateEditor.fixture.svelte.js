/**
 * The figure template editor's props for its tests: held in `$state` as Settings holds its
 * draft, so what the editor writes through `bind:data` lands where the test reads it.
 */
export function editorProps(data) {
  const props = $state({ data });
  return props;
}
