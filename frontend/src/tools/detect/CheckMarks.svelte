<script>
  /**
   * The pins of the check on the map: a filled ring where a candidate should
   * come out and a struck ring where none should, green or red once the check
   * has been tested with the rules as they stand. A press on one reads the
   * rules under it, to turn it or take it away. While a pin is armed the map
   * takes the click instead, so a pin can be dropped beside another.
   */
  let { engine, pins = [], armed = false, selected = null, onpick = () => {} } = $props();

  let revision = $state(0);
  $effect(() => {
    if (!engine) return;
    return engine.on('view-move', () => revision++);
  });
  const placed = $derived.by(() => {
    revision;
    return pins.map((pin, index) => ({
      ...pin,
      index,
      at: engine?.latLngToContainerPoint({ lon: pin.point[0], lat: pin.point[1] }) ?? { x: 0, y: 0 },
    }));
  });
  const words = (pin) => `${pin.expect === 'found' ? 'Should be found' : 'Should stay empty'}${
    pin.ok === true ? ', and it is' : pin.ok === false ? ', and it is not' : ''}`;
</script>

{#each placed as pin (pin.index)}
  <button type="button" class="mark pin-{pin.expect}" class:pass={pin.ok === true} class:fail={pin.ok === false}
    class:selected={selected === pin.index} class:armed
    style:left={`${pin.at.x}px`} style:top={`${pin.at.y}px`} title={words(pin)} aria-label={`Pin ${pin.index + 1}: ${words(pin)}`}
    onclick={() => onpick(pin.index)}></button>
{/each}

<style>
  .mark {
    --ring: #f8fafc;
    position: absolute;
    z-index: 555;
    width: 18px;
    height: 18px;
    padding: 0;
    transform: translate(-50%, -50%);
    border: 2px solid var(--ring);
    border-radius: 50%;
    background: transparent;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.65), 0 1px 5px rgb(0 0 0 / 0.45);
    cursor: pointer;
    transition: transform 0.12s var(--ease), box-shadow 0.12s var(--ease);
  }
  .mark.armed { pointer-events: none; }
  .mark:hover { transform: translate(-50%, -50%) scale(1.15); }
  .mark.selected { box-shadow: 0 0 0 1px rgb(0 0 0 / 0.65), 0 0 0 4px rgb(255 255 255 / 0.35); }
  .mark:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .mark.pass { --ring: #4ade80; }
  .mark.fail { --ring: #f87171; }
  .mark.pin-found::after {
    position: absolute;
    inset: 4px;
    border-radius: 50%;
    background: var(--ring);
    content: '';
  }
  .mark.pin-empty { border-style: dashed; }
  .mark.pin-empty::after {
    position: absolute;
    top: 50%;
    left: -2px;
    width: 18px;
    height: 2px;
    background: var(--ring);
    transform: rotate(-45deg);
    content: '';
  }
</style>
