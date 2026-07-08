/**
 * Inspector module registry — the frontend extension seam.
 *
 * Add a mini-tool by writing a Svelte component under tools/inspect/ and
 * appending one entry here:
 *   { id, label, icon, kinds, component }
 *   - kinds: which source media kinds the module applies to ('image' | 'video')
 *
 * Each module receives props:
 *   { source, probeInfo, shared, mediaList, onProduced }
 *   - source      : the selected media item ({ path, filename, kind, ... })
 *   - probeInfo   : dimensions / duration / fps from /inspect/probe
 *   - shared      : reactive bridge to the viewer (filter, transform, crop,
 *                   cropMode, currentTime, seekTo)
 *   - mediaList   : all case media (for modules that pick several images)
 *   - onProduced  : call with the API result after filing a new derivative
 */
import FramesModule from '../tools/inspect/FramesModule.svelte';
import AdjustModule from '../tools/inspect/AdjustModule.svelte';
import CollageModule from '../tools/inspect/CollageModule.svelte';
import AnalyzeModule from '../tools/inspect/AnalyzeModule.svelte';

export const INSPECT_MODULES = [
  { id: 'frames', label: 'Frames', icon: 'video', kinds: ['video'], component: FramesModule },
  { id: 'adjust', label: 'Adjust', icon: 'sliders', kinds: ['image'], component: AdjustModule },
  { id: 'collage', label: 'Collage', icon: 'layers', kinds: ['image', 'video'], component: CollageModule },
  { id: 'analyze', label: 'Analyze', icon: 'eye', kinds: ['image'], component: AnalyzeModule },
];
