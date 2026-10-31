/**
 * Force Gem (`RUPY`) smart object.
 * --------------------------------
 * Wraps the legacy "Force Gem" actor template from EFSAdvent's Items list. It is
 * actor-baked (it places a `RUPY` actor, no tiles) and renders the gem sprite
 * through the shared actor pipeline.
 *
 * `RUPY`'s own field block (from FSALib `assets/actors/RUPY.json`):
 *
 * ```
 * bit  0-7   Gem Type            (enum, see the catalog)
 * bit  8-15  Frames to Appear
 * bit 16-23  Interaction Type
 * bit 27-31  Activation Variable
 * ```
 *
 * The `Gem Type` menu is generated from that catalog metadata
 * ({@link actorFieldMenus}), so the 8-bit width, the enum order and the
 * exclusion of FSALib's `Broken` values (16-18, the invisible gems) all come
 * from the real definition. There is deliberately **no** local copy of the list:
 * duplicating it is what let the menu drift from the game data before.
 *
 * Note the gem's `Gem Type` is EIGHT bits, not the four the shared `Shape`
 * contract assumes, which is why it must not opt into the shapeable contract.
 */

import { ActivatableSmartObjectDefinition } from '../contract/activatable.entity';
import { ActorDefinition } from '../actor-definition.entity';
import { actorFieldMenus } from './actor-fields.entity';

/** The actor id of the force gem. */
export const FORCE_GEM_ACTOR_ID = 'RUPY';

/** Stable smart-object id for the force gem. */
export const FORCE_GEM_ID = 'force-gem';

/** A smart-object definition that carries the gem's catalog-derived menus. */
export type GemTypeSmartObjectDefinition = ActivatableSmartObjectDefinition;

/**
 * Builds the Force Gem definition.
 *
 * `actorVariable` sets `Interaction Type = 3` (`Does not Despawn`) in bits 16-23
 * with `Gem Type 0` in bits 0-7 — the layout real stage archives use for a
 * collectible gem.
 *
 * NOTE ON THE LEGACY TEMPLATE: EFSAdvent's line is `V:0,0,0,1.`, which packs as
 * `0x01000000` because the `V` bytes are listed LSB-first (`packVariable(b4, b3,
 * b2, b1)`). That puts `1` in byte 4 (bits 24-31), NOT the interaction type — and
 * it is why copying the template literally produces a gem that cannot be picked
 * up. The template is a plain "spawn one green gem" preset, so the sensible
 * editor default is a normal collectible instead.
 *
 * @param definition The `RUPY` catalog entry, when loaded.
 */
export function forceGemDefinition(definition?: ActorDefinition): GemTypeSmartObjectDefinition {
  return {
    id: FORCE_GEM_ID,
    baking: 'actor',
    name: 'Force Gem',
    section: 'Items',
    actorId: FORCE_GEM_ACTOR_ID,
    actorVariable: 3 << 16,
    placement: {
      fields: actorFieldMenus(definition, { only: ['Gem Type'], skipActivation: true }),
    },
    set: [{ bottomLayerTiles: [], topLayerTiles: [] }],
  };
}

/**
 * The Force Gem definition without catalog metadata.
 *
 * Used where a static definition is required (module-load registration and the
 * toolbox card). It carries **no** context-menu fields — the catalog entry is
 * what supplies them — so hosts that have the actor catalog should call
 * {@link forceGemDefinition} instead. There is deliberately no hand-written
 * fallback list: inventing one is how the menu drifted from the game data.
 */
export const FORCE_GEM_DEFINITION: GemTypeSmartObjectDefinition = forceGemDefinition();

/** Whether a smart-object id refers to the force gem. */
export function isForceGem(id: string): boolean {
  return id === FORCE_GEM_ID;
}
