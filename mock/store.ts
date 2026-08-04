// ============================================================================
// MODULE : Mock — Mutable Collection Store
// PURPOSE: Gives the mock layer working create, update and delete, so a Setup
//          screen can actually be used rather than only looked at.
//
//          Phase 5's tenant service deliberately did not mutate its fixture,
//          on the grounds that module state is shared by every request. That
//          reasoning still holds — and this is the answer to it rather than a
//          reversal. The state is explicit, owned by one object, and reset()
//          exists. What changed is the requirement: a directory that only needs
//          reading can be immutable, but a CRUD screen whose "Create" button
//          visibly does nothing cannot be reviewed or tested at all.
//
// SCOPE   : Process-local and in-memory. Edits survive navigation and page
//           refreshes but not a server restart, and every viewer of one dev
//           server shares them. That is the correct trade for a fixture layer;
//           persistence belongs to the database this replaces.
// ============================================================================

/** Minimum an entity must expose for the store to address it. */
interface Identifiable {
  id: string;
}

export interface MockStore<T extends Identifiable> {
  /** Every row, in insertion order. Treat as read-only. */
  all(): T[];
  find(id: string): T | undefined;
  /** Appends and returns the row. Newest-first ordering is the caller's business. */
  insert(row: T): T;
  /** Shallow-merges `patch` into the row. Returns undefined if the id is unknown. */
  update(id: string, patch: Partial<T>): T | undefined;
  /** Returns true if a row was removed. */
  remove(id: string): boolean;
  /** Restores the seed rows, discarding every change. */
  reset(): void;
  /** Next id in the store's sequence, e.g. "cmp_009". */
  nextId(): string;
}

/**
 * Wrap a seed array in a mutable store.
 *
 * The seed is copied rather than referenced, so the exported fixture array
 * stays the pristine baseline that reset() can return to. Sharing the array
 * would make the first delete unrecoverable.
 *
 * @example
 * ```ts
 * const campuses = createMockStore(MOCK_CAMPUSES, "cmp")
 * campuses.insert({ ...input, id: campuses.nextId() })
 * ```
 */
export function createMockStore<T extends Identifiable>(
  seed: readonly T[],
  idPrefix: string,
  idWidth = 3
): MockStore<T> {
  let rows: T[] = [...seed];

  // Continues past the seed's highest number rather than starting at
  // seed.length + 1, so an id is never reused after a delete — a reused id
  // would silently re-point any link still holding the old one.
  let sequence = seed.length;

  return {
    all: () => rows,
    find: (id) => rows.find((row) => row.id === id),

    insert(row) {
      rows.push(row);
      return row;
    },

    update(id, patch) {
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) return undefined;

      const updated = { ...rows[index], ...patch };
      rows[index] = updated;
      return updated;
    },

    remove(id) {
      const before = rows.length;
      rows = rows.filter((row) => row.id !== id);
      return rows.length < before;
    },

    reset() {
      rows = [...seed];
      sequence = seed.length;
    },

    nextId() {
      sequence += 1;
      return `${idPrefix}_${String(sequence).padStart(idWidth, "0")}`;
    },
  };
}
