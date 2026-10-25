/**
 * Actor field menus
 * -----------------
 * Almost every actor packs several settings into its `Variable`, and FSALib's
 * catalog already describes them (name, bit offset/size, value type, enum
 * options). This module turns that metadata into the editor's
 * {@link PlacementField} menus, so an actor with a proper catalog definition
 * needs no hand-written entity code at all.
 *
 * See `rawiso/entitymig.md` for the migration workflow.
 */

import {
  ActorDefinition,
  ActorField,
  decodeActorField,
  encodeActorField,
} from '../actor-definition.entity';
import { PlacementField } from '../contract/placeable.entity';
import { SmartObjectPlacement } from '../smartobject.entity';
import type { PlacementFieldChoice } from '../contract/placeable.entity';

/**
 * Bits 27-31 are `Activation Variable` for essentially every actor. They belong
 * to the room-local activation system, so they are shown only on actors that
 * actually opt into it (see `contract/activatable.entity.ts`) rather than
 * duplicated here as a plain number field.
 */
const ACTIVATION_VARIABLE_OFFSET = 27;

/**
 * Stable menu group id for a field, e.g. `Rail ID` -> `actor:rail-id`.
 *
 * The `actor:` prefix is REQUIRED: the canvas reserves the bare id `type` for a
 * definition's sub-type list (see `onContextChoice`), and AMOS's first field is
 * literally named `Type`. Without the prefix, choosing it would be routed to the
 * sub-type handler and silently do nothing.
 */
function groupIdFor(field: ActorField): string {
  const slug = field.Name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `actor:${slug}`;
}

/** The selectable options for a field, or `null` when it is not a menu. */
function choicesFor(field: ActorField): PlacementFieldChoice[] | null {
  if (field.ValueType === 'Enum') {
    // Broken values render nothing / do not work in-game, so never offer them.
    const choices = (field.Values ?? [])
      .filter((value) => !value.Broken)
      .map((value) => ({ value: value.Value, label: value.Name }));
    return choices.length > 1 ? choices : null;
  }
  if (field.ValueType === 'Boolean') {
    return [
      { value: 0, label: 'Off' },
      { value: 1, label: 'On' },
    ];
  }
  // Integers (e.g. `Rail ID`) have no enumerable option list; a plain menu of
  // 256 entries would be unusable, so they are skipped until a numeric input
  // type exists in the shared context menu.
  return null;
}

/**
 * Builds the context-menu fields for an actor definition from its catalog
 * metadata.
 *
 * @param definition The actor catalog entry (needs `Fields`).
 * @param options.skipActivation Exclude the `Activation Variable` field.
 * @param options.only Restrict the result to these field names.
 * @returns One {@link PlacementField} per menu-able actor field.
 */
export function actorFieldMenus(
  definition: ActorDefinition | undefined,
  options: { skipActivation?: boolean; only?: readonly string[] } = {},
): PlacementField[] {
  const fields = definition?.Fields ?? [];
  const menus: PlacementField[] = [];

  for (const field of fields) {
    if (options.skipActivation && field.BitOffset === ACTIVATION_VARIABLE_OFFSET) {
      continue;
    }
    if (options.only && !options.only.includes(field.Name)) {
      continue;
    }
    const choices = choicesFor(field);
    if (!choices) {
      continue;
    }
    menus.push({
      id: groupIdFor(field),
      label: field.Name,
      choices,
      value: (placement: SmartObjectPlacement) =>
        decodeActorField(placement.actorVariable ?? 0, field),
      withValue: (placement: SmartObjectPlacement, value: number) => ({
        ...placement,
        actorVariable: encodeActorField(placement.actorVariable ?? 0, field, value),
      }),
    });
  }

  return menus;
}
