/**
 * Activation links
 * ----------------
 * A room-local "A activates B" relationship between an **activation source**
 * (e.g. the Imprisoning Field `GOL2`) and one or more **activation targets**
 * (e.g. the end-of-level Goal `GOAL`).
 *
 * How the game represents it
 * --------------------------
 * There is no link record in the archive. Both actors simply carry the same
 * room-local variable number:
 *
 * - the source's **Set Variable** (bits 22-26) — the variable it writes when it
 *   triggers;
 * - a target's **Activation Variable** (bits 27-31) — the variable it waits on.
 *
 * Verified against `boss013.arc` room 12:
 * `GOL2 0x0C000005` (setVar 16) and `GOAL 0x81C00001` (actVar 16, Type=Uses
 * Variable).
 *
 * Therefore the editor's job is:
 *
 * 1. allocate a free variable (1-31) when the first link from a source is made,
 * 2. write it into the source's `Set Variable`,
 * 3. write it into every target's `Activation Variable` (plus `Type` bit 0
 *    `Uses Variable` for the Goal),
 * 4. remember which target ids belong to which source in the stage JSON, so the
 *    canvas can keep drawing the lines.
 *
 * ONE variable therefore drives ALL of a source's targets — which is exactly how
 * the game works, and is why a source may have many outgoing links while a
 * target has at most one incoming link.
 */

import { SmartObjectPlacement } from '../smartobject.entity';
import {
  LOCAL_VARIABLE_MAX,
  LOCAL_VARIABLE_MIN,
  activatableOf,
  decodeActivationVariable,
  decodeSetVariable,
  decodeSetVariableAt,
  encodeActivationVariable,
  encodeInteractionType,
  encodeSetVariable,
  encodeSetVariableAt,
  findFreeLocalVariable,
} from '../contract/activatable.entity';
import { findSmartObjectDefinition } from '../smartobject.definition';

/**
 * One persisted activation link.
 *
 * Stored in the stage JSON under the room record, because the variable numbers
 * live in the actor `Variable`s while the visual link needs an explicit record.
 */
export interface ActivationLink {
  /** Smart-object id of the source placement (unique within the room record). */
  from: string;
  /** Smart-object ids of every target the source drives. */
  to: string[];
  /** Room-local variable number shared by the source and all targets (1-31). */
  variable: number;
}

/**
 * A stable key for a placement.
 *
 * Placements have no ids of their own, so a link stores the definition id plus
 * the tile it was placed on — enough to re-attach after a reload, and stable
 * across a plain move (the move handler rewrites the key).
 */
export function placementKey(placement: SmartObjectPlacement): string {
  return `${placement.id}@${placement.anchorRow},${placement.anchorCol}`;
}

/** Whether a room already uses a given variable (by either side of a link). */
export function usedVariables(links: readonly ActivationLink[]): number[] {
  return links.map((link) => link.variable);
}

/**
 * Allocates a variable for a new source→target link.
 *
 * Reuses the source's existing variable when it already has one (so a second
 * target shares it), otherwise picks the lowest free number in 1-31.
 *
 * @returns The variable to use, or `null` when all 31 are taken.
 */
export function allocateVariable(
  source: SmartObjectPlacement,
  links: readonly ActivationLink[],
): number | null {
  const existing = links.find((link) => link.from === placementKey(source));
  if (existing) {
    return existing.variable;
  }
  // Prefer a variable the actor already carries (e.g. authored by hand), read
  // from the field this actor actually uses (27-31 for the floor switch).
  const current = sourceVariable(source);
  if (
    current >= LOCAL_VARIABLE_MIN &&
    current <= LOCAL_VARIABLE_MAX &&
    !usedVariables(links).includes(current)
  ) {
    return current;
  }
  return findFreeLocalVariable(usedVariables(links));
}

/** Writes `variable` into a SOURCE placement's `Set Variable` (bits 22-26). */
export function withSetVariable(
  placement: SmartObjectPlacement,
  variable: number,
): SmartObjectPlacement {
  const bitOffset = sourceVariableBitOffset(placement);
  return {
    ...placement,
    actorVariable: encodeSetVariableAt(placement.actorVariable ?? 0, variable, bitOffset),
  };
}

/**
 * Bit offset of the field a SOURCE writes its triggered variable into.
 *
 * Defaults to bits 22-26. The floor switch (`SWTH`) declares that variable at
 * bits 27-31 instead, so the default would overwrite its trigger area and the
 * switch would never set anything.
 */
export function sourceVariableBitOffset(placement: SmartObjectPlacement): number {
  return activatableOf(findSmartObjectDefinition(placement.id))?.setVariableBitOffset ?? 22;
}

/**
 * Writes `variable` into a TARGET placement's `Activation Variable`
 * (bits 27-31).
 *
 * When the target's definition opts into `activatable.usesVariable` it also
 * turns on `Type` bit 0 (`Uses Variable`) and gives it its own non-zero
 * `Set Variable` (bits 22-26), which is what makes it start HIDDEN until the
 * source fires.
 *
 * @param reserved Additional variable numbers to avoid for the target's own
 *   `Set Variable` (the link's variable is always avoided).
 */
export function withActivationVariable(
  placement: SmartObjectPlacement,
  variable: number,
  reserved: readonly number[] = [],
): SmartObjectPlacement {
  let next = encodeActivationVariable(placement.actorVariable ?? 0, variable);
  const definition = findSmartObjectDefinition(placement.id);
  const activatable = activatableOf(definition);
  if (activatable?.usesVariable) {
    // The `Type` field is bits 0-7 with bit 0 = `Uses Variable`.
    next = (next | 0x01) >>> 0;
    // The target also WRITES a variable of its own; the engine needs it
    // non-zero for it to start hidden.
    const own = findFreeLocalVariable([variable, ...reserved]);
    if (own !== null) {
      next = encodeSetVariable(next, own);
    }
  }
  // Item actors (the Force Gem) only APPEAR once their variable is set when
  // their `Interaction Type` says so; without this the target would be visible
  // from the start and the link would look like it does nothing.
  if (variable !== 0 && activatable?.activatedInteractionType !== undefined) {
    next = encodeInteractionType(next, activatable.activatedInteractionType);
  }
  // Clearing the link (`variable === 0`) restores the plain behaviour, so an
  // unlinked gem is a normal collectible again rather than a permanently
  // hidden one. `inactiveInteractionType` wins; otherwise fall back to the
  // value the definition is placed with.
  if (variable === 0 && activatable?.activatedInteractionType !== undefined) {
    next = encodeInteractionType(
      next,
      activatable.inactiveInteractionType ?? definition?.actorVariable ?? 0,
    );
  }
  return { ...placement, actorVariable: next };
}

/** The variable a source writes, or 0 when it has none. */
export function sourceVariable(placement: SmartObjectPlacement): number {
  return decodeSetVariableAt(placement.actorVariable ?? 0, sourceVariableBitOffset(placement));
}

/** The variable a target waits on, or 0 when it has none. */
export function targetVariable(placement: SmartObjectPlacement): number {
  return decodeActivationVariable(placement.actorVariable ?? 0);
}

/**
 * Renumbers every activation link in a room, assigning variable ids **1..n in
 * link order**, and re-encodes the affected placements.
 *
 * This is the authoritative allocation: ids are derived from the room's links
 * at save/bake time, so they are always contiguous and stable, no matter how the
 * links were drawn. Each activator gets its own id, and every target connected
 * to it receives that same id.
 *
 * Actors read straight out of the archive are NOT rewritten: their `Variable`
 * was authored by the game, and silently renumbering it would change level
 * behaviour. Pass only editor-placed smart objects in `placements`.
 *
 * @param placements The room's editable smart-object placements.
 * @param links      The room's activation links.
 * @returns The renumbered links and the placements whose `Variable` changed.
 */
export function allocateActivationVariables(
  placements: readonly SmartObjectPlacement[],
  links: readonly ActivationLink[],
): { links: ActivationLink[]; placements: SmartObjectPlacement[] } {
  const byKey = new Map(placements.map((p) => [placementKey(p), p] as const));
  const updated = new Map<string, SmartObjectPlacement>();
  const nextLinks: ActivationLink[] = [];

  // Ids are allocated per ACTIVATOR (one link record per source), starting at 1.
  let nextVariable = 1;
  for (const link of links) {
    const variable = nextVariable;
    nextVariable += 1;
    // Out of ids: keep the link with its existing number rather than losing it.
    const id = variable <= LOCAL_VARIABLE_MAX ? variable : link.variable;
    nextLinks.push({ ...link, variable: id });

    const source = byKey.get(link.from);
    if (source) {
      updated.set(link.from, withSetVariable(source, id));
    }
    for (const targetKey of link.to) {
      const target = byKey.get(targetKey);
      if (target) {
        updated.set(targetKey, withActivationVariable(target, id));
      }
    }
  }

  return { links: nextLinks, placements: [...updated.values()] };
}

/**
 * Records a source's ROLE: the room-local variable it writes.
 *
 * Used when a placement is recorded for baking. Every activation entity gets its
 * own variable, numbered from 1 upwards in placement order — see
 * {@link assignActivationVariables}.
 */
export function withSourceVariable(
  placement: SmartObjectPlacement,
  variable: number,
): SmartObjectPlacement {
  return withSetVariable(placement, variable);
}

/**
 * Assigns activation variable IDs across a room's placements.
 *
 * Every activation **source** (activator) that does not already own a variable
 * gets the next free number starting at 1, in list order; every activation
 * **target** then adopts the variable of the source that drives it, so the two
 * sides agree without the user having to draw an explicit link.
 *
 * This is what makes baking work: `placementToActor` writes
 * `placement.actorVariable`, so the IDs must be assigned BEFORE the actor list is
 * baked — otherwise every switch and every gem bakes `0` and nothing activates.
 *
 * Existing numbers are preserved (so a reloaded or hand-authored room is not
 * renumbered), and targets keep any already-valid variable of their own.
 *
 * @param placements Room placements in display order (ids are assigned by this
 *   order, so new placements get the next number).
 * @param links      Links already recorded for the room; a linked pair always
 *   shares the link's variable.
 * @returns The placements with their activation variables filled in.
 */
export function assignActivationVariables(
  placements: readonly SmartObjectPlacement[],
  links: readonly ActivationLink[] = [],
): SmartObjectPlacement[] {
  const used = new Set<number>();

  // A source's variable is fixed by an existing link, or by its own Set Variable
  // when that is already a valid number.
  const variableByKey = new Map<string, number>();
  for (const link of links) {
    variableByKey.set(link.from, link.variable);
    used.add(link.variable);
  }
  for (const placement of placements) {
    const definition = findSmartObjectDefinition(placement.id);
    if (!activatableOf(definition) || activatableOf(definition)?.isTarget) {
      continue;
    }
    const key = placementKey(placement);
    if (variableByKey.has(key)) {
      continue;
    }
    const current = decodeSetVariable(placement.actorVariable ?? 0);
    if (current >= LOCAL_VARIABLE_MIN && current <= LOCAL_VARIABLE_MAX && !used.has(current)) {
      variableByKey.set(key, current);
      used.add(current);
    }
  }

  // Hand out the remaining numbers in placement order.
  const assigned: number[] = [];
  for (const placement of placements) {
    const definition = findSmartObjectDefinition(placement.id);
    const activatable = activatableOf(definition);
    if (!activatable || activatable.isTarget) {
      continue;
    }
    const key = placementKey(placement);
    if (variableByKey.has(key)) {
      continue;
    }
    const free = findFreeLocalVariable([...used, ...assigned]);
    if (free !== null) {
      variableByKey.set(key, free);
      assigned.push(free);
    }
  }

  // Rewrite: sources get their Set Variable, targets the matching Activation
  // Variable (a target adopts the variable of the link that drives it, else the
  // first source's, so an unlinked gem still appears once the switch fires).
  const firstVariable = [...variableByKey.values()].sort((a, b) => a - b)[0];
  return placements.map((placement) => {
    const definition = findSmartObjectDefinition(placement.id);
    const activatable = activatableOf(definition);
    if (!activatable) {
      return placement;
    }
    const key = placementKey(placement);
    if (activatable.isTarget) {
      const link = links.find((entry) => entry.to.includes(key));
      const variable = link?.variable ?? targetVariable(placement) ?? firstVariable;
      const effective = link?.variable ?? (targetVariable(placement) || firstVariable);
      if (effective === undefined) {
        return placement;
      }
      return withActivationVariable(placement, effective);
    }
    const variable = variableByKey.get(key);
    if (variable === undefined) {
      return placement;
    }
    return withSourceVariable(placement, variable);
  });
}

/** Whether two placements are already linked (either direction). */
export function areLinked(
  links: readonly ActivationLink[],
  source: SmartObjectPlacement,
  target: SmartObjectPlacement,
): boolean {
  const key = placementKey(source);
  const targetKey = placementKey(target);
  return links.some((link) => link.from === key && link.to.includes(targetKey));
}

/**
 * Adds a source→target link.
 *
 * @returns The updated link list plus the two placements to persist (the source
 *          gains a `Set Variable`, the target gains an `Activation Variable`),
 *          or `null` when the link cannot be made (no free variable, or already
 *          linked).
 */
export function addActivationLink(
  source: SmartObjectPlacement,
  target: SmartObjectPlacement,
  links: readonly ActivationLink[],
): {
  links: ActivationLink[];
  source: SmartObjectPlacement;
  target: SmartObjectPlacement;
} | null {
  if (areLinked(links, source, target)) {
    return null;
  }
  const variable = allocateVariable(source, links);
  if (variable === null) {
    return null;
  }

  const sourceKey = placementKey(source);
  const targetKey = placementKey(target);
  const nextLinks = links.some((link) => link.from === sourceKey)
    ? links.map((link) =>
        link.from === sourceKey && !link.to.includes(targetKey)
          ? { ...link, to: [...link.to, targetKey] }
          : link,
      )
    : [...links, { from: sourceKey, to: [targetKey], variable }];

  return {
    links: nextLinks,
    source: withSetVariable(source, variable),
    target: withActivationVariable(
      target,
      variable,
      // Every variable already in play, so the goal's own `Set Variable` picks a
      // distinct free one (matching the shipped `0x81C00001` layout).
      [...usedVariables(links), variable],
    ),
  };
}

/**
 * Removes every link of `source` (all of its outgoing links).
 *
 * The targets are returned so the caller can clear their `Activation Variable`
 * back to 0 (always active) — otherwise they would keep waiting on a variable
 * nothing writes any more.
 */
export function removeSourceLinks(
  source: SmartObjectPlacement,
  targets: readonly SmartObjectPlacement[],
  links: readonly ActivationLink[],
): {
  links: ActivationLink[];
  targets: SmartObjectPlacement[];
} {
  const sourceKey = placementKey(source);
  const removed = links.find((link) => link.from === sourceKey);
  if (!removed) {
    return { links: [...links], targets: [] };
  }
  const cleared = targets
    .filter((target) => removed.to.includes(placementKey(target)))
    .map((target) => withActivationVariable(target, 0));
  return {
    links: links.filter((link) => link.from !== sourceKey),
    targets: cleared,
  };
}

/** Drops every link (incoming or outgoing) that mentions `placement`. */
export function detachActivationLinks(
  placement: SmartObjectPlacement,
  links: readonly ActivationLink[],
): ActivationLink[] {
  const key = placementKey(placement);
  return links
    .filter((link) => link.from !== key)
    .map((link) => ({ ...link, to: link.to.filter((target) => target !== key) }))
    .filter((link) => link.to.length > 0);
}

/**
 * Rewrites keys after a placement moved, so its links keep pointing at it.
 *
 * @returns The updated links and every target that must be re-encoded (a moved
 *          TARGET keeps its variable; a moved SOURCE keeps its own too, so only
 *          the recorded keys change).
 */
export function rekeyLinks(
  before: SmartObjectPlacement,
  after: SmartObjectPlacement,
  links: readonly ActivationLink[],
): ActivationLink[] {
  const oldKey = placementKey(before);
  const newKey = placementKey(after);
  if (oldKey === newKey) {
    return [...links];
  }
  return links.map((link) => ({
    ...link,
    from: link.from === oldKey ? newKey : link.from,
    to: link.to.map((target) => (target === oldKey ? newKey : target)),
  }));
}

/** Every target key of a source's link, or an empty list. */
export function sourceTargets(
  source: SmartObjectPlacement,
  links: readonly ActivationLink[],
): string[] {
  const key = placementKey(source);
  return links.find((link) => link.from === key)?.to ?? [];
}

/** Whether a placement is a target of any link. */
export function isLinkedTarget(
  placement: SmartObjectPlacement,
  links: readonly ActivationLink[],
): boolean {
  const key = placementKey(placement);
  return links.some((link) => link.to.includes(key));
}
