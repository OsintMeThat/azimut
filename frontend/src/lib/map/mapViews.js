export function layerLegend(layers) {
  return layers.filter((layer) => layer.enabled).flatMap((layer) => {
    const groups = (layer.categories ?? []).filter((group) => !layer.hidden?.includes(group.name));
    return (layer.categories?.length ? groups.map((group) => ({ label: `${layer.title} · ${group.name}`.slice(0, 200), colour: group.colour || '#0072b2' }))
      : [{ label: layer.title.slice(0, 200), colour: '#0072b2' }]);
  });
}

export function captureMapView({ engine, provider, rows, layers, title, note = '', showLegend = true }) {
  const visible = layers.filter((layer) => layer.enabled);
  return { title, note, show_legend: showLegend, provider, camera: engine.camera(),
    overlays: rows.filter((row) => row.on && !row.disabled).map((row) => row.id),
    layers: visible.map((layer) => ({ name: layer.name, hidden: [...(layer.hidden ?? [])] })),
    legend: layerLegend(layers),
  };
}

export async function applyMapView(view, { caseId, api, layers, scope, rows, engine, onprovider, currentCase = () => caseId }) {
  const checkOwner = () => { if (currentCase() !== caseId) throw new Error('The case changed while opening this map'); };
  checkOwner();
  const existing = new Set(scope.rows.map((layer) => layer.name));
  const missing = view.layers.filter((layer) => !existing.has(layer.name));
  const selected = new Map(view.layers.filter((layer) => existing.has(layer.name)).map((layer) => [layer.name, layer]));
  const order = [...selected.keys(), ...layers.rows.map((layer) => layer.name).filter((name) => !selected.has(name))];
  if (await layers.reorder(caseId, order) === false) throw new Error('The layer order could not be restored');
  checkOwner();
  for (const row of scope.rows) {
    const saved = selected.get(row.name);
    if (saved) {
      const changed = await api.patch(`/api/cases/${caseId}/map-layers/${encodeURIComponent(row.name)}`, { hidden: saved.hidden });
      checkOwner();
      layers.edited(caseId, changed);
    }
    if (row.enabled !== !!saved) await scope.toggle(caseId, row);
    checkOwner();
  }
  for (const row of rows) if (!row.disabled && row.on !== view.overlays.includes(row.id)) row.toggle();
  await onprovider(view.provider);
  checkOwner();
  engine.setCamera(view.camera);
  return missing;
}
