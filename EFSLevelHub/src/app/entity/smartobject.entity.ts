/**
 * Smart objects
 * -------------
 * A smart object is a hard-coded, multi-tile item (e.g. a decoration such as a
 * tree) that can be stamped onto a room in one action. Unlike plain tiles, a
 * placement is also recorded in the stage's JSON so the editor keeps a semantic
 * reference to it.
 *
 * Tile coordinates in a definition are **offsets** relative to the placement
 * anchor (the top-left of the object's bounding box). A tile offset may be
 * negative (e.g. a canopy that overhangs to the left of the anchor).
 *
 * The selectable definition catalog lives in `smartobject.definition.ts`; this
 * module re-exports it so callers have a single import for smart objects.
 */

import { ImageBuffer, TILE_SIZE } from '../service/render/gba-tile-renderer';
import { ActorData } from './fsalib.entity';
import { GroundLayer, ROOM_DIMENSION } from './ground.entity';
import {
  SmartObjectDefinition,
  SmartObjectTileOffset,
  SmartObjectVariant,
} from './smartobject.definition';

export {
  SMART_OBJECT_DEFINITIONS,
  findSmartObjectDefinition,
  registerActorSmartObjects,
} from './smartobject.definition';
export type {
  SmartObjectDefinition,
  SmartObjectSection,
  SmartObjectTileOffset,
  SmartObjectBaking,
  SmartObjectVariant,
} from './smartobject.definition';

/**
 * Returns the variant (rotation style) a definition uses for the given index,
 * falling back to the first variant (the default, e.g. north for a door) when
 * the index is missing or out of range.
 */
export function smartObjectVariant(
  definition: SmartObjectDefinition,
  variantIndex = 0,
): SmartObjectVariant {
  return definition.set[variantIndex] ?? definition.set[0];
}

/** A tile coordinate recorded for a placed smart object (absolute, in-room). */
export interface SmartObjectTileRef {
  /** Absolute tile row within the room (0-31). */
  row: number;
  /** Absolute tile column within the room (0-31). */
  col: number;
}

/**
 * A smart-object placement recorded in the stage JSON.
 *
 * Stores the placement anchor (the tile the object was dropped on) plus the
 * absolute tile coordinates that were written (per layer), so the editor can
 * later resolve, move or remove it without re-deriving the definition.
 */
export interface SmartObjectPlacement {
  /** Definition id (see {@link SMART_OBJECT_DEFINITIONS}). */
  id: string;
  /**
   * Index of the variant (rotation style) within the definition's `set` that
   * was stamped. Defaults to 0 (the object's default rotation, e.g. north).
   */
  variantIndex?: number;
  /**
   * Base layer the object was placed on (0-7). Its paired top layer is
   * `baseLayerId + 8`. Recorded so the object can be resolved, moved or
   * removed independently of the editor's currently active layer.
   */
  baseLayerId: number;
  /** Anchor tile row the object was placed at (offsets are relative to this). */
  anchorRow: number;
  /** Anchor tile column the object was placed at. */
  anchorCol: number;
  /** Absolute tile coordinates written to the base layer (`baseLayerId`). */
  bottomLayerTiles: SmartObjectTileRef[];
  /** Absolute tile coordinates written to the paired top layer (`baseLayerId + 8`). */
  topLayerTiles: SmartObjectTileRef[];
  /**
   * For actor-baked objects (enemies): the actor `Variable` value used when
   * placed. Undefined for tile-baked objects.
   */
  actorVariable?: number;
  /**
   * Child placements attached to this one.
   *
   * Children are rendered and baked exactly like top-level placements but are
   * **not directly selectable** — they cannot be hovered, grabbed, moved or
   * deleted on their own; they follow their parent and are removed with it.
   * Used e.g. to attach a `WARP` actor to a door when connecting two doors.
   */
  children?: SmartObjectPlacement[];
}

/**
 * Everything recorded for a single room in the stage JSON, keyed by the room's
 * grid position. Mirrors the `rooms` array in the stage JSON.
 */
export interface RoomSmartObjects {
  /** Room row within the stage's room grid. */
  row: number;
  /** Room column within the stage's room grid. */
  col: number;
  /**
   * Everything placed in this room — tile-baked decorations **and** actor-baked
   * enemies. Enemies live in the archive's enemy list (written on save) but are
   * recorded here too, so the room has a single, truthful placement list.
   */
  smartObjects: SmartObjectPlacement[];
  /** Ground layers painted in this room, one entry per base layer. */
  ground?: GroundLayer[];
}

/** The 16 tile layers of a room (indices 0-7 base, 8-15 top). */
export interface SmartObjectTargetLayer {
  Tiles: number[];
}

/**
 * Applies a smart-object definition to a room's layers at the given anchor,
 * returning the placement (absolute tile coordinates written per layer).
 *
 * Tiles whose target falls outside the room (0-31) are skipped. The base layer
 * index is `baseLayerIndex`; its paired top layer is `baseLayerIndex + 8`.
 */
export function applySmartObject(
  definition: SmartObjectDefinition,
  anchorRow: number,
  anchorCol: number,
  layers: SmartObjectTargetLayer[],
  baseLayerIndex = 0,
  variantIndex = 0,
): SmartObjectPlacement {
  const variant = smartObjectVariant(definition, variantIndex);
  const placement: SmartObjectPlacement = {
    id: definition.id,
    variantIndex,
    baseLayerId: baseLayerIndex,
    anchorRow,
    anchorCol,
    bottomLayerTiles: [],
    topLayerTiles: [],
    // Actor-baked objects record the variable used; tile-baked ones leave it off.
    ...(definition.baking === 'actor' ? { actorVariable: definition.actorVariable ?? 0 } : {}),
  };

  const write = (
    offsets: SmartObjectTileOffset[],
    layerIndex: number,
    refs: SmartObjectTileRef[],
  ): void => {
    const layer = layers[layerIndex];
    if (!layer) {
      return;
    }
    for (const offset of offsets) {
      const row = anchorRow + offset.dRow;
      const col = anchorCol + offset.dCol;
      if (row < 0 || row >= ROOM_DIMENSION || col < 0 || col >= ROOM_DIMENSION) {
        continue;
      }
      layer.Tiles[row * ROOM_DIMENSION + col] = offset.tile;
      refs.push({ row, col });
    }
  };

  write(variant.bottomLayerTiles, baseLayerIndex, placement.bottomLayerTiles);
  write(variant.topLayerTiles, baseLayerIndex + 8, placement.topLayerTiles);
  return placement;
}

/** Clears a placement's tiles from a room's layers (used before moving it). */
export function clearSmartObject(
  placement: SmartObjectPlacement,
  layers: SmartObjectTargetLayer[],
  baseLayerIndex = placement.baseLayerId ?? 0,
): void {
  for (const ref of placement.bottomLayerTiles) {
    const layer = layers[baseLayerIndex];
    layer?.Tiles && (layer.Tiles[ref.row * ROOM_DIMENSION + ref.col] = 0);
  }
  for (const ref of placement.topLayerTiles) {
    const layer = layers[baseLayerIndex + 8];
    layer?.Tiles && (layer.Tiles[ref.row * ROOM_DIMENSION + ref.col] = 0);
  }
}

/**
 * Converts an actor-baked placement into an {@link ActorData} room record.
 *
 * Actors are stored in HALF-TILE coordinates. The actor's coordinate is the
 * **top-left** of its anchor tile (`tile * 2`), matching EFSAdvent; the sprite
 * itself is drawn bottom-centre anchored from there.
 */
export function placementToActor(placement: SmartObjectPlacement): ActorData {
  return {
    Id: placement.id,
    Layer: placement.baseLayerId,
    X: placement.anchorCol * 2,
    Y: placement.anchorRow * 2,
    Variable: placement.actorVariable ?? 0,
  };
}

/** Actor id of the warp smart object. */
export const WARP_ACTOR_ID = 'WARP';

/**
 * A resolved warp link: a `WARP` actor and the tile it teleports to.
 *
 * The actor's `Variable` packs the destination:
 * - byte 1 (bits 0-7)   — warp type / style (see `WARP.json`),
 * - byte 2 (bits 8-15)  — destination tile **Y** (0 = the actor's own tile),
 * - byte 3 (bits 16-23) — destination tile **X** (0 = the actor's own tile),
 * - byte 4 bits 0-2     — destination base layer (0-7).
 *
 * Coordinates are stored in the same units as the actor (`variableByte *
 * ACTOR_PIXELS_PER_COORDINATE`, i.e. half-tiles where the tile is `value / 2`).
 */
export interface WarpLink {
  /** Starting tile (the warp actor's anchor tile). */
  fromRow: number;
  fromCol: number;
  /** Base layer the warp actor sits on (0-7). */
  fromLayer: number;
  /** Destination tile. */
  toRow: number;
  toCol: number;
  /** Destination base layer (0-7). */
  toLayer: number;
  /** Warp type/style (byte 1); drives the line colour. */
  type: number;
  /** Local activation variable (byte 4 bits 3-7); 0 = always active. */
  activationVariable: number;
}

/** Extracts the four variable bytes (1-4) of a little-endian actor variable. */
function actorVariableBytes(variable: number): { b1: number; b2: number; b3: number; b4: number } {
  const v = variable >>> 0;
  return {
    b1: v & 0xff,
    b2: (v >>> 8) & 0xff,
    b3: (v >>> 16) & 0xff,
    b4: (v >>> 24) & 0xff,
  };
}

/**
 * Resolves every `WARP` actor in a list into a {@link WarpLink}, so the room
 * editor can draw a line from each warp to where it teleports (possibly on a
 * different base layer).
 *
 * A destination of 0/0 means "stay on the actor's own tile" (the game then uses
 * the actor position), matching EFSAdvent's `DrawActor`.
 */
export function warpLinks(actors: readonly ActorData[]): WarpLink[] {
  const links: WarpLink[] = [];
  for (const actor of actors) {
    if (actor.Id !== WARP_ACTOR_ID) {
      continue;
    }
    const { b1, b2, b3, b4 } = actorVariableBytes(actor.Variable);
    const isZero = b2 === 0 && b3 === 0;
    // Actor X/Y are HALF-TILES where the tile is `value / 2`; the destination
    // bytes are in the same half-tile unit when non-zero.
    const fromRow = Math.floor(actor.Y / 2);
    const fromCol = Math.floor(actor.X / 2);
    const toRow = isZero ? fromRow : b2 / 2;
    const toCol = isZero ? fromCol : b3 / 2;
    links.push({
      fromRow,
      fromCol,
      fromLayer: actor.Layer & 0x07,
      toRow,
      toCol,
      toLayer: b4 & 0x07,
      type: b1,
      activationVariable: b4 >> 3,
    });
  }
  return links;
}

/** The inverse of {@link placementToActor}: an actor record back to a placement. */
export function actorToPlacement(actor: ActorData): SmartObjectPlacement {
  const anchorCol = Math.floor(actor.X / 2);
  const anchorRow = Math.floor(actor.Y / 2);
  return {
    id: actor.Id,
    variantIndex: 0,
    baseLayerId: actor.Layer & 0x0f,
    anchorRow,
    anchorCol,
    bottomLayerTiles: [],
    topLayerTiles: [],
    actorVariable: actor.Variable,
  };
}

/**
 * Flattens a placement list including every child (recursively), returning the
 * root placements followed by their descendants.
 *
 * Children are baked and rendered like any other placement, so most consumers
 * (actor sync, tile baking, rendering) work on the flattened list while
 * interaction (hover/grab/delete) stays restricted to the roots.
 */
export function flattenPlacements(
  placements: readonly SmartObjectPlacement[],
): SmartObjectPlacement[] {
  const out: SmartObjectPlacement[] = [];
  const visit = (placement: SmartObjectPlacement): void => {
    out.push(placement);
    for (const child of placement.children ?? []) {
      visit(child);
    }
  };
  for (const placement of placements) {
    visit(placement);
  }
  return out;
}

/**
 * Updates a placement's `children` array (matched by identity), returning a new
 * root list. Used to attach/detach a child (e.g. a connecting `WARP` actor)
 * without mutating the shared placement objects.
 */
export function withChildren(
  placement: SmartObjectPlacement,
  children: SmartObjectPlacement[] | undefined,
): SmartObjectPlacement {
  const { children: _omit, ...rest } = placement;
  return children && children.length > 0 ? { ...rest, children } : { ...rest };
}

/**
 * Builds a `WARP` actor placement that connects a source door to a destination,
 * suitable for attaching as a child of the source door.
 *
 * The actor's `Variable` packs the destination (see {@link WarpLink}):
 * `type | destY<<8 | destX<<16 | destLayer<<24` where the destination tile
 * coordinates are stored in **half-tiles** (`tile * 2`), matching the actor
 * coordinate space.
 *
 * @param sourceLayer  Base layer the source door (and thus the warp) sits on.
 * @param sourceRow    Source door's anchor tile row (where the warp actor sits).
 * @param sourceCol    Source door's anchor tile column.
 * @param destRow      Destination tile row (the target door's anchor).
 * @param destCol      Destination tile column.
 * @param destLayer    Destination base layer.
 * @param type         Warp type/style byte (see `WARP.json`).
 */
export function createWarpChild(
  sourceLayer: number,
  sourceRow: number,
  sourceCol: number,
  destRow: number,
  destCol: number,
  destLayer: number,
  type = 0,
): SmartObjectPlacement {
  const variable =
    ((type & 0xff) |
      (((destRow * 2) & 0xff) << 8) |
      (((destCol * 2) & 0xff) << 16) |
      ((destLayer & 0x07) << 24)) >>>
    0;
  return {
    id: WARP_ACTOR_ID,
    variantIndex: 0,
    baseLayerId: sourceLayer,
    anchorRow: sourceRow,
    anchorCol: sourceCol,
    bottomLayerTiles: [],
    topLayerTiles: [],
    actorVariable: variable,
  };
}

/**
 * Reads a `WARP` actor placement's destination tile, or null when it does not
 * encode one (a zero destination means "the actor's own tile").
 */
export function warpChildDestination(
  placement: SmartObjectPlacement,
): { row: number; col: number; layer: number } | null {
  if (placement.id !== WARP_ACTOR_ID) {
    return null;
  }
  const { b2, b3, b4 } = actorVariableBytes(placement.actorVariable ?? 0);
  if (b2 === 0 && b3 === 0) {
    return null;
  }
  return { row: b2 / 2, col: b3 / 2, layer: b4 & 0x07 };
}

/**
 * Bounding box (in tiles) of a definition's tiles relative to its anchor,
 * including negative offsets. Used to size previews and hit-test drags.
 */
export function smartObjectBounds(
  definition: SmartObjectDefinition,
  variantIndex = 0,
): {
  minRow: number;
  minCol: number;
  maxRow: number;
  maxCol: number;
  rows: number;
  cols: number;
} {
  const variant = smartObjectVariant(definition, variantIndex);
  const all = [...variant.bottomLayerTiles, ...variant.topLayerTiles];
  let minRow = 0;
  let minCol = 0;
  let maxRow = 0;
  let maxCol = 0;
  for (const t of all) {
    minRow = Math.min(minRow, t.dRow);
    minCol = Math.min(minCol, t.dCol);
    maxRow = Math.max(maxRow, t.dRow);
    maxCol = Math.max(maxCol, t.dCol);
  }
  return {
    minRow,
    minCol,
    maxRow,
    maxCol,
    rows: maxRow - minRow + 1,
    cols: maxCol - minCol + 1,
  };
}

/**
 * Renders a definition's tiles into a fresh RGBA buffer, sized to its bounding
 * box (top-layer tiles drawn over bottom-layer tiles). Transparent where empty.
 *
 * @param drawTile Callback that rasterizes one tile id at (px, py) into the
 *                 buffer (typically `StageRenderer.drawTilesetTile`).
 */
export function renderSmartObjectPreview(
  definition: SmartObjectDefinition,
  drawTile: (target: ImageBuffer, px: number, py: number, tileId: number) => void,
  variantIndex = 0,
): ImageBuffer {
  const variant = smartObjectVariant(definition, variantIndex);
  const bounds = smartObjectBounds(definition, variantIndex);
  const width = bounds.cols * TILE_SIZE;
  const height = bounds.rows * TILE_SIZE;
  const buffer = new ImageBuffer(width, height);
  buffer.fill(0, 0, 0, 0);

  const stamp = (tiles: SmartObjectTileOffset[]): void => {
    for (const t of tiles) {
      const px = (t.dCol - bounds.minCol) * TILE_SIZE;
      const py = (t.dRow - bounds.minRow) * TILE_SIZE;
      drawTile(buffer, px, py, t.tile);
    }
  };

  stamp(variant.bottomLayerTiles);
  stamp(variant.topLayerTiles);
  return buffer;
}
