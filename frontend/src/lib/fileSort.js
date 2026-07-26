/** Stable sorting helpers for the Files details view. */

function textOf(value) {
  return String(value ?? '');
}

function compareText(a, b) {
  return textOf(a).localeCompare(textOf(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function compareNullable(a, b, compare) {
  const aMissing = a == null;
  const bMissing = b == null;
  if (aMissing || bMissing) {
    if (aMissing && bMissing) return 0;
    return aMissing ? 1 : -1;
  }
  return compare(a, b);
}

/**
 * Return a sorted copy of entity rows. Missing Size/Added values stay at the
 * end in either direction, like a desktop file manager.
 */
export function sortFileEntities(
  items,
  { sort = 'name', direction = 'asc', sizeOf = () => null } = {}
) {
  const sign = direction === 'desc' ? -1 : 1;
  const out = [...items];
  const name = (item) => item.label ?? '';
  const primary = (a, b) => {
    if (sort === 'type') return compareText(a.type, b.type);
    if (sort === 'size') return compareNullable(sizeOf(a), sizeOf(b), (x, y) => x - y);
    if (sort === 'recent') {
      return compareNullable(
        a.provenance?.at,
        b.provenance?.at,
        (x, y) => compareText(x, y)
      );
    }
    return compareText(name(a), name(b));
  };

  out.sort((a, b) => {
    const valueOf = (item) => {
      if (sort === 'size') return sizeOf(item);
      if (sort === 'recent') return item.provenance?.at;
      return null;
    };
    const aValue = valueOf(a);
    const bValue = valueOf(b);
    if ((sort === 'size' || sort === 'recent') && (aValue == null || bValue == null)) {
      if (aValue == null && bValue == null) return 0;
      return aValue == null ? 1 : -1;
    }
    const result = primary(a, b);
    if (result) return result * sign;
    if (sort !== 'name') return compareText(name(a), name(b));
    return 0;
  });
  return out;
}
