<script>
  /** A map page drawn small: its title over a map, the panel of its layers beside it. */
  let { width = 120, picture = '' } = $props();
</script>

<span class="thumb" style:width={`${width}px`} aria-hidden="true">
  <span class="head"><i></i><i class="short"></i></span>
  <span class="body">
    <span class="map" style:background-image={picture ? `url("${picture}")` : null}>
      {#if !picture}<i class="road"></i><b style="left:30%;top:36%"></b><b style="left:52%;top:58%" class="two"></b><b style="left:66%;top:30%" class="three"></b>{/if}
    </span>
    <span class="panel"><i></i><i></i><i class="short"></i><i></i></span>
  </span>
</span>

<style>
  .thumb { display: flex; flex-direction: column; flex: none; align-self: flex-start; aspect-ratio: 16 / 10; overflow: hidden; border-radius: 3px; background: #0f1012;
    box-shadow: 0 1px 2px rgba(0, 0, 0, .35), 0 0 0 1px rgba(255, 255, 255, .08); }
  .head { display: flex; flex-direction: column; gap: 2px; padding: 5% 6% 4%; border-bottom: 1px solid rgba(255, 255, 255, .12); }
  .head i { display: block; width: 55%; height: 3px; border-radius: 2px; background: rgba(255, 255, 255, .8); }
  .head i.short { width: 35%; height: 2px; background: rgba(255, 255, 255, .35); }
  .body { flex: 1; display: flex; min-height: 0; }
  .map { position: relative; flex: 1; background: #4a5a4c linear-gradient(140deg, #5b6b55, #3d4a45 60%, #2f3b44); background-size: cover; background-position: center; }
  .road { position: absolute; left: 8%; right: 20%; top: 48%; height: 2px; background: #3b9be0; transform: rotate(-14deg); }
  .map b { position: absolute; width: 7px; height: 7px; margin: -3.5px; border: 1.5px solid #fff; border-radius: 50%; background: #e53935; }
  .map b.two { background: #ff9800; }
  .map b.three { background: #b0bec5; }
  .panel { display: flex; flex-direction: column; gap: 4px; width: 28%; padding: 6% 5%; border-left: 1px solid rgba(255, 255, 255, .12); }
  .panel i { display: block; height: 2px; border-radius: 2px; background: rgba(255, 255, 255, .4); }
  .panel i.short { width: 60%; }
</style>
