/**
 * Player Start Position (`PLAS`) smart object.
 * --------------------------------------------
 * The player's spawn point is an ordinary actor (`PLAS`, category `Property`),
 * so it travels through the shared smart-object pipeline — but its `Variable`
 * packs three meaningful fields (see `FSALib/assets/actors/PLAS.json`):
 *
 * ```
 * bit  0-3  Player Color   0 Green · 1 Red · 2 Blue · 3 Purple
 * bit  4-7  Direction     0 South · 1 North · 2 East · 3 West
 * bit  8-11 Player State   0 Standing · 1 Lying
 * ```
 *
 * This module owns the packing/unpacking plus the fixed definition so the
 * toolbox, canvas and context menu all agree on the bit layout.
 */

import { SmartObjectPlacement } from '../smartobject.entity';
import { RotateableSmartObjectDefinition, nextRotation } from '../contract/rotateable.entity';

/** The actor id of the player start marker. */
export const PLAYER_START_ACTOR_ID = 'PLAS';

/** Stable smart-object id for the player start marker. */
export const PLAYER_START_ID = 'player-start';

/** Player start rotations: the facing itself (S → E → N → W), starting South. */
const PLAYER_START_ROTATION = { defaultRotation: 0, rotationCount: 4 } as const;

/**
 * Facing index per rotation index.
 *
 * The player spawns facing **South** (rotation 0 — the initial position), and
 * each Rotate step turns **clockwise** on a north-up map:
 * South → West → North → East → South.
 *
 * (Clockwise from south is west, not east: south → west → north → east.)
 */
export const PLAYER_ROTATION_DIRECTIONS: readonly PlayerDirection[] = [0, 3, 1, 2];

/** Actor category used by the context menu to detect a player start. */
export type PlayerColor = 0 | 1 | 2 | 3;
/** Facing of the player at spawn. */
export type PlayerDirection = 0 | 1 | 2 | 3;
/** Whether the player starts standing or lying down. */
export type PlayerState = 0 | 1;

/** Selectable player colours (bit 0-3). */
export const PLAYER_COLORS: { value: PlayerColor; name: string }[] = [
  { value: 0, name: 'Green' },
  { value: 1, name: 'Red' },
  { value: 2, name: 'Blue' },
  { value: 3, name: 'Purple' },
];

/** Selectable facings (bit 4-7), in facing order. */
export const PLAYER_DIRECTIONS: { value: PlayerDirection; name: string }[] = [
  { value: 0, name: 'South' },
  { value: 1, name: 'North' },
  { value: 2, name: 'East' },
  { value: 3, name: 'West' },
];

/** Selectable player states (bit 8-11). */
export const PLAYER_STATES: { value: PlayerState; name: string }[] = [
  { value: 0, name: 'Standing' },
  { value: 1, name: 'Lying' },
];

/** The fields of a player start `Variable`. */
export interface PlayerStartVariable {
  color: PlayerColor;
  direction: PlayerDirection;
  state: PlayerState;
}

/** Decodes a `PLAS` actor variable into its fields. */
export function decodePlayerStart(variable: number): PlayerStartVariable {
  const v = variable >>> 0;
  return {
    color: (v & 0x0f) as PlayerColor,
    direction: ((v >>> 4) & 0x0f) as PlayerDirection,
    state: ((v >>> 8) & 0x0f) as PlayerState,
  };
}

/** Packs player-start fields back into an actor variable. */
export function encodePlayerStart(value: PlayerStartVariable): number {
  return (
    (((value.color ?? 0) & 0x0f) |
      (((value.direction ?? 0) & 0x0f) << 4) |
      (((value.state ?? 0) & 0x0f) << 8)) >>>
    0
  );
}

/** Applies one field change to a variable, returning the new packed value. */
export function withPlayerColor(variable: number, color: PlayerColor): number {
  return encodePlayerStart({ ...decodePlayerStart(variable), color });
}

/** Applies a direction change to a variable. */
export function withPlayerDirection(variable: number, direction: PlayerDirection): number {
  return encodePlayerStart({ ...decodePlayerStart(variable), direction });
}

/** Applies a state change to a variable. */
export function withPlayerState(variable: number, state: PlayerState): number {
  return encodePlayerStart({ ...decodePlayerStart(variable), state });
}

/** Advances the facing by one step (South → East → North → West → South). */
export function nextPlayerDirection(variable: number): number {
  const { direction } = decodePlayerStart(variable);
  const order: PlayerDirection[] = [0, 2, 1, 3];
  const index = order.indexOf(direction);
  return withPlayerDirection(variable, order[(index + 1) % order.length]);
}

/**
 * The player-start smart-object definition.
 *
 * It is actor-baked (it places a `PLAS` actor, not tiles) and implements
 * {@link IRotateable}: rotation 0 is the initial facing (**South**) and each
 * step turns clockwise (South → West → North → East), see
 * {@link PLAYER_ROTATION_DIRECTIONS}.
 *
 * The facing lives in the actor `Variable` (bits 4-7), not in tiles — so
 * `applySmartObject` alone cannot rotate it. The canvas therefore delegates to
 * `rotatePlayerStart`, which repacks the variable and re-renders.
 */
export const PLAYER_START_DEFINITION: RotateableSmartObjectDefinition = {
  id: PLAYER_START_ID,
  baking: 'actor',
  name: 'Start',
  section: 'Decorations',
  actorId: PLAYER_START_ACTOR_ID,
  actorVariable: encodePlayerStart({ color: 0, direction: 0, state: 0 }),
  rotation: PLAYER_START_ROTATION,
  // Actors bake no tiles — one empty variant keeps the shared geometry. The
  // facing comes from `rotation`, not from the variant list.
  set: [{ bottomLayerTiles: [], topLayerTiles: [] }],
};

/**
 * Rotates a player start by one step and returns the updated placement.
 *
 * The rotation index maps onto {@link PLAYER_ROTATION_DIRECTIONS}; the actor
 * `Variable`'s facing bits are rewritten to match, and any children (none for a
 * player start) are preserved.
 */
export function rotatePlayerStart(placement: SmartObjectPlacement): SmartObjectPlacement {
  const definition = PLAYER_START_DEFINITION;
  const nextIndex = nextRotation(definition, placement.variantIndex ?? 0);
  const direction = PLAYER_ROTATION_DIRECTIONS[nextIndex] ?? 0;
  return {
    ...placement,
    variantIndex: nextIndex,
    actorVariable: withPlayerDirection(placement.actorVariable ?? 0, direction),
  };
}

/** Whether a smart-object id refers to the player start marker. */
export function isPlayerStart(id: string): boolean {
  return id === PLAYER_START_ID;
}
