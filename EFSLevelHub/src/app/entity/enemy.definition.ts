/**
 * Enemy smart objects
 * -------------------
 * Enemies are ordinary {@link SmartObjectDefinition}s with `baking: 'actor'`:
 * they are dragged, hit-tested, moved and deleted exactly like a decoration, but
 * instead of baking tiles they place an **actor** in the room's enemy list
 * (`d_enemy_map*.bin`). That is the ONLY difference.
 *
 * The catalog is derived from FSALib's actor catalog (`assets/actors/*.json`)
 * filtered to the `Enemy` category, so no enemy data is duplicated here.
 */

import { ActorDefinition } from './actor-definition.entity';
import { SmartObjectDefinition } from './smartobject.definition';

/**
 * Builds the enemy smart-object catalog from the actor catalog, sorted by name.
 *
 * Each definition carries the actor id (`actorId`), its default `Variable`
 * (`actorVariable`) and a single empty variant — enemies bake no tiles, so
 * {@link smartObjectBounds} reports a 1×1 cell and hit-testing/outlining work
 * unchanged alongside decorations.
 */
export function enemyDefinitions(actors: Record<string, ActorDefinition>): SmartObjectDefinition[] {
  return Object.values(actors)
    .filter((definition) => definition.Category === 'Enemy')
    .map(toEnemySmartObject)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Projects a single actor definition onto an enemy smart object. */
export function toEnemySmartObject(definition: ActorDefinition): SmartObjectDefinition {
  return {
    id: definition.Id,
    baking: 'actor',
    name: definition.Name || definition.Id,
    section: 'Enemies',
    // Enemies bake no tiles — a single, empty variant keeps the shared
    // smart-object geometry (bounds/anchor) working.
    set: [{ bottomLayerTiles: [], topLayerTiles: [] }],
    actorId: definition.Id,
    actorVariable: 0,
    noGBASprite: definition.NoGBASprite,
  };
}
