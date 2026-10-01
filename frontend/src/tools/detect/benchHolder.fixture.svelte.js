/**
 * Where a test finds the bench the panel builds an analyzer on. The map reads
 * it through `bind:builder`; `BenchPanel.fixture.svelte` hands it on to here,
 * so a test can do what the console over the map does: pick a check, drop a pin.
 */
export const holder = $state({ bench: null });
