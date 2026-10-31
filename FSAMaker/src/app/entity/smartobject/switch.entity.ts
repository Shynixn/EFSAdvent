/**
 * Floor switch (`SWTH`) smart object.
 * -----------------------------------
 * A one-person floor switch that triggers events when stepped on. It is
 * actor-baked: placing it writes a `SWTH` actor, and the switch's own tiles are
 * painted by the user (see {@link FLOOR_SWITCH_TILE}).
 *
 * Catalog fields (FSALib `assets/actors/SWTH.json`):
 *
 * | Bits  | Field                   | Type    |
 * |-------|-------------------------|---------|
 * | 0-7   | Switch Behavior         | Enum    |
 * | 16-19 | Horizontal Trigger Area | Integer |
 * | 20-23 | Vertical Trigger Area   | Integer |
 * | 27-31 | Triggered Local Variable| Integer |
 *
 * All of them are exposed from the catalog ({@link actorFieldMenus}), so the
 * bit widths and enum labels come from the game data instead of a copied list.
 *
 * Tile choice
 * -----------
 * The switch is drawn by the *tileset*, not by an actor sprite: `SWTH` has no
 * `rendering` block, so a placed actor on its own renders nothing. The game's
 * mapping in `tileproperties.json` is:
 *
 * | Tile | Name       | RequiredActorID |
 * |------|------------|-----------------|
 * | 18   | `Switch`   | `SWTH`          |
 * | 20   | `Switch (Side view)` | `SWTH`|
 * | 80   | `Star switch`        | `SWTH`|
 * | 82   | `Star switch (Side view)` | `SWTH` |
 * | 65   | `Pot, reveals switch` | `SWTH` |
 *
 * Tile 18 is the ordinary, front-facing floor switch and is used for the
 * preview. Tile 65 is **not** a switch despite also carrying `SWTH`: it is a
 * pot that reveals a switch when broken, so it would show a pot, not a switch.
 *
 * The tile is {@link SmartObjectVariant.previewTiles} only — it is drawn under
 * the actor in the editor and is never baked, matching the item stand.
 */

import { ActorDefinition } from '../actor-definition.entity';
import { ActivatableSmartObjectDefinition } from '../contract/activatable.entity';
import { actorFieldMenus } from './actor-fields.entity';

/** Actor id of the floor switch. */
export const FLOOR_SWITCH_ACTOR_ID = 'SWTH';

/** Stable smart-object id for the floor switch. */
export const FLOOR_SWITCH_ID = 'floor-switch';

/**
 * Tileset id of the `Switch` tile (`tileproperties.json` #18), the ordinary
 * front-facing floor switch that requires `SWTH`.
 */
export const FLOOR_SWITCH_TILE = 18;

/** A switch definition: actor-baked, with catalog-derived menus. */
export type SwitchSmartObjectDefinition = ActivatableSmartObjectDefinition;

/**
 * Builds the floor switch definition from the actor catalog.
 *
 * The switch is **both** an actor and a tile: `SWTH` records the behaviour
 * (behavior, trigger area, triggered variable) while tile 18 is what the game
 * draws. `SWTH` is a `TileObject` with no `rendering` block, so the tile is the
 * switch's only visual — placing the object therefore bakes it, exactly like a
 * decoration.
 *
 * @param definition The `SWTH` catalog entry, when loaded. Supplies the field
 *   menus; without it the object still places a working `SWTH` actor, it just
 *   has no context-menu fields.
 */
export function floorSwitchDefinition(definition?: ActorDefinition): SwitchSmartObjectDefinition {
  return {
    id: FLOOR_SWITCH_ID,
    baking: 'actor',
    name: 'Switch',
    section: 'Switches',
    actorId: FLOOR_SWITCH_ACTOR_ID,
    // Switch Behavior 0 (`Default`), no trigger area, no triggered variable.
    actorVariable: 0,
    // The switch is an ACTIVATOR: stepping on it SETS a room-local variable,
    // which linked targets wait on. It never waits on one itself.
    //
    // `SWTH` puts that variable at bits 27-31 (`Triggered Local Variable`), not
    // the usual 22-26 — writing the default location would overwrite its
    // `Vertical Trigger Area` and the switch would never fire.
    activatable: { isTarget: false, setVariableBitOffset: 27 },
    placement: {
      fields: actorFieldMenus(definition, { skipActivation: true }),
    },
    // Tile 18 (`Switch`) is the switch's graphics. Unlike the item pedestal this
    // is NOT a preview: without it a placed switch is invisible in-game.
    set: [
      {
        bottomLayerTiles: [{ dRow: 0, dCol: 0, tile: FLOOR_SWITCH_TILE }],
        topLayerTiles: [],
      },
    ],
  };
}

/** The floor switch definition without catalog metadata (no menus). */
export const FLOOR_SWITCH_DEFINITION: SwitchSmartObjectDefinition = floorSwitchDefinition();
