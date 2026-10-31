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
  encodeActivationVariable,
  encodeSetVariable,
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
  // Prefer a variable the actor already carries (e.g. authored by hand).
  const current = decodeSetVariable(source.actorVariable ?? 0);
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
  return { ...placement, actorVariable: encodeSetVariable(placement.actorVariable ?? 0, variable) };
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
  const usesVariable = activatableOf(findSmartObjectDefinition(placement.id))?.usesVariable;
  if (usesVariable) {
    // The `Type` field is bits 0-7 with bit 0 = `Uses Variable`.
    next = (next | 0x01) >>> 0;
    // The target also WRITES a variable of its own; the engine needs it
    // non-zero for it to start hidden.
    const own = findFreeLocalVariable([variable, ...reserved]);
    if (own !== null) {
      next = encodeSetVariable(next, own);
    }
  }
  return { ...placement, actorVariable: next };
}

/** The variable a source writes, or 0 when it has none. */
export function sourceVariable(placement: SmartObjectPlacement): number {
  return decodeSetVariable(placement.actorVariable ?? 0);
}

/** The variable a target waits on, or 0 when it has none. */
export function targetVariable(placement: SmartObjectPlacement): number {
  return decodeActivationVariable(placement.actorVariable ?? 0);
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
