/**
 * Shared sorting helpers for lists that expose a name and a creation date
 * (stages, worlds, …). Used by the reusable sort dropdown component so every
 * list sorts identically.
 */

/** A field a list can be sorted by. */
export type SortField = 'creationDate' | 'name';

/** Sort direction. */
export type SortDirection = 'asc' | 'desc';

/** A concrete sort selection. */
export interface SortState {
  field: SortField;
  direction: SortDirection;
}

/** Default sort: newest first. */
export const DEFAULT_SORT: SortState = { field: 'creationDate', direction: 'desc' };

/** One entry of the sort dropdown (a labelled {@link SortState}). */
export interface SortOption {
  /** Stable id, e.g. `creationDate:desc`. */
  id: string;
  /** Label shown in the dropdown. */
  label: string;
  state: SortState;
}

/** The standard options offered everywhere: creation date and name, asc/desc. */
export const SORT_OPTIONS: SortOption[] = [
  {
    id: 'creationDate:desc',
    label: 'Newest first',
    state: { field: 'creationDate', direction: 'desc' },
  },
  {
    id: 'creationDate:asc',
    label: 'Oldest first',
    state: { field: 'creationDate', direction: 'asc' },
  },
  { id: 'name:asc', label: 'Name (A–Z)', state: { field: 'name', direction: 'asc' } },
  { id: 'name:desc', label: 'Name (Z–A)', state: { field: 'name', direction: 'desc' } },
];

/** Returns a copy of `items` sorted by the given state (never mutates). */
export function sortItems<T extends { name: string; creationDate?: string }>(
  items: readonly T[],
  state: SortState,
): T[] {
  const factor = state.direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    if (state.field === 'name') {
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * factor;
    }
    // Missing dates sort as oldest.
    const aDate = a.creationDate ?? '';
    const bDate = b.creationDate ?? '';
    return aDate.localeCompare(bDate) * factor;
  });
}
