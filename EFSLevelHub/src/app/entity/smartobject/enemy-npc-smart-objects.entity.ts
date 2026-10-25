/**
 * Category-generated smart objects
 * --------------------------------
 * Turns FSALib **actor categories** into first-class smart objects whose context
 * menus are built from the catalog metadata (see `actor-fields.entity.ts` and
 * `rawiso/entitymig.md`).
 *
 * One generic builder serves every category — `Enemy`, `NPC`, and anything added
 * later — because FSALib's catalog already declares each actor's variable layout
 * (bit offsets, widths, enums, flags). A per-actor (or per-category) file would
 * only duplicate data that is already correct, and would drift from it. An
 * entity file is only warranted when an actor needs behaviour beyond field
 * editing (children, activation targets, custom rotation, …).
 *
 * Generated ids are `<prefix>:<ACTOR_ID>` (e.g. `enemy:AMOS`, `npc:KETH`) so they
 * can never collide with the raw 4-character actor id used by the unmigrated
 * catalog.
 */

import { ActorDefinition } from '../actor-definition.entity';
import { SmartObjectDefinition } from '../smartobject.definition';
import { actorFieldMenus } from './actor-fields.entity';

/**
 * An actor category exposed as a toolbox section.
 *
 * `prefix` is the smart-object id prefix; `section` is the label the toolbox
 * groups them under (it must be a valid `SmartObjectSection`).
 */
interface CategoryDescriptor {
  actorCategory: string;
  prefix: string;
  section: string;
}

/** Categories surfaced as their own toolbox section. */
const CATEGORIES = {
  enemy: { actorCategory: 'Enemy', prefix: 'enemy:', section: 'Enemies' },
  npc: { actorCategory: 'NPC', prefix: 'npc:', section: 'NPC' },
} as const satisfies Record<string, CategoryDescriptor>;

/** Prefix for generated enemy smart-object ids. */
export const ENEMY_ID_PREFIX = CATEGORIES.enemy.prefix;

/** Prefix for generated NPC smart-object ids. */
export const NPC_ID_PREFIX = CATEGORIES.npc.prefix;

/** The smart-object id for an actor id in a category. */
function categorySmartObjectId(prefix: string, actorId: string): string {
  return `${prefix}${actorId}`;
}

/** The actor id a generated id refers to, or `null` when the prefix does not match. */
function categoryActorId(prefix: string, id: string): string | null {
  return id.startsWith(prefix) ? id.slice(prefix.length) : null;
}

/** The smart-object id for an enemy actor id. */
export function enemySmartObjectId(actorId: string): string {
  return categorySmartObjectId(ENEMY_ID_PREFIX, actorId);
}

/** The actor id a generated enemy id refers to, or `null` when not an enemy id. */
export function enemyActorId(id: string): string | null {
  return categoryActorId(ENEMY_ID_PREFIX, id);
}

/** The smart-object id for an NPC actor id. */
export function npcSmartObjectId(actorId: string): string {
  return categorySmartObjectId(NPC_ID_PREFIX, actorId);
}

/** The actor id a generated NPC id refers to, or `null` when not an NPC id. */
export function npcActorId(id: string): string | null {
  return categoryActorId(NPC_ID_PREFIX, id);
}

/**
 * Builds one smart object from a catalog entry.
 *
 * The context menu includes every catalog field except `Activation Variable`
 * (bits 27-31), which belongs to the room-local activation system and is not
 * offered until an actor opts into it.
 */
function categoryDefinition(
  definition: ActorDefinition,
  descriptor: CategoryDescriptor,
): SmartObjectDefinition {
  return {
    id: categorySmartObjectId(descriptor.prefix, definition.Id),
    baking: 'actor',
    name: definition.Name || definition.Id,
    section: descriptor.section as SmartObjectDefinition['section'],
    actorId: definition.Id,
    // Default `Variable` — every field starts at its zero value, which is what
    // EFSAdvent uses for a freshly placed actor.
    actorVariable: 0,
    placement: {
      fields: actorFieldMenus(definition, { skipActivation: true }),
    },
    // Actors bake no tiles — one empty variant keeps the shared geometry.
    set: [{ bottomLayerTiles: [], topLayerTiles: [] }],
  };
}

/** Every smart object of one category, sorted by name. */
function categoryDefinitions(
  actors: Record<string, ActorDefinition>,
  descriptor: CategoryDescriptor,
): SmartObjectDefinition[] {
  // Case-insensitive: the catalog has at least one entry whose category is
  // misspelled `Npc`, which an exact match would silently drop.
  const wanted = descriptor.actorCategory.toLowerCase();
  return Object.values(actors)
    .filter((definition) => (definition.Category ?? '').toLowerCase() === wanted)
    .map((definition) => categoryDefinition(definition, descriptor))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Builds every enemy smart object from the actor catalog, sorted by name.
 *
 * @param actors Actor catalog keyed by 4-character id (`GetActors` output).
 */
export function enemyDefinitions(actors: Record<string, ActorDefinition>): SmartObjectDefinition[] {
  return categoryDefinitions(actors, CATEGORIES.enemy);
}

/** Builds every NPC smart object from the actor catalog, sorted by name. */
export function npcSmartObjectDefinitions(
  actors: Record<string, ActorDefinition>,
): SmartObjectDefinition[] {
  return categoryDefinitions(actors, CATEGORIES.npc);
}
