/**
 * Props a test can change after mounting: a plain object would hand the
 * component its first values and never tell it of the next ones.
 */
export function liveProps(initial) {
  const props = $state(initial);
  return props;
}
