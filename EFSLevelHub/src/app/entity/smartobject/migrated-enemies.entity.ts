/**
 * Migrated enemies
 * ----------------
 * Enemies that have been moved off the legacy actor catalog and onto
 * first-class smart objects with real context-menu fields (see
 * `rawiso/entitymig.md`).
 *
 * This module is the SINGLE place that knows which enemies are migrated. Hosts
 * (the room page, the toolbox) only read {@link migratedEnemies} and never
 * import an individual `*.entity.ts` — otherwise every new migration would add
 * another entity → host dependency, which is exactly what the contract system
 * exists to avoid.
 *
 * Adding an enemy to a migration:
 *   1. create `smartobject/<name>.entity.ts` exporting a builder that takes the
 *      actor catalog entry (so its menus come from the catalog metadata),
 *   2. append it to {@link MIGRATED_ENEMY_BUILDERS}.
 */

import { ActorDefinition } from '../actor-definition.entity';
import { SmartObjectDefinition } from '../smartobject.definition';
import { ARMOS_KNIGHT_ACTOR_ID, armosKnightDefinition } from './armos-knight.entity';

/** One migrated enemy: the actor it wraps plus how to build its definition. */
interface MigratedEnemyBuilder {
  /** Catalog id the definition wraps (e.g. `AMOS`). */
  readonly actorId: string;
  /** Builds the definition from the actor catalog entry. */
  readonly build: (definition?: ActorDefinition) => SmartObjectDefinition;
}

/**
 * Every migrated enemy, in toolbox order.
 *
 * The wrapped actor id is used to remove the entry from the legacy list, so an
 * enemy never appears twice.
 */
const MIGRATED_ENEMY_BUILDERS: readonly MigratedEnemyBuilder[] = [
  { actorId: ARMOS_KNIGHT_ACTOR_ID, build: armosKnightDefinition },
];

/**
 * Builds the migrated enemy definitions from the actor catalog.
 *
 * @param actors Actor catalog keyed by 4-character id (`GetActors` output).
 * @returns One definition per migrated enemy, actor id resolved.
 */
export function migratedEnemies(
  actors: Record<string, ActorDefinition>,
): SmartObjectDefinition[] {
  return MIGRATED_ENEMY_BUILDERS.map((builder) => builder.build(actors[builder.actorId]));
}

/**
 * The **actor ids** wrapped by migrated definitions.
 *
 * The legacy enemy list is filtered by these so a migrated enemy is not offered
 * twice.
 */
export function migratedActorIds(): Set<string> {
  return new Set(MIGRATED_ENEMY_BUILDERS.map((builder) => builder.actorId));
}
