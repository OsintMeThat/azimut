/**
 * Which of the Saved tab's groups are open, kept while the app is open.
 *
 * A routine run every few days soon has dozens of runs, so a routine's group
 * opens folded to one line that sums it up; the passes swept once open unfolded,
 * each being its own piece of work. A group opened or shut stays so through a
 * switch of tab or tool, and the next visit starts from the defaults again.
 */
const open = $state({});

/** Whether a group shows its runs: as the analyst left it, or its kind's default. */
export const isOpen = (id, byDefault) => open[id] ?? byDefault;

/** Open or shut one group. */
export function setOpen(id, value) {
  open[id] = value;
}
