/**
 * Legacy actor templates → first-class smart objects
 * --------------------------------------------------
 * EFSAdvent's actor presets (`actor-template.entity.ts`) were a flat list of
 * `Name;ID, V:a,b,c,d` lines: a raw actor id plus a hand-assembled `Variable`.
 * That was the LAST part of the toolbox that was not a real smart object — it
 * could only be dragged, with no context menu and a nested tab strip nobody
 * could make sense of.
 *
 * This module MIGRATES them: each preset becomes an actor-baked
 * {@link SmartObjectDefinition} whose context menu is generated from the actor's
 * catalog fields, with those fields **pre-filled from the template's packed
 * variable**. So the preset still "already carries" the right setup, but the
 * user can now edit every bit the game exposes (type, size, rail, …).
 *
 * Only templates whose actor actually appears in the FSALib catalog are
 * migrated; the rest are reported as {@link unmigratedTemplates} so the toolbox
 * can show them explicitly instead of silently dropping them.
 */

import { ActorDefinition } from '../actor-definition.entity';
import { ActorTemplate, ACTOR_TEMPLATES } from '../actor-template.entity';
import { SmartObjectDefinition } from '../smartobject.definition';
import { actorFieldMenus } from './actor-fields.entity';

/**
 * Smart-object id prefix for migrated presets.
 *
 * Kept from the legacy id (`template:<section>:<index>`) so placements recorded
 * by older stage files still resolve after this migration.
 */
export const TEMPLATE_ID_PREFIX = 'template:';

/** A template projection paired with whether the actor catalog knows the actor. */
export interface MigratedTemplate {
  /** The originating legacy preset. */
  template: ActorTemplate;
  /** The smart-object definition (null when the actor is not in the catalog). */
  definition: SmartObjectDefinition | null;
}

/**
 * Projects one legacy preset onto an actor-baked smart object.
 *
 * The preset's packed variable is the DEFAULT `actorVariable`, and the field
 * menus are built from the actor's catalog entry, so the menu opens showing
 * exactly the values the preset encodes.
 *
 * @param template The legacy preset.
 * @param actor The actor catalog entry, when available.
 */
export function toMigratedTemplate(
  template: ActorTemplate,
  actor: ActorDefinition | undefined,
): SmartObjectDefinition {
  return {
    id: template.id,
    baking: 'actor',
    name: template.name,
    section: template.section,
    actorId: template.actorId,
    // The preset's baked variable becomes the starting value seen in the menu.
    actorVariable: template.variable,
    placement: {
      fields: actorFieldMenus(actor, { skipActivation: true }),
    },
    // Actors bake no tiles — one empty variant keeps the shared geometry.
    set: [{ bottomLayerTiles: [], topLayerTiles: [] }],
  };
}

/**
 * Migrates every legacy preset that the catalog can describe.
 *
 * @param actors Actor catalog keyed by 4-character id (`GetActors` output).
 * @returns The migrated definitions, plus the presets whose actor is unknown.
 */
export function migrateActorTemplates(actors: Record<string, ActorDefinition>): {
  definitions: SmartObjectDefinition[];
  unmigrated: ActorTemplate[];
} {
  const definitions: SmartObjectDefinition[] = [];
  const unmigrated: ActorTemplate[] = [];
  for (const template of ACTOR_TEMPLATES) {
    const actor = actors[template.actorId];
    if (!actor) {
      unmigrated.push(template);
      continue;
    }
    definitions.push(toMigratedTemplate(template, actor));
  }
  return { definitions, unmigrated };
}
