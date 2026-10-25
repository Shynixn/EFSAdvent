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
import { PlacementField, PlacementFieldChoice } from '../contract/placeable.entity';
import { SmartObjectPlacement } from '../smartobject.entity';

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
 * definition's sub-type list (see `onContextChoice`), and many actors have a
 * field literally named `Type`. Without the prefix, choosing it would be routed
 * to the sub-type handler and silently do nothing.
 */
function groupIdFor(field: ActorField): string {
  const slug = field.Name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `actor:${slug}`;
}

/** Human-readable label for a flag bit, e.g. `0x08` -> `Flag 8`. */
function flagLabel(field: ActorField, value: number): string {
  // Catalog flag entries name the individual BIT (e.g. `1`, `4`, `8`), so use
  // the matching enum description when present, otherwise the bit value.
  const entry = (field.Values ?? []).find((item) => item.Value === value);
  return entry && entry.Name ? entry.Name : `Flag 0x${value.toString(16)}`;
}

/**
 * The `flags` choices for a bitfield field.
 *
 * Every catalog value is a single bit that can be toggled independently, so the
 * entries are rendered as checkboxes rather than a mutually exclusive menu.
 */
function flagChoices(field: ActorField): PlacementFieldChoice[] {
  return (field.Values ?? [])
    .filter((value) => !value.Broken && value.Value > 0)
    .map((value) => ({ value: value.Value, label: flagLabel(field, value.Value) }));
}

/** The mutually exclusive options for an enum/boolean field, or `null`. */
function choiceChoices(field: ActorField): PlacementFieldChoice[] | null {
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
  return null;
}

/**
 * Builds the context-menu fields for an actor definition from its catalog
 * metadata.
 *
 * Handles all four catalog value types:
 *
 * | `ValueType` | Rendered as |
 * |---|---|
 * | `Enum` | mutually exclusive submenu (broken values hidden) |
 * | `Boolean` | Off / On submenu |
 * | `Flags` | independent bit toggles (menu stays open) |
 * | `Integer` | `−`/`+` stepper between 0 and the field mask |
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

    const base = {
      id: groupIdFor(field),
      label: field.Name,
      value: (placement: SmartObjectPlacement) =>
        decodeActorField(placement.actorVariable ?? 0, field),
      withValue: (placement: SmartObjectPlacement, value: number) => ({
        ...placement,
        actorVariable: encodeActorField(placement.actorVariable ?? 0, field, value),
      }),
    };

    if (field.ValueType === 'Flags') {
      const choices = flagChoices(field);
      if (choices.length === 0) {
        continue;
      }
      menus.push({ ...base, kind: 'flags', choices });
      continue;
    }

    if (field.ValueType === 'Integer') {
      // A free-form number has no useful option list, so it gets a stepper.
      // The mask keeps the value inside the field's own bits.
      menus.push({ ...base, kind: 'number', choices: [], min: 0, max: field.Mask });
      continue;
    }

    const choices = choiceChoices(field);
    if (!choices) {
      continue;
    }
    menus.push({ ...base, kind: 'choice', choices });
  }

  return menus;
}
