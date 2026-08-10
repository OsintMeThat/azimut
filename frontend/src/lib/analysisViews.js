export function copyName(name, existing = []) {
  const used = new Set(existing.map((value) => String(value).trim().toLocaleLowerCase()));
  const base = `${String(name).trim()} copy`;
  if (!used.has(base.toLocaleLowerCase())) return base;
  let index = 2;
  while (used.has(`${base} ${index}`.toLocaleLowerCase())) index += 1;
  return `${base} ${index}`;
}
