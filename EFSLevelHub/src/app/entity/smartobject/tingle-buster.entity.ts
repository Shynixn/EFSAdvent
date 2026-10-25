/**
 * Tingle Buster (`TINB`)
 * ----------------------
 * An invisible `Property` actor that stops Tingle appearing in the room it sits
 * in. It has no fields and no rendering — it is a pure zone marker, so the only
 * thing that matters is that one exists in the room and on the right layer.
 *
 * Verified against the shipped game: 269 `TINB` actors across 208 of 3880
 * rooms, of which 212 sit on base layer 0. Where a room has more than one, they
 * occupy different layers (5/6/7) — i.e. one per layer that needs covering.
 */

import { ActorData } from '../fsalib.entity';

/** The actor id of the Tingle Buster. */
export const TINGLE_BUSTER_ACTOR_ID = 'TINB';

/**
 * The base layer the marker is baked into.
 *
 * A single marker is enough — 212 of the game's 269 `TINB` actors sit on layer
 * 0, and no room needs one per layer to suppress Tingle.
 */
export const TINGLE_BUSTER_LAYER = 0;

/**
 * Where the marker is placed.
 *
 * The shipped game scatters these (X0/Y0, X2/Y0, X62/Y2 …), so the position is
 * irrelevant — anything inside the room works. Tile (0,0) → half-tile (0,0) is
 * used so the value is stable and easy to spot.
 */
const TINGLE_BUSTER_HALF_TILE_X = 0;
const TINGLE_BUSTER_HALF_TILE_Y = 0;

/** Builds the `TINB` actor record for one base layer. */
export function tingleBusterActor(layer: number): ActorData {
  return {
    Id: TINGLE_BUSTER_ACTOR_ID,
    Layer: layer,
    X: TINGLE_BUSTER_HALF_TILE_X,
    Y: TINGLE_BUSTER_HALF_TILE_Y,
    Variable: 0,
  };
}

/**
 * Ensures a room's actor list contains a Tingle Buster on every given layer.
 *
 * Existing markers are never duplicated: a layer that already has a `TINB` is
 * left alone, and any `TINB` the user placed by hand is respected. The rest of
 * the actor list is preserved in its original order, with the new markers
 * appended so nothing else moves.
 *
 * @param actors Actor records the room is about to be saved with.
 * @param layers Base layers that should each carry a marker.
 * @returns A new list including any missing markers.
 */
export function withTingleBuster(
  actors: readonly ActorData[],
  layers: readonly number[],
): ActorData[] {
  const covered = new Set(
    actors
      .filter((actor) => actor.Id === TINGLE_BUSTER_ACTOR_ID)
      .map((actor) => actor.Layer & 0x0f),
  );
  const missing = layers.filter((layer) => !covered.has(layer & 0x0f));
  if (missing.length === 0) {
    return [...actors];
  }
  return [...actors, ...missing.map((layer) => tingleBusterActor(layer))];
}
