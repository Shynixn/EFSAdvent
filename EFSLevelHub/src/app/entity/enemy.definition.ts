/**
 * Actor smart objects
 * -------------------
 * Every actor is an ordinary {@link SmartObjectDefinition} with
 * `baking: 'actor'`: it is dragged, hit-tested, moved and deleted exactly like a
 * decoration, but instead of baking tiles it places an **actor** in the room's
 * actor list (`d_enemy_map*.bin`). That is the ONLY difference.
 *
 * The catalog is derived from FSALib's actor catalog (`assets/actors/*.json`),
 * so no actor data is duplicated here. The toolbox surfaces only the `Enemy`
 * subset, but ALL actors are registered so actors already present in a room
 * (Objects, Properties, NPCs, …) resolve for rendering and interaction.
 */

import { ActorDefinition } from './actor-definition.entity';
import { SmartObjectDefinition } from './smartobject.definition';

/** The category shown in the toolbox's "Enemies" section. */
const ENEMY_CATEGORY = 'Enemy';

/**
 * Builds the enemy smart-object catalog (actor category `Enemy`), sorted by
 * name — the subset offered in the toolbox.
 */
export function enemyDefinitions(actors: Record<string, ActorDefinition>): SmartObjectDefinition[] {
  return Object.values(actors)
    .filter((definition) => definition.Category === ENEMY_CATEGORY)
    .map(toActorSmartObject)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Builds actor smart objects for **every** actor in the catalog, so any actor
 * found in a room (regardless of category) resolves by id.
 */
export function actorSmartObjects(
  actors: Record<string, ActorDefinition>,
): SmartObjectDefinition[] {
  return Object.values(actors).map(toActorSmartObject);
}

/** Projects a single actor definition onto an actor-baked smart object. */
export function toActorSmartObject(definition: ActorDefinition): SmartObjectDefinition {
  return {
    id: definition.Id,
    baking: 'actor',
    name: definition.Name || definition.Id,
    // Only the Enemy subset is shown in the toolbox's Enemies section; other
    // actors are registered purely so they resolve for rendering/interaction,
    // so their section value is never displayed.
    section: definition.Category === ENEMY_CATEGORY ? 'Enemies' : 'Decorations',
    // Actors bake no tiles — a single, empty variant keeps the shared
    // smart-object geometry (bounds/anchor) working.
    set: [{ bottomLayerTiles: [], topLayerTiles: [] }],
    actorId: definition.Id,
    actorVariable: 0,
    noGBASprite: definition.NoGBASprite,
  };
}
