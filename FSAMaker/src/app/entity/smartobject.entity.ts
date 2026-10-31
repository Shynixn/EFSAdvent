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
import { ACTOR_TEMPLATES, ActorTemplate } from './actor-template.entity';
import { ActorData } from './fsalib.entity';
import { GroundLayer, ROOM_DIMENSION } from './ground.entity';
import { PLAYER_START_DEFINITION } from './smartobject/player-start.entity';
import type { ActivationLink } from './smartobject/activation.entity';
import { GOAL_DEFINITION } from './smartobject/goal.entity';
import { FORCE_GEM_DEFINITION } from './smartobject/force-gem.entity';
import { ITEM_DEFINITIONS } from './smartobject/items.entity';
import { FLOOR_SWITCH_DEFINITION } from './smartobject/switch.entity';
import { withDoorLifecycle } from './contract/placeable-hooks.entity';
import {
  SmartObjectScale,
  expandScaledTiles,
  growScale,
  isScaled,
  scaleOf,
  shrinkScale,
} from './contract/scalable.entity';
import { SMART_OBJECT_DEFINITIONS as ALL_SMART_OBJECT_DEFINITIONS } from './smartobject.definition';
import {
  SmartObjectDefinition,
  SmartObjectTileOffset,
  SmartObjectVariant,
  findSmartObjectDefinition,
  registerActorSmartObjects,
  variantsForSubType,
} from './smartobject.definition';

export {
  SMART_OBJECT_DEFINITIONS,
  findSmartObjectDefinition,
  registerActorSmartObjects,
  resolveSubTypeIndex,
  variantsForSubType,
} from './smartobject.definition';
export { ACTOR_TEMPLATE_SECTIONS, actorTemplatesFor } from './actor-template.entity';
export type { ActorTemplate, ActorTemplateSection } from './actor-template.entity';
export {
  SCALE_DIRECTIONS,
  SCALE_DIRECTION_LABELS,
  canScale,
  expandScaledTiles,
  growScale,
  isScaled,
  resetScale,
  scaleOf,
  shrinkScale,
} from './contract/scalable.entity';
export type {
  IScalable,
  ScaleDirection,
  ScalableSmartObjectDefinition,
  SmartObjectScale,
} from './contract/scalable.entity';
export {
  PLAYER_START_ACTOR_ID,
  PLAYER_START_DEFINITION,
  PLAYER_START_ID,
  PLAYER_COLORS,
  PLAYER_DIRECTIONS,
  PLAYER_STATES,
  decodePlayerStart,
  encodePlayerStart,
  isPlayerStart,
  nextPlayerDirection,
  withPlayerColor,
  withPlayerDirection,
  withPlayerState,
} from './smartobject/player-start.entity';
export type {
  PlayerColor,
  PlayerDirection,
  PlayerStartVariable,
  PlayerState,
} from './smartobject/player-start.entity';
export type {
  SmartObjectDefinition,
  SmartObjectSection,
  SmartObjectSubType,
  SmartObjectTileOffset,
  SmartObjectBaking,
  SmartObjectVariant,
} from './smartobject.definition';

/**
 * Projects an EFSAdvent actor template (Items / NPC / Objects / Special /
 * Switches preset) onto an actor-baked smart-object definition, so it travels
 * through the shared drag/drop + placement pipeline like any other actor.
 *
 * The definition is built from the template alone (no actor catalog needed):
 * the actor id and `Variable` are all that gets baked.
 */
export function toTemplateSmartObject(template: ActorTemplate): SmartObjectDefinition {
  return {
    id: template.id,
    baking: 'actor',
    name: template.name,
    // The template's tab; the definition itself is still an actor placement.
    section: template.section,
    // Actors bake no tiles — one empty variant keeps the shared geometry.
    set: [{ bottomLayerTiles: [], topLayerTiles: [] }],
    actorId: template.actorId,
    actorVariable: template.variable,
  };
}

/** All actor templates as actor-baked smart objects (ids are `template:…`). */
export const ACTOR_TEMPLATE_SMART_OBJECTS: readonly SmartObjectDefinition[] =
  ACTOR_TEMPLATES.map(toTemplateSmartObject);

// Seed the registry so a placed template (`id` = `template:…`) resolves for
// hover, move, delete and of course baking. Runs once at module load; the actor
// catalog registration that happens later adds to the same (additive) registry.
registerActorSmartObjects([
  ...ACTOR_TEMPLATE_SMART_OBJECTS,
  PLAYER_START_DEFINITION,
  GOAL_DEFINITION,
  FORCE_GEM_DEFINITION,
  ...ITEM_DEFINITIONS,
  FLOOR_SWITCH_DEFINITION,
]);

// Install object-specific lifecycle behaviour (see `placeable-hooks.entity.ts`).
// Runs once here because the door module imports this one, so the hooks cannot
// be attached inside the definition catalog itself.
for (const definition of ALL_SMART_OBJECT_DEFINITIONS) {
  withDoorLifecycle(definition);
}
withDoorLifecycle(PLAYER_START_DEFINITION);
withDoorLifecycle(GOAL_DEFINITION);
withDoorLifecycle(FORCE_GEM_DEFINITION);

/**
 * Returns the variant (rotation style) a definition uses for the given index,
 * falling back to the first variant (the default, e.g. north for a door) when
 * the index is missing or out of range.
 *
 * When the placement selects a sub-type (e.g. a door's closed/key style) the
 * sub-type's own variant list is used.
 *
 * When a `scale` is supplied the variant's tiles are EXPANDED by it (see
 * {@link expandScaledTiles}), so a scaled object looks and bakes exactly like
 * the repeated tiles it represents. Every consumer (rendering, previews,
 * hit-testing, ground compositing, baking) goes through this function, so
 * scaling needs no special case anywhere else.
 */
export function smartObjectVariant(
  definition: SmartObjectDefinition,
  variantIndex = 0,
  subTypeIndex = 0,
  scale?: SmartObjectScale,
): SmartObjectVariant {
  const set = variantsForSubType(definition, subTypeIndex);
  const variant = set[variantIndex] ?? set[0];
  if (!isScaled(scale)) {
    return variant;
  }
  return {
    bottomLayerTiles: expandScaledTiles(variant.bottomLayerTiles, scale),
    topLayerTiles: expandScaledTiles(variant.topLayerTiles, scale),
  };
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
   * Growth of a scalable object, per direction, in tiles.
   *
   * A scaled object stays ONE placement: the growth repeats its edge tiles.
   * Undefined until the user picks a direction in the context menu's **Scale**
   * submenu, so untouched objects keep a clean record.
   */
  scale?: SmartObjectScale;
  /**
   * User-assigned name for this placement (the object column's rename action).
   * Undefined until renamed; the object column then falls back to the
   * definition's name. Persisted with the room record.
   */
  name?: string;
  /**
   * Index of the variant (rotation style) within the definition's `set` that
   * was stamped. Defaults to 0 (the object's default rotation, e.g. north).
   */
  variantIndex?: number;
  /**
   * Index of the definition's {@link SmartObjectSubType} selected for this
   * placement (e.g. a door's door / closed-door / key-door style). Defaults to
   * 0 when the definition has no sub-types.
   */
  subTypeIndex?: number;
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
   * Decoded fields of {@link actorVariable}, exposed as separate properties so
   * the debug JSON can be read without decoding the bits by hand.
   *
   * Derived on demand (never persisted) — see {@link withActorProperties}.
   */
  properties?: Record<string, unknown>;
  /**
   * Child placements attached to this one.
   *
   * Children are rendered and baked exactly like top-level placements but are
   * **not directly selectable** — they cannot be hovered, grabbed, moved or
   * deleted on their own; they follow their parent and are removed with it.
   * Used e.g. to attach a `WARP` actor to a door when connecting two doors.
   */
  children?: SmartObjectPlacement[];
  /**
   * Extra half-tile offset applied when converting this placement to an actor
   * (see {@link placementToActor}). Lets an actor sit at a sub-tile position —
   * e.g. a door's `WARP` child centred in a 2×2 door rather than on its anchor.
   *
   * Ignored for tile-baked placements. Defaults to 0.
   */
  halfTileDx?: number;
  halfTileDy?: number;
  /**
   * For a door that is the **target** of a connection: the source door's tile
   * position (its anchor + base layer). The source door owns the `WARP` child
   * that points here, so this back-reference lets the target be selected/moved
   * too — when it moves, the source's warp destination is re-pointed at its new
   * anchor (see `RoomPage.onPlacementUpdated`).
   *
   * `undefined` on doors that are not a connection target.
   */
  connectedFrom?: { row: number; col: number; layer: number };
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
  /**
   * "A activates B" links between activation sources and targets.
   *
   * Not stored in the archive: the game only needs the shared room-local
   * variable number (which IS written into both actors' variables). This record
   * exists so the editor can keep drawing/editing the links. See
   * `smartobject/activation.entity.ts`.
   */
  activationLinks?: ActivationLink[];
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
 *
 * @param actorVariable For actor-baked objects, the `Variable` to record instead
 *   of the definition's default. Pass the existing placement's value when
 *   moving/restamping an actor, otherwise the default would reset user-edited
 *   fields (e.g. the player start's colour/state/facing).
 */
export function applySmartObject(
  definition: SmartObjectDefinition,
  anchorRow: number,
  anchorCol: number,
  layers: SmartObjectTargetLayer[],
  baseLayerIndex = 0,
  variantIndex = 0,
  subTypeIndex = 0,
  actorVariable?: number,
  scale?: SmartObjectScale,
): SmartObjectPlacement {
  const variant = smartObjectVariant(definition, variantIndex, subTypeIndex, scale);
  const placement: SmartObjectPlacement = {
    id: definition.id,
    variantIndex,
    subTypeIndex,
    baseLayerId: baseLayerIndex,
    anchorRow,
    anchorCol,
    bottomLayerTiles: [],
    topLayerTiles: [],
    // Growth is only recorded when the object actually is scaled, so untouched
    // placements keep a clean stage JSON.
    ...(isScaled(scale) ? { scale: scaleOf(scale) } : {}),
    // Actor-baked objects record the variable used; tile-baked ones leave it off.
    ...(definition.baking === 'actor'
      ? { actorVariable: actorVariable ?? definition.actorVariable ?? 0 }
      : {}),
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
    Id: bakedActorId(placement),
    Layer: placement.baseLayerId,
    X: placement.anchorCol * 2 + (placement.halfTileDx ?? 0),
    Y: placement.anchorRow * 2 + (placement.halfTileDy ?? 0),
    Variable: placement.actorVariable ?? 0,
  };
}

/**
 * The **actor id** a placement bakes into the archive.
 *
 * This is the definition's `actorId` when it has one — actor templates are
 * recorded under their own stable id (`template:Items:0`) but bake the actor
 * they encode — otherwise the placement id itself (e.g. a door's `WARP` child).
 *
 * Always use this (not `placement.id`) when comparing a placement with an actor
 * read back from the archive: comparing the placement id makes a recorded
 * template look like a "legacy" actor that was never recorded.
 */
export function bakedActorId(placement: SmartObjectPlacement): string {
  return findSmartObjectDefinition(placement.id)?.actorId ?? placement.id;
}

/** Actor id of the warp smart object. */
export const WARP_ACTOR_ID = 'WARP';

/**
 * Decodes a destination **row** (Y) from a `WARP` variable byte.
 *
 * FSALib defines the fields of `WARP` (`assets/actors/WARP.json`) at:
 * - `Destination Y` — bitOffset 8, 8 bits,
 * - `Destination X` — bitOffset 16, 8 bits,
 *
 * The bytes are stored in **HALF-TILES**, the same coordinate space as
 * `Actor.XCoord` / `Actor.YCoord` — NOT in tiles.
 *
 * Verified in-game: a door at tile row 13 wrote `destY=11` and the player
 * arrived at row **5.5** (`11 / 2`), and `destX=14` arrived at column **7**
 * (`14 / 2`).
 *
 * The return value is therefore a fractional tile row (e.g. `5.5`).
 */
export function decodeWarpDestination(byte: number): number {
  return (byte & 0xff) / 2;
}

/**
 * Encodes a destination **row** (Y) into a `WARP` variable byte.
 *
 * Exact inverse of {@link decodeWarpDestination}: the destination is stored in
 * half-tiles (`tile * 2`), matching the actor coordinate space.
 */
export function encodeWarpDestination(tile: number): number {
  return (tile * 2) & 0xff;
}

/** Decodes a destination **column** (X) from a `WARP` variable byte. */
export function decodeWarpDestinationX(byte: number): number {
  return (byte & 0xff) / 2;
}

/**
 * Encodes a destination **column** (X) into a `WARP` variable byte —
 * the exact inverse of {@link decodeWarpDestinationX}.
 */
export function encodeWarpDestinationX(tile: number): number {
  return (tile * 2) & 0xff;
}

/**
 * Rebuilds a `WARP` actor's `Variable` with a new destination, preserving its
 * type byte (bits 0-7). Useful when a warp's destination must be re-derived
 * without touching its style (e.g. re-pointing an existing child).
 */
export function encodeWarpVariable(
  existingVariable: number,
  destY: number,
  destX: number,
  destLayer: number,
): number {
  const type = (existingVariable >>> 0) & 0xff;
  return (
    (type |
      (encodeWarpDestination(destY) << 8) |
      (encodeWarpDestinationX(destX) << 16) |
      ((destLayer & 0x07) << 24)) >>>
    0
  );
}

/**
 * A resolved warp link: a `WARP` actor and the tile it teleports to.
 *
 * The actor's 32-bit `Variable` packs the destination exactly as FSALib's
 * `assets/actors/WARP.json` defines it (bit offsets are into the variable):
 * - bits 0-7   — **Warp Type** / style (enum values in `WARP.json`),
 * - bits 8-15  — **Destination Y** (half-tile row; 0 = the actor's own),
 * - bits 16-23 — **Destination X** (half-tile column; 0 = the actor's own),
 * - bits 24-26 — **Layer** (destination base layer, 0-7),
 * - bits 27-31 — **Activation Variable** (0 = always active).
 *
 * The destination bytes are in **HALF-TILES**, the same space as
 * `Actor.XCoord` / `Actor.YCoord` — verified in-game (see
 * {@link decodeWarpDestination}).
 *
 * Note the FIELD ORDER: row (Y) comes first, column (X) second. Swapping the
 * two makes a horizontal connection arrive one tile above instead of beside the
 * destination door.
 */
export interface WarpLink {
  /** Starting tile (the warp actor's anchor tile). */
  fromRow: number;
  fromCol: number;
  /** Base layer the warp actor sits on (0-7). */
  fromLayer: number;
  /** Destination row in tiles — may be fractional (half-tiles). */
  toRow: number;
  /** Destination column in tiles — may be fractional (half-tiles). */
  toCol: number;
  /** Destination base layer (0-7). */
  toLayer: number;
  /** Warp type/style (byte 1); drives the line colour. */
  type: number;
  /** Local activation variable (byte 4 bits 3-7); 0 = always active. */
  activationVariable: number;
}

/**
 * Extracts the four variable bytes (1-4) of an actor `Variable`.
 *
 * Byte 1 is the least significant byte of the variable (bit offset 0), matching
 * FSALib's `Actor.VariableByte1` and `WARP.json`'s `bitOffset` values.
 */
export function actorVariableBytes(variable: number): {
  /** Warp Type / style (bits 0-7; or an actor-specific value). */
  b1: number;
  /** Destination Y — tile row (bits 8-15). */
  b2: number;
  /** Destination X — tile column (bits 16-23). */
  b3: number;
  /** Layer (bits 0-2) + Activation Variable (bits 3-7) of this byte. */
  b4: number;
} {
  const v = variable >>> 0;
  return {
    b1: v & 0xff,
    b2: (v >>> 8) & 0xff,
    b3: (v >>> 16) & 0xff,
    b4: (v >>> 24) & 0xff,
  };
}

/**
 * Debug view of an actor's packed `Variable`, exposing every field as its own
 * property so the room JSON can be read without decoding the bits by hand.
 *
 * For a `WARP` actor the destination fields are meaningful (see
 * {@link WarpLink}); for any other actor they simply show the same bytes.
 */
export interface ActorVariableProperties {
  /** Raw 32-bit actor variable (unsigned). */
  variable: number;
  /** Byte 1: warp type/style (see `WARP.json`); actor-specific otherwise. */
  type: number;
  /** Byte 2: **Destination Y** (tile row) — see `WARP.json`. */
  destY: number;
  /** Byte 3: **Destination X** (tile column) — see `WARP.json`. */
  destX: number;
  /** Byte 4 bits 0-2: destination base layer (0-7). */
  destLayer: number;
  /** Byte 4 bits 3-7: local activation variable (0 = always active). */
  activationVariable: number;
  /** Raw variable bytes as `0x..` hex strings, for quick eyeballing. */
  rawBytes: { b1: string; b2: string; b3: string; b4: string };
}

/** Decodes an actor `Variable` into its individual fields (for debugging). */
export function actorVariableProperties(variable: number): ActorVariableProperties {
  const { b1, b2, b3, b4 } = actorVariableBytes(variable);
  const hex = (value: number): string => `0x${value.toString(16).padStart(2, '0')}`;
  return {
    variable: variable >>> 0,
    type: b1,
    // Byte 2 is Destination Y (row), byte 3 is Destination X (column), both
    // plain tile coordinates (see encodeWarpDestination*).
    destY: decodeWarpDestination(b2),
    destX: decodeWarpDestinationX(b3),
    destLayer: b4 & 0x07,
    activationVariable: b4 >> 3,
    rawBytes: { b1: hex(b1), b2: hex(b2), b3: hex(b3), b4: hex(b4) },
  };
}

/**
 * Attaches the decoded `properties` breakdown to every actor-baked placement
 * (recursively, children included). Tile-baked placements are returned as-is.
 *
 * Used by the debug room JSON so each actor shows its variable bits as separate
 * fields. Deriving it on demand (instead of storing it in the stage JSON) keeps
 * the persisted data untouched and always in sync with `actorVariable`.
 */
export function withActorProperties(
  placements: readonly SmartObjectPlacement[],
): SmartObjectPlacement[] {
  const decorate = (placement: SmartObjectPlacement): SmartObjectPlacement => {
    const definition = findSmartObjectDefinition(placement.id);
    const children = placement.children ? placement.children.map(decorate) : undefined;
    const base: SmartObjectPlacement = children ? { ...placement, children } : placement;
    if (definition?.baking !== 'actor' && placement.id !== WARP_ACTOR_ID) {
      return base;
    }
    return {
      ...base,
      properties: { ...base.properties, ...actorVariableProperties(placement.actorVariable ?? 0) },
    };
  };
  return placements.map(decorate);
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
    // A door's connecting warp is the `WARP` actor itself; the shared WARP id
    // also covers a `WARP` actor template (its id is `template:…`).
    if ((findSmartObjectDefinition(actor.Id)?.actorId ?? actor.Id) !== WARP_ACTOR_ID) {
      continue;
    }
    const { b1, b2, b3, b4 } = actorVariableBytes(actor.Variable);
    const isZero = b2 === 0 && b3 === 0;
    // Actor X/Y are HALF-TILES; the destination bytes use the SAME half-tile
    // space (byte 2 = Y/row, byte 3 = X/column), so decode to tiles by /2.
    const fromRow = actor.Y / 2;
    const fromCol = actor.X / 2;
    const toRow = isZero ? fromRow : decodeWarpDestination(b2);
    const toCol = isZero ? fromCol : decodeWarpDestinationX(b3);
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
  // Split the half-tile coordinate into a tile anchor plus a 0|1 remainder,
  // keeping the remainder in `halfTileDx/Dy`. Truncating instead would move a
  // sub-tile actor (e.g. a door's centred `WARP`) onto a different tile and
  // make it impossible to match the recorded placement — which then reappears
  // as a duplicate "legacy" actor on the next load.
  const halfX = actor.X < 0 ? actor.X + 1 : actor.X;
  const halfY = actor.Y < 0 ? actor.Y + 1 : actor.Y;
  const dx = halfX & 1;
  const dy = halfY & 1;
  // The archive stores the ACTOR id. Rebind it to the actor-template smart
  // object when one carries the same id AND variable, so a room saved with a
  // template reloads as that template (instead of a raw actor placement that
  // would bake back under a different id).
  const template = findActorTemplatePlacement(actor.Id, actor.Variable);
  const placement: SmartObjectPlacement = {
    id: template?.id ?? actor.Id,
    variantIndex: 0,
    baseLayerId: actor.Layer & 0x0f,
    anchorRow: (halfY - dy) / 2,
    anchorCol: (halfX - dx) / 2,
    bottomLayerTiles: [],
    topLayerTiles: [],
    actorVariable: actor.Variable,
  };
  if (dx !== 0 || dy !== 0) {
    placement.halfTileDx = dx;
    placement.halfTileDy = dy;
  }
  return placement;
}

/**
 * Finds the actor template whose smart object bakes exactly this actor id +
 * variable. Several presets can share one code (e.g. the `KEY0` variants), so
 * the first match wins — it only matters that the placement's VARIABLE is
 * preserved, which it always is (see `actorToPlacement`).
 */
function findActorTemplatePlacement(
  actorId: string,
  variable: number,
): SmartObjectDefinition | undefined {
  return ACTOR_TEMPLATE_SMART_OBJECTS.find(
    (definition) =>
      definition.actorId === actorId && (definition.actorVariable ?? 0) === variable >>> 0,
  );
}

/**
 * Sets (or clears) a placement's user-assigned name, returning a copy.
 *
 * An empty/blank name removes the custom name so the object column falls back to
 * the definition name — that keeps the persisted JSON clean instead of storing
 * empty strings.
 */
export function withName(
  placement: SmartObjectPlacement,
  name: string | undefined,
): SmartObjectPlacement {
  const cleaned = (name ?? '').trim();
  if (!cleaned) {
    const { name: _drop, ...rest } = placement;
    return { ...rest };
  }
  return { ...placement, name: cleaned };
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
 * `type | destY<<8 | destX<<16 | destLayer<<24`, where the destination tile
 * coordinates are stored as plain **tiles** (FSALib `WARP.json` bit offsets 8
 * and 16; the game draws the marker at `byte * 8` px = `byte` tiles).
 *
 * @param sourceLayer  Base layer the source door (and thus the warp) sits on.
 * @param sourceRow    Source door's anchor tile row (the warp's base position).
 * @param sourceCol    Source door's anchor tile column.
 * @param destY        **Destination Y** (tile row) — byte 2.
 * @param destX        **Destination X** (tile column) — byte 3.
 * @param destLayer    Destination base layer.
 * @param type         Warp type/style byte (see `WARP.json`).
 * @param centreDx     Half-tile X offset to centre the warp in the source door.
 * @param centreDy     Half-tile Y offset to centre the warp in the source door.
 */
export function createWarpChild(
  sourceLayer: number,
  sourceRow: number,
  sourceCol: number,
  destY: number,
  destX: number,
  destLayer: number,
  type = 0,
  centreDx = 0,
  centreDy = 0,
): SmartObjectPlacement {
  const variable =
    ((type & 0xff) |
      (encodeWarpDestination(destY) << 8) |
      (encodeWarpDestinationX(destX) << 16) |
      ((destLayer & 0x07) << 24)) >>>
    0;
  const warp: SmartObjectPlacement = {
    id: WARP_ACTOR_ID,
    variantIndex: 0,
    baseLayerId: sourceLayer,
    anchorRow: sourceRow,
    anchorCol: sourceCol,
    bottomLayerTiles: [],
    topLayerTiles: [],
    actorVariable: variable,
  };
  if (centreDx !== 0 || centreDy !== 0) {
    warp.halfTileDx = centreDx;
    warp.halfTileDy = centreDy;
  }
  return warp;
}

/**
 * Reads a `WARP` actor placement's destination tile, or null when it does not
 * encode one (a zero destination means "the actor's own tile").
 *
 * `row`/`col` are in tiles and may be **fractional** — the stored bytes are
 * half-tiles (see {@link decodeWarpDestination}).
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
  // Byte 2 is Destination Y (row), byte 3 is Destination X (column); both are
  // HALF-TILES (FSALib `WARP.json` bits 8 and 16), decoded to tiles by /2.
  return {
    row: decodeWarpDestination(b2),
    col: decodeWarpDestinationX(b3),
    layer: b4 & 0x07,
  };
}

/**
 * Returns a copy of a `WARP` child whose destination is re-pointed at a new
 * tile + layer, keeping its type byte (and the actor's own anchor) unchanged.
 * Used when the connected **target** door moves: the source door's warp must
 * follow it. A non-warp placement is returned unchanged.
 */
export function repointWarpChild(
  placement: SmartObjectPlacement,
  destY: number,
  destX: number,
  destLayer: number,
): SmartObjectPlacement {
  if (placement.id !== WARP_ACTOR_ID) {
    return placement;
  }
  const { b1 } = actorVariableBytes(placement.actorVariable ?? 0);
  const variable =
    ((b1 & 0xff) |
      (encodeWarpDestination(destY) << 8) |
      (encodeWarpDestinationX(destX) << 16) |
      ((destLayer & 0x07) << 24)) >>>
    0;
  return { ...placement, actorVariable: variable };
}

/**
 * Bounding box (in tiles) of a definition's tiles relative to its anchor,
 * including negative offsets. Used to size previews and hit-test drags.
 */
export function smartObjectBounds(
  definition: SmartObjectDefinition,
  variantIndex = 0,
  subTypeIndex = 0,
  scale?: SmartObjectScale,
): {
  minRow: number;
  minCol: number;
  maxRow: number;
  maxCol: number;
  rows: number;
  cols: number;
} {
  const variant = smartObjectVariant(definition, variantIndex, subTypeIndex, scale);
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
  subTypeIndex = 0,
  scale?: SmartObjectScale,
): ImageBuffer {
  const variant = smartObjectVariant(definition, variantIndex, subTypeIndex, scale);
  const bounds = smartObjectBounds(definition, variantIndex, subTypeIndex, scale);
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
