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

import { SmartObjectPlacement, withChildren } from '../smartobject.entity';
import { RotateableSmartObjectDefinition, nextRotation } from '../contract/rotateable.entity';
import { IPlaceable } from '../contract/placeable.entity';

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
export const PLAYER_START_DEFINITION: RotateableSmartObjectDefinition & {
  placement?: IPlaceable;
} = {
  id: PLAYER_START_ID,
  baking: 'actor',
  name: 'Start',
  section: 'Decorations',
  actorId: PLAYER_START_ACTOR_ID,
  actorVariable: encodePlayerStart({ color: 0, direction: 0, state: 0 }),
  rotation: PLAYER_START_ROTATION,
  // Placing one Start records all four Links in a row (see `expandPlayerStart`).
  placement: {
    onPlace: (placement) => expandPlayerStart(placement),
    // The facing lives in the actor `Variable`, not in the variant list, so a
    // plain `variantIndex` bump would not turn the player. The entity applies
    // the rotation itself — AND to every child, or the four Links would end up
    // facing different ways.
    onRotate: (placement, nextVariant) => ({
      ...placement,
      variantIndex: nextVariant,
      actorVariable: withPlayerDirection(
        placement.actorVariable ?? 0,
        PLAYER_ROTATION_DIRECTIONS[nextVariant] ?? 0,
      ),
      children: applyToPlayerChildren(placement.children, (variable) =>
        withPlayerDirection(variable, PLAYER_ROTATION_DIRECTIONS[nextVariant] ?? 0),
      ),
    }),
    fields: [
      {
        id: 'player-state',
        label: 'Player State',
        choices: PLAYER_STATES.map((entry) => ({ value: entry.value, label: entry.name })),
        value: (placement) => decodePlayerStart(placement.actorVariable ?? 0).state,
        // A Start stands for all four Links, so a state change must reach every
        // child too — otherwise only the representative player would lie down.
        withValue: (placement, value) => ({
          ...placement,
          actorVariable: withPlayerState(placement.actorVariable ?? 0, value as PlayerState),
          children: applyToPlayerChildren(placement.children, (variable) =>
            withPlayerState(variable, value as PlayerState),
          ),
        }),
      },
    ],
  },
  // Actors bake no tiles — one empty variant keeps the shared geometry. The
  // facing comes from `rotation`, not from the variant list.
  set: [{ bottomLayerTiles: [], topLayerTiles: [] }],
};

/**
 * Horizontal offset (in tiles) of each Link from the first column, left to
 * right: Green · Red · Blue · Purple.
 *
 * The player drags ONE Start and gets the four-Link formation around the drop
 * point, so a tile does not end up with four overlapping player actors.
 */
const PLAYER_FORMATION_COLUMNS: readonly number[] = [0, 1, 2, 3];

/**
 * Expands a dropped Start into the full four-player formation.
 *
 * The dropped placement becomes **Green** (`PLAYER_COLORS[0]`) at the leftmost
 * column, and the other three colours ride along as children one tile to the
 * right of each other. Children follow the parent when it is moved, are not
 * individually selectable, and bake into the room's actor list like any other
 * placement.
 */
export function expandPlayerStart(parent: SmartObjectPlacement): SmartObjectPlacement {
  const { direction, state } = decodePlayerStart(parent.actorVariable ?? 0);
  // The parent is always Green: the colour menu is gone, so a Start is defined
  // as "all four players in formation" rather than one chosen colour.
  const anchored: SmartObjectPlacement = {
    ...parent,
    actorVariable: encodePlayerStart({ color: 0, direction, state }),
  };
  const children = PLAYER_COLORS.slice(1).map((entry, index) => ({
    id: PLAYER_START_ID,
    variantIndex: parent.variantIndex ?? 0,
    baseLayerId: parent.baseLayerId,
    anchorRow: anchored.anchorRow,
    anchorCol: anchored.anchorCol + PLAYER_FORMATION_COLUMNS[index + 1],
    bottomLayerTiles: [],
    topLayerTiles: [],
    actorVariable: encodePlayerStart({ color: entry.value, direction, state }),
  }));
  return withChildren(anchored, children);
}

/**
 * Rewrites the actor `Variable` of every child Link with `change`, keeping the
 * list shape.
 *
 * A Start stands for all four players, and the child Links carry the same
 * `Variable` layout as the parent — so a state or facing change must be applied
 * to every one of them. Children keep their own colour bits because `change`
 * only rewrites the field it targets (see {@link withPlayerState} /
 * {@link withPlayerDirection}).
 *
 * @returns The updated child list, or `undefined` when there are none.
 */
function applyToPlayerChildren(
  children: readonly SmartObjectPlacement[] | undefined,
  change: (variable: number) => number,
): SmartObjectPlacement[] | undefined {
  if (!children || children.length === 0) {
    return children ? [...children] : undefined;
  }
  return children.map((child) => ({
    ...child,
    actorVariable: change(child.actorVariable ?? 0),
  }));
}

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
