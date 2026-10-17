/**
 * Doors
 * -----
 * Door-specific rules for the room editor.
 *
 * A **door** is a tile-baked smart object in the `Doors` section. Two doors can
 * be *connected*: the **source** door owns a child `WARP` actor whose `Variable`
 * encodes the destination tile + layer, and the **target** door records a
 * `connectedFrom` back-reference to the source's tile. The warp uses one of the
 * auto-return "Default … Entrance" types (25/26/27/28), so a connection needs
 * only the single warp on the source door.
 *
 * Everything in this module is **pure** — it takes placements (and a way to
 * resolve their definitions) and returns new placement lists, without touching
 * the room layers, the canvas or any Angular service. That lets the canvas
 * (interaction: hit-testing, drag, drawing) and the host page (persistence:
 * dirty tracking, JSON) share ONE implementation of the door rules instead of
 * each re-deriving them.
 *
 * The low-level `WARP` actor primitives (`createWarpChild`, `repointWarpChild`,
 * `warpChildDestination`, `warpLinks`, `WARP_ACTOR_ID`) live in
 * `smartobject.entity.ts` because they describe a generic actor child; this
 * module layers the door semantics on top of them.
 */

import {
  SmartObjectDefinition,
  SmartObjectPlacement,
  WARP_ACTOR_ID,
  createWarpChild,
  flattenPlacements,
  repointWarpChild,
  smartObjectBounds,
  warpChildDestination,
  withChildren,
} from './smartobject.entity';

/** Toolbox section a door belongs to (doors are tile-baked smart objects). */
export const DOOR_SECTION = 'Doors';

/**
 * Warp types for a connected door, indexed by the door's variant (rotation):
 * `0 → 25` (north, the default), `1 → 27` (east), `2 → 26` (south), `3 → 28`
 * (west). These are the "Default North/South/East/West Entrance" types from
 * `WARP.json`, which always auto-return — that is what makes a two-way door
 * work without a second warp on the other end.
 */
export const DOOR_WARP_TYPES = [25, 27, 26, 28] as const;

/**
 * Whether a definition is a **door** — a tile-baked object in the `Doors`
 * section. The single source of truth for every "is this a door?" question.
 */
export function isDoorDefinition(definition: SmartObjectDefinition | undefined): boolean {
  return definition?.baking === 'tile' && definition.section === DOOR_SECTION;
}

/**
 * The `WARP` actor child that connects a door to another door, or `undefined`.
 * A door is a connection **source** iff it has one.
 */
export function warpChildOf(placement: SmartObjectPlacement): SmartObjectPlacement | undefined {
  return (placement.children ?? []).find((child) => child.id === WARP_ACTOR_ID);
}

/** Whether a placement has a `connectedFrom` back-reference (it is a target). */
export function isConnectionTarget(placement: SmartObjectPlacement): boolean {
  return placement.connectedFrom !== undefined;
}

/** Whether a placement is part of a connection, as source or target. */
export function isConnected(placement: SmartObjectPlacement): boolean {
  return warpChildOf(placement) !== undefined || isConnectionTarget(placement);
}

/**
 * The warp type byte that matches a door variant (rotation):
 * `0 → 25` (north), `1 → 27` (east), `2 → 26` (south), `3 → 28` (west).
 *
 * These are the auto-return "Default … Entrance" types, so the destination
 * door does not need its own warp to send the player back.
 */
export function warpTypeForVariant(variantIndex: number): number {
  return DOOR_WARP_TYPES[variantIndex % DOOR_WARP_TYPES.length];
}

/**
 * Returns a copy of `placement` whose `WARP` child is replaced by `warp` (or
 * removed when null). Other children (if any) are preserved.
 */
export function withWarpChild(
  placement: SmartObjectPlacement,
  warp: SmartObjectPlacement | null,
): SmartObjectPlacement {
  const others = (placement.children ?? []).filter((child) => child.id !== WARP_ACTOR_ID);
  return withChildren(placement, warp ? [...others, warp] : others);
}

/**
 * Whether a warp destination lands on `placement`'s door.
 *
 * Destinations are **centred** on the target footprint, so they are frequently
 * fractional (e.g. tile 13.5 for a 2×2 door anchored at row 13). Comparing the
 * whole tile the destination falls in keeps every lookup working whether the
 * warp was centred or wrote the bare anchor.
 */
export function destinationTargets(
  dest: { row: number; col: number; layer: number },
  placement: SmartObjectPlacement,
): boolean {
  return (
    Math.floor(dest.row) === placement.anchorRow &&
    Math.floor(dest.col) === placement.anchorCol &&
    dest.layer === (placement.baseLayerId ?? 0)
  );
}

/**
 * Finds the door that owns a `WARP` child pointing at `target` — i.e. the
 * **source** of `target`'s connection — or null. The warp destination is
 * authoritative, so this works even when the target's back-reference is absent
 * or stale.
 */
export function findSourceOf(
  target: SmartObjectPlacement,
  placements: readonly SmartObjectPlacement[],
): SmartObjectPlacement | null {
  for (const placement of placements) {
    const child = warpChildOf(placement);
    if (!child) {
      continue;
    }
    const dest = warpChildDestination(child);
    if (dest && destinationTargets(dest, target)) {
      return placement;
    }
  }
  return null;
}

/**
 * Finds the door a **source** door's warp points at, or null. The warp
 * destination is authoritative for the other end of a connection.
 */
export function findTargetOf(
  source: SmartObjectPlacement,
  placements: readonly SmartObjectPlacement[],
): SmartObjectPlacement | null {
  const child = warpChildOf(source);
  const dest = child ? warpChildDestination(child) : null;
  if (!dest) {
    return null;
  }
  return placements.find((entry) => destinationTargets(dest, entry)) ?? null;
}

/** A single placement update: the original plus its replacement. */
export interface DoorPlacementChange {
  from: SmartObjectPlacement;
  to: SmartObjectPlacement;
}

/** The changes {@link connectDoors} produces. */
export interface DoorConnectionChange {
  /** The updated source door (owns the warp child). */
  source: DoorPlacementChange;
  /** The updated target door (records the back-reference). */
  target: DoorPlacementChange;
}

/**
 * Connects two doors **both ways**: each door gets its own `WARP` actor child
 * pointing at the other door's anchor tile + layer.
 *
 * The warp sits at the door's OWN anchor (the game draws a warp at
 * `X*8, Y*8` — no centring) and its type follows the source door's facing, so
 * the entrance direction matches the sprite. The type used is an auto-return
 * "Default … Entrance" one (25/26/27/28), which already brings the player back
 * — a connection therefore needs only this ONE warp.
 *
 * The target additionally records a `connectedFrom` back-reference so the
 * editor can select/disconnect the connection from either end.
 *
 * Pure: returns `{from,to}` pairs; the caller decides where to store them.
 */
/**
 * Connects two doors: the **source** door gets a child `WARP` actor pointing at
 * the target door's anchor tile + layer, and the target records a
 * `connectedFrom` back-reference so the connection can be managed from either
 * end.
 *
 * The warp actor sits on the source door's **centre**: actors are positioned in
 * half-tiles, so a 2×2 door gets `+1/+1` (its true centre) rather than sitting
 * on the anchor's top-left corner. Its **destination** is likewise centred on
 * the target door's footprint, so the player arrives in the middle of the door
 * rather than on its top-left corner.
 *
 * The warp type follows the source door's facing (25/26/27/28, the auto-return
 * "Default … Entrance" styles).
 *
 * Pure: returns `{from,to}` pairs; the caller decides where to store them.
 *
 * @param sourceDefinition Optional source-door definition, used to centre the
 *   warp in the source door's footprint.
 * @param targetDefinition Optional target-door definition, used to centre the
 *   destination in the target door's footprint.
 */
export function connectDoors(
  source: SmartObjectPlacement,
  target: SmartObjectPlacement,
  sourceDefinition?: SmartObjectDefinition,
  targetDefinition?: SmartObjectDefinition,
): DoorConnectionChange {
  const centreOf = (
    definition: SmartObjectDefinition | undefined,
    placement: SmartObjectPlacement,
  ): { dx: number; dy: number } => {
    if (!definition) {
      return { dx: 0, dy: 0 };
    }
    const bounds = smartObjectBounds(
      definition,
      placement.variantIndex ?? 0,
      placement.subTypeIndex ?? 0,
    );
    // Half-tile offset from the anchor corner to the footprint's centre.
    return {
      dx: Math.floor(bounds.cols / 2),
      dy: Math.floor(bounds.rows / 2),
    };
  };

  const sourceCentre = centreOf(sourceDefinition, source);
  const targetCentre = centreOf(targetDefinition, target);

  // Destination is stored in HALF-TILES, so the target's tile anchor plus its
  // centre offset lands the player on the target door's real centre.
  const warp = createWarpChild(
    source.baseLayerId,
    source.anchorRow,
    source.anchorCol,
    target.anchorRow + targetCentre.dy / 2,
    target.anchorCol + targetCentre.dx / 2,
    target.baseLayerId,
    warpTypeForVariant(source.variantIndex ?? 0),
    sourceCentre.dx,
    sourceCentre.dy,
  );
  return {
    source: { from: source, to: withWarpChild(source, warp) },
    target: {
      from: target,
      to: {
        ...target,
        connectedFrom: {
          row: source.anchorRow,
          col: source.anchorCol,
          layer: source.baseLayerId ?? 0,
        },
      },
    },
  };
}

/**
 * Removes the connection a door is part of, from **either** end:
 * - as a **source**: its `WARP` child is dropped and the target's
 *   `connectedFrom` back-reference is cleared;
 * - as a **target**: the source door's warp is cleared and this door's own
 *   back-reference is removed.
 *
 * Returns the `{from,to}` updates for every placement that changed (0, 1 or 2
 * entries) — empty when the door was not connected.
 */
export function disconnectDoor(
  placement: SmartObjectPlacement,
  placements: readonly SmartObjectPlacement[],
): DoorPlacementChange[] {
  const changes: DoorPlacementChange[] = [];

  if (warpChildOf(placement)) {
    // Source: drop the warp child, clear the target's back-reference.
    const target = findTargetOf(placement, placements);
    const updated = withWarpChild(placement, null);
    changes.push({ from: placement, to: updated });
    if (target?.connectedFrom) {
      changes.push({ from: target, to: { ...target, connectedFrom: undefined } });
    }
    return changes;
  }

  if (placement.connectedFrom) {
    // Target: clear our back-reference, drop the source's warp child.
    changes.push({ from: placement, to: { ...placement, connectedFrom: undefined } });
    const source = findSourceOf(placement, placements);
    if (source) {
      changes.push({ from: source, to: withWarpChild(source, null) });
    }
  }
  return changes;
}

/**
 * Detaches **every** connection involving `deleted`, in both directions:
 * - doors whose `WARP` child pointed at `deleted` (it was a target), and
 * - the door `deleted`'s own warp pointed at (it was a source), whose
 *   `connectedFrom` back-reference is cleared.
 *
 * Returns the `{from,to}` updates for the OTHER placements (the deleted one is
 * not included). Use this when a door is removed so no dangling warp line is
 * left behind.
 */
export function detachConnections(
  deleted: SmartObjectPlacement,
  placements: readonly SmartObjectPlacement[],
): DoorPlacementChange[] {
  const changes: DoorPlacementChange[] = [];

  // Other doors -> deleted (deleted was a target).
  for (const other of placements) {
    if (other === deleted) {
      continue;
    }
    const child = warpChildOf(other);
    const dest = child ? warpChildDestination(child) : null;
    if (child && dest && destinationTargets(dest, deleted)) {
      const others = (other.children ?? []).filter((c) => c !== child);
      changes.push({
        from: other,
        to: { ...other, children: others.length > 0 ? others : undefined },
      });
    }
  }

  // deleted -> its target (deleted was a source): clear the back-reference.
  const own = warpChildOf(deleted);
  const ownDest = own ? warpChildDestination(own) : null;
  if (ownDest) {
    const target = placements.find((entry) => destinationTargets(ownDest, entry));
    if (target?.connectedFrom) {
      changes.push({ from: target, to: { ...target, connectedFrom: undefined } });
    }
  }

  return changes;
}

/**
 * The changes a moved door requires on the OTHER end of its connection.
 */
export interface DoorMoveChange {
  /** Doors whose `connectedFrom` should be updated (source moved). */
  references: DoorPlacementChange[];
  /** Doors whose `WARP` child must be re-pointed (target moved). */
  repointed: DoorPlacementChange[];
}

/**
 * Re-derives both ends of a connection after a door moved.
 *
 * - If the moved door is a **target**, any source whose warp pointed at its old
 *   anchor is re-pointed at the new one (`repointed`).
 * - If the moved door is a **source**, its target's `connectedFrom`
 *   back-reference is updated to the source's new position (`references`).
 *
 * Note the warp *destination* is unchanged when the source moves (it still
 * points at the target), so only the recorded source anchor needs refreshing.
 *
 * When the moved door is a **target** and its `definition` is supplied, the
 * re-pointed destination is re-centred on the target's footprint so it keeps
 * arriving in the middle of the door.
 *
 * Pure: returns `{from,to}` updates for the caller to apply.
 */
export function reanchorConnections(
  before: SmartObjectPlacement,
  after: SmartObjectPlacement,
  placements: readonly SmartObjectPlacement[],
  definition?: SmartObjectDefinition,
): DoorMoveChange {
  const references: DoorPlacementChange[] = [];
  const repointed: DoorPlacementChange[] = [];

  // Half-tile offset from the moved door's anchor corner to its centre.
  const centre = definition
    ? (() => {
        const bounds = smartObjectBounds(
          definition,
          after.variantIndex ?? 0,
          after.subTypeIndex ?? 0,
        );
        return {
          dx: Math.floor(bounds.cols / 2),
          dy: Math.floor(bounds.rows / 2),
        };
      })()
    : { dx: 0, dy: 0 };
  const destRow = after.anchorRow + centre.dy / 2;
  const destCol = after.anchorCol + centre.dx / 2;

  // Target moved: re-point every warp that still points at the OLD anchor.
  for (const other of placements) {
    // Skip the moved door itself, matched by IDENTITY **or** by its new
    // position (the caller may already have swapped it in the list).
    if (other === before || other === after) {
      continue;
    }
    if (
      other.anchorRow === after.anchorRow &&
      other.anchorCol === after.anchorCol &&
      (other.baseLayerId ?? 0) === (after.baseLayerId ?? 0) &&
      warpChildOf(other) === warpChildOf(after)
    ) {
      continue;
    }
    const child = warpChildOf(other);
    const dest = child ? warpChildDestination(child) : null;
    if (
      !child ||
      !dest ||
      // The stored destination may be centred, so match the whole tile the
      // target occupied rather than requiring an exact half-tile equality.
      Math.floor(dest.row) !== before.anchorRow ||
      Math.floor(dest.col) !== before.anchorCol ||
      dest.layer !== (before.baseLayerId ?? 0)
    ) {
      continue;
    }
    const updatedChild = repointWarpChild(
      child,
      destRow,
      destCol,
      after.baseLayerId ?? 0,
    );
    repointed.push({
      from: other,
      to: {
        ...other,
        children: (other.children ?? []).map((c) => (c === child ? updatedChild : c)),
      },
    });
  }

  // Source moved: refresh its target's back-reference. The destination in our
  // own `WARP` child still points at the target (which did not move), so it is
  // intentionally left untouched.
  const own = warpChildOf(after);
  const ownDest = own ? warpChildDestination(own) : null;
  if (ownDest) {
    const target = placements.find(
      (entry) =>
        entry !== before && entry !== after && destinationTargets(ownDest, entry),
    );
    if (target?.connectedFrom) {
      references.push({
        from: target,
        to: {
          ...target,
          connectedFrom: {
            row: after.anchorRow,
            col: after.anchorCol,
            layer: after.baseLayerId ?? 0,
          },
        },
      });
    }
  }

  return { references, repointed };
}

/**
 * Advances the warp type of `placement`'s `WARP` child so the entrance
 * direction follows the sprite facing (north → east → south → west, i.e. types
 * 21 → 23 → 22 → 24). A door with no connection is returned unchanged.
 *
 * When `definition` is supplied the child's half-tile centre is recomputed too,
 * because rotating a door can change its footprint (the big door is 6×2 ↔ 2×6).
 */
export function withRotatedWarpType(
  placement: SmartObjectPlacement,
  variantIndex: number,
  definition?: SmartObjectDefinition,
): SmartObjectPlacement {
  const child = warpChildOf(placement);
  if (!child) {
    return placement;
  }
  const type = warpTypeForVariant(variantIndex);
  const variable = ((child.actorVariable ?? 0) & ~0xff) | (type & 0xff);
  let updatedChild: SmartObjectPlacement = { ...child, actorVariable: variable >>> 0 };
  if (definition) {
    const bounds = smartObjectBounds(
      definition,
      variantIndex,
      placement.subTypeIndex ?? 0,
    );
    const centreDx = Math.floor(bounds.cols / 2);
    const centreDy = Math.floor(bounds.rows / 2);
    if (centreDx !== 0 || centreDy !== 0) {
      updatedChild = { ...updatedChild, halfTileDx: centreDx, halfTileDy: centreDy };
    } else {
      const { halfTileDx: _dx, halfTileDy: _dy, ...rest } = updatedChild;
      updatedChild = rest;
    }
  }
  const children = (placement.children ?? []).map((c) => (c === child ? updatedChild : c));
  return { ...placement, children };
}

/**
 * Re-exported so door consumers (the canvas' connect-line drawing, the page's
 * actor keying) can resolve warp destinations without importing the generic
 * smart-object module as well.
 */
export { WARP_ACTOR_ID, warpChildDestination };
