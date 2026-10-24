<script>
  /**
   * The style button for what is selected in a personal layer, or for the next
   * markers when nothing is (`lib/map/layerStyle.js` says which). The edit bar
   * and the feature sheet both carry it.
   */
  import LayerStyleButton from './LayerStyleButton.svelte';
  import { splitPick, styleTarget, usedStyles } from '../../lib/map/layerStyle.js';

  /** `regroup`: whether the picker also moves features between groups, off where a Group row sits beside it. */
  let { controller, label = 'Style', size = 20, disabled = false, regroup = true, onopen = null } = $props();
  const groups = $derived(controller.groups ?? []);
  const selection = $derived(controller.selection ?? []);
  const chosen = $derived(controller.features.filter((feature) => selection.includes(feature.properties.key)));
  const target = $derived(styleTarget({ chosen, groups, into: controller.group, draft: controller.draft }));
  const used = $derived(usedStyles(controller.features, groups, { point: target.point }));

  function pick(changes) {
    if (target.uniform) return controller.updateGroup(target.uniform.id, changes);
    // a group in one colour takes the colour, its features the icon
    const { group, own } = target.tinted ? splitPick(changes) : { group: {}, own: changes };
    if (Object.keys(group).length) controller.updateGroup(target.tinted.id, group);
    if (!Object.keys(own).length) return;
    if (chosen.length) return controller.updateSelection(own);
    Object.assign(controller.draft, own);
  }
  function move(id) {
    if (chosen.length) controller.updateSelection({ group: id });
    else controller.group = id;
  }
</script>

<LayerStyleButton {label} {size} {used} {groups} {disabled}
  symbol={target.symbol} colour={target.colour} icon={target.icon ?? ''} point={target.point} mixed={target.mixed} note={target.note}
  layer={controller.editor?.name ?? null} meta={controller.icons}
  group={target.group} groupLabel={chosen.length ? 'Group' : 'Add to'} ongroup={regroup ? move : null}
  title={chosen.length ? 'Style' : 'Style of the next markers'}
  caseId={controller.editor?.caseId ?? null} onpick={pick} {onopen} />
