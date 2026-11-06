/**
 * Block smart object (Other → Misc).
 * --------------------------------
 * A **tile-only** object: the game decides how (and whether) a block moves from
 * the TILE ID alone. The block tiles carry only `Name`/`Description`/`Collision`
 * in `tileproperties.json` — no `RequiredActorID` — so no actor is involved:
 *
 * | Tile | Name                 | Movement          |
 * |------|----------------------|-------------------|
 * | 32   | Block, not movable   | none              |
 * | 33   | Block, movable       | any direction     |
 * | 34   | Green block, movable | any (Green Link)  |
 * | 35   | Red block, movable   | any (Red Link)    |
 * | 36   | Blue block, movable  | any (Blue Link)   |
 * | 37   | Purple block, movable| any (Purple Link) |
 * | 38   | Block, movable north | north only        |
 * | 39   | Block, movable south | south only        |
 * | 54   | Block, movable west  | west only         |
 * | 55   | Block, movable east  | east only         |
 *
 * Each is a single-tile {@link SmartObjectSubType}, picked from the context
 * menu, so one placement can be switched between every block version.
 */

import { ActorDefinition } from '../actor-definition.entity';
import { ActivatableSmartObjectDefinition } from '../contract/activatable.entity';
import { actorFieldMenus } from './actor-fields.entity';
import { SmartObjectDefinition, SmartObjectSubType } from '../smartobject.definition';

/** Stable smart-object id. */
export const BLOCK_ID = 'block';

/**
 * Tileset id of the default block tile: `tileproperties.json` #32,
 * "Block, not movable".
 *
 * The default placement is the plain solid block; pick a movable variant from
 * the right-click **Type** menu, which re-stamps the tile in place.
 *
 * Verified against a real game room (stage 2, room 7): the game's own blocks are
 * placed as tiles 32 (not movable) and 38/39/54/55 (north/south/west/east).
 */
export const BLOCK_TILE = 32;

/** A single-tile variant stamped on the base layer. */
function tileVariant(tile: number) {
  return {
    bottomLayerTiles: [{ dRow: 0, dCol: 0, tile }],
    topLayerTiles: [],
  };
}

/**
 * Every block tile version.
 *
 * **`Block, not movable` (tile 32) is FIRST** so it is sub-type 0 — the plain
 * block a fresh placement uses, matching the game's most common block tile.
 * Choosing another entry from the right-click **Type** menu re-stamps the tile
 * with that sub-type's id.
 */
export const BLOCK_SUB_TYPES: SmartObjectSubType[] = [
  { id: 'not-movable', name: 'Block, not movable', set: [tileVariant(32)] },
  { id: 'movable-north', name: 'Block, movable north', set: [tileVariant(38)] },
  { id: 'movable-south', name: 'Block, movable south', set: [tileVariant(39)] },
  { id: 'movable-west', name: 'Block, movable west', set: [tileVariant(54)] },
  { id: 'movable-east', name: 'Block, movable east', set: [tileVariant(55)] },
  { id: 'movable', name: 'Block, movable', set: [tileVariant(33)] },
  { id: 'green', name: 'Green block, movable', set: [tileVariant(34)] },
  { id: 'red', name: 'Red block, movable', set: [tileVariant(35)] },
  { id: 'blue', name: 'Blue block, movable', set: [tileVariant(36)] },
  { id: 'purple', name: 'Purple block, movable', set: [tileVariant(37)] },
];

/**
 * The Block definition: tile-baked, with every block tile as a sub-type.
 *
 * Sub-type 0 is `Block, not movable` (tile 32) — see {@link BLOCK_SUB_TYPES} —
 * so a fresh placement is the plain block. `set` mirrors the default.
 */
export const BLOCK_DEFINITION: SmartObjectDefinition = {
  id: BLOCK_ID,
  baking: 'tile',
  name: 'Block',
  section: 'Misc',
  subTypes: BLOCK_SUB_TYPES,
  set: [tileVariant(BLOCK_TILE)],
};

/**
 * Big Block (`BLCK`) smart object (Other → Misc).
 * ----------------------------------------------
 * A multi-tile movable stone block. Unlike the plain {@link BLOCK_DEFINITION} —
 * which is a pure tile — the big block is an **actor**: the game draws and moves
 * it from `BLCK`, and the actor's `Variable` selects its size.
 *
 * Catalog fields (`assets/actors/BLCK.json`):
 *
 * | Bits  | Field               | Notes                                       |
 * |-------|---------------------|---------------------------------------------|
 * | 0-1   | Block Size          | 0 = 1×1, 1 = 2×2, 2 = 3×3, 3 = 4×4          |
 * | 2-3   | Unknown (Flags)     | bit 3 (`0x8`) is set by every shipped block |
 * | 8-11  | Special             | bit 0 = "Endlessly Movable"                 |
 * | 27-31 | Activation Variable | room-local variable set after moving        |
 *
 * The original EFSAdvent editor places it exactly like this
 * (`data/actortemplates/Objects.txt`):
 *
 * | Template          | `BLCK` Variable (`V:a,b,c,d`) |
 * |-------------------|-------------------------------|
 * | Movable 2x2 Block | `0,0,0,9`  (size 1 \| `0x8`)  |
 * | Movable 3x3 Block | `0,0,0,10` (size 2 \| `0x8`)  |
 * | Movable 4x4 Block | `0,0,0,11` (size 3 \| `0x8`)  |
 *
 * Those templates start at **2×2** — a 1×1 `BLCK` is possible by the catalog but
 * was never shipped, so the default here is 2×2 and the menu offers all four
 * sizes. `BLCK` has a `rendering` block, so the game draws the block itself; no
 * tile is stamped.
 */

/** Actor id of the big (actor-based) block. */
export const BIG_BLOCK_ACTOR_ID = 'BLCK';

/** Stable smart-object id of the big block. */
export const BIG_BLOCK_ID = 'big-block';

/**
 * `BLCK` variable bit 3 (`0x8`), set by every shipped block template. The
 * catalog labels bits 2-3 "Unknown", but all three EFSAdvent templates set this
 * bit, so it is pinned to match the game's own blocks.
 */
const BIG_BLOCK_TEMPLATE_FLAG = 0x8;

/** `BLCK` Block Size (bits 0-1) value for a 2×2 block (the shipped default). */
const BIG_BLOCK_SIZE_2X2 = 1;

/**
 * `BLCK` Block Size choices offered in the context menu.
 *
 * The catalog lists 1×1 as size 0, but no shipped block uses it and a 1×1 block
 * is the plain tile-based `Block` object instead — so only the multi-tile sizes
 * are offered here.
 */
const BIG_BLOCK_SIZES = ['2×2', '3×3', '4×4'] as const;

/**
 * Builds the Big Block (`BLCK`) definition from the actor catalog.
 *
 * The default variable matches the EFSAdvent "Movable 2x2 Block" template
 * (`V:0,0,0,9` = 2×2 | {@link BIG_BLOCK_TEMPLATE_FLAG}).
 *
 * Only the **Block Size** menu is exposed, restricted to the multi-tile sizes.
 * `BLCK`'s other catalog fields are deliberately hidden: `Unknown` (bits 2-3)
 * and `Special` (bits 8-11) are engine plumbing, bit 3 is pinned by
 * {@link BIG_BLOCK_TEMPLATE_FLAG}, and `Activation Variable` belongs to the
 * room activation system.
 *
 * @param definition The `BLCK` catalog entry, when loaded. Supplies the
 *   `Block Size` enum; without it the object still places a working `BLCK`
 *   actor, it just has no context-menu fields.
 */
export function bigBlockDefinition(definition?: ActorDefinition): SmartObjectDefinition {
  const sizeField = actorFieldMenus(definition, {
    skipActivation: true,
    only: ['Block Size'],
  })[0];

  return {
    id: BIG_BLOCK_ID,
    baking: 'actor',
    name: 'Big Block',
    section: 'Misc',
    actorId: BIG_BLOCK_ACTOR_ID,
    actorVariable: BIG_BLOCK_SIZE_2X2 | BIG_BLOCK_TEMPLATE_FLAG,
    placement: {
      fields: sizeField
        ? [
            {
              ...sizeField,
              // Drop the 1×1 entry: size 0 is the plain tile block, not this one.
              choices: BIG_BLOCK_SIZES.map((label, index) => ({ value: index + 1, label })),
            },
          ]
        : [],
    },
    // Actors bake no tiles — the game draws the block from its sprite.
    set: [{ bottomLayerTiles: [], topLayerTiles: [] }],
  };
}

/** The Big Block definition without catalog metadata (no menus). */
export const BIG_BLOCK_DEFINITION: SmartObjectDefinition = bigBlockDefinition();

/**
 * Block Trigger (`PONT`) smart object (Other → Misc).
 * --------------------------------------------------
 * An **invisible activator**: it bakes a `PONT` "Point Check" actor, which fires
 * when the tile under it changes (the classic "push a block onto this spot"
 * trigger). Use the right-click **Activates** action to link it to a target.
 *
 * `PONT` is a `TileObject` with no `rendering` block, so on its own it draws
 * NOTHING — which is why the definition carries an editor-only
 * {@link SmartObjectVariant.previewTiles} entry: a semi-transparent block hint
 * that is drawn on the canvas but **never stamped** into the room.
 *
 * Catalog fields (`assets/actors/PONT.json`):
 *
 * | Bits  | Field            | Notes                                    |
 * |-------|------------------|------------------------------------------|
 * | 0-3   | Action Type      | what the trigger does (enum)             |
 * | 27-31 | Enabled Variable | room-local variable the trigger sets     |
 *
 * The variable lives at bits **27-31**, so `setVariableBitOffset: 27` — the same
 * non-standard location the floor switch uses. `PONT` never waits on a variable
 * itself, so it is a source (`isTarget: false`).
 */

/** Actor id of the Point Check trigger. */
export const BLOCK_TRIGGER_ACTOR_ID = 'PONT';

/** Stable smart-object id of the block trigger. */
export const BLOCK_TRIGGER_ID = 'block-trigger';

/**
 * Tileset id of the trigger's EDITOR-ONLY hint: the ordinary movable block
 * (`tileproperties.json` #33). It is a `previewTiles` entry, so it is drawn on
 * the canvas but never written to the room or the archive.
 */
export const BLOCK_TRIGGER_PREVIEW_TILE = 33;

/**
 * `PONT` `Action Type` (bits 0-3) value `3` — "Use Enable Variable".
 *
 * This is the only useful behaviour for a block trigger: when the tile changes,
 * the trigger enables the room-local variable in its `Enabled Variable` bits
 * (27-31), which is what an activation link consumes. Every other enum value
 * fires a one-off effect (heart, force fairy, lucke hole, …), so the menu is
 * dropped and the value pinned instead.
 */
const BLOCK_TRIGGER_ACTION_USE_ENABLE_VARIABLE = 3;

/**
 * Builds the Block Trigger (`PONT`) definition.
 *
 * `Action Type` is **not** exposed: it is always "Use Enable Variable" so the
 * trigger participates in activation links. Only `Enabled Variable` matters, and
 * that is owned by the activation system (`setVariableBitOffset: 27`).
 *
 * @param definition The `PONT` catalog entry. Unused today — the object exposes
 *   no catalog-derived menus — but kept for symmetry with the other builders.
 */
export function blockTriggerDefinition(
  definition?: ActorDefinition,
): ActivatableSmartObjectDefinition {
  void definition;
  return {
    id: BLOCK_TRIGGER_ID,
    baking: 'actor',
    name: 'Block Trigger',
    section: 'Misc',
    actorId: BLOCK_TRIGGER_ACTOR_ID,
    // Action Type 3 = "Use Enable Variable"; the Enabled Variable bits (27-31)
    // start at 0 and are filled in by the activation link.
    actorVariable: BLOCK_TRIGGER_ACTION_USE_ENABLE_VARIABLE,
    // The trigger SETS a variable (it is an activation SOURCE). `PONT` keeps the
    // `Enabled Variable` at bits 27-31, not the usual 22-26.
    activatable: { isTarget: false, setVariableBitOffset: 27 },
    // No context-menu fields: Action Type is pinned above and the enabled
    // variable belongs to the activation link.
    placement: { fields: [] },
    // Nothing is stamped: the block hint below is editor-only scenery that is
    // drawn on the canvas but never written into the room layers.
    set: [
      {
        bottomLayerTiles: [],
        topLayerTiles: [],
        previewTiles: [{ dRow: 0, dCol: 0, tile: BLOCK_TRIGGER_PREVIEW_TILE }],
      },
    ],
    // Ghost the hint so it reads as a trigger marker, not real terrain.
    translucentPreviewTiles: true,
  };
}

/** The Block Trigger definition without catalog metadata (no menus). */
export const BLOCK_TRIGGER_DEFINITION: ActivatableSmartObjectDefinition =
  blockTriggerDefinition();

/** Every Misc block object: plain Block, Big Block and Block Trigger. */
export const BLOCK_DEFINITIONS: SmartObjectDefinition[] = [
  BLOCK_DEFINITION,
  BIG_BLOCK_DEFINITION,
  BLOCK_TRIGGER_DEFINITION,
];
