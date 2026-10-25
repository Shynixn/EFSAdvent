/**
 * Enemy smart objects
 * -------------------
 * Every `Enemy`-category actor, exposed as a first-class smart object with a
 * context menu built from its **catalog metadata** (see `actor-fields.entity.ts`
 * and `rawiso/entitymig.md`).
 *
 * Why this is one generic builder instead of 60 hand-written `.entity.ts` files:
 * FSALib's catalog already declares every actor's variable layout (bit offsets,
 * widths, enums, flags), so a per-actor file would only duplicate data that is
 * already correct — and would drift from it. An entity file is only warranted
 * when an actor needs behaviour beyond field editing (children, activation
 * targets, custom rotation, …).
 *
 * The generated ids are `enemy:<ACTOR_ID>` (e.g. `enemy:AMOS`) so they can never
 * collide with the raw 4-character actor id used by the legacy catalog.
 */

import { ActorDefinition } from '../actor-definition.entity';
import { SmartObjectDefinition } from '../smartobject.definition';
import { actorFieldMenus } from './actor-fields.entity';

/** Prefix for generated enemy smart-object ids. */
export const ENEMY_ID_PREFIX = 'enemy:';

/** The FSALib category whose actors are surfaced as enemies. */
const ENEMY_CATEGORY = 'Enemy';

/** The smart-object id for an actor id. */
export function enemySmartObjectId(actorId: string): string {
  return `${ENEMY_ID_PREFIX}${actorId}`;
}

/** The actor id a generated enemy id refers to, or `null` when not an enemy id. */
export function enemyActorId(id: string): string | null {
  return id.startsWith(ENEMY_ID_PREFIX) ? id.slice(ENEMY_ID_PREFIX.length) : null;
}

/**
 * Builds one enemy smart object from its catalog entry.
 *
 * The context menu includes every catalog field except `Activation Variable`
 * (bits 27-31), which belongs to the room-local activation system and is not
 * offered until an actor opts into it.
 */
export function enemyDefinition(definition: ActorDefinition): SmartObjectDefinition {
  return {
    id: enemySmartObjectId(definition.Id),
    baking: 'actor',
    name: definition.Name || definition.Id,
    section: 'Enemies',
    actorId: definition.Id,
    // Default `Variable` — every field starts at its zero value, which is what
    // EFSAdvent's actor templates use for a freshly placed enemy.
    actorVariable: 0,
    placement: {
      fields: actorFieldMenus(definition, { skipActivation: true }),
    },
    // Actors bake no tiles — one empty variant keeps the shared geometry.
    set: [{ bottomLayerTiles: [], topLayerTiles: [] }],
  };
}

/**
 * Builds every enemy smart object from the actor catalog, sorted by name.
 *
 * @param actors Actor catalog keyed by 4-character id (`GetActors` output).
 */
export function enemyDefinitions(actors: Record<string, ActorDefinition>): SmartObjectDefinition[] {
  return Object.values(actors)
    .filter((definition) => definition.Category === ENEMY_CATEGORY)
    .map(enemyDefinition)
    .sort((a, b) => a.name.localeCompare(b.name));
}
