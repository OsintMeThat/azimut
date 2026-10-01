<script>
  /** Stands in for MapSurface in tests: no WebGL, just the bindings the tool reads. */
  let { engine = $bindable(null), element = $bindable(null), ready = $bindable(false), providerId = $bindable(''),
    chrome = true, armed = null, controlsTop = 0 } = $props();

  $effect(() => {
    engine = { fake: true, resize() {} };
    ready = true;
  });
</script>

<div class="stub" data-provider={providerId} data-chrome={String(chrome)} data-armed={String(armed)} data-top={controlsTop}></div>
