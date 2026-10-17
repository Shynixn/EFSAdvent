/**
 * Tile → actor lookup
 * -------------------
 * The game decides which actor a decorative *tile* implies. FSALib ships that
 * mapping as `tileproperties.json`: 52 tiles carry a `RequiredActorID` (+ an
 * optional `ActorValue` for the actor's `Variable`), e.g.
 *
 * ```json
 * "48": { "Name": "Chest", "RequiredActorID": "TKRA", "InteractionTile": 16 }
 * ```
 *
 * EFSAdvent uses the same data when painting (`TileBrush.cs`): stamping such a
 * tile also places the actor, so the room renders with the right sprite.
 *
 * The editor uses it in the opposite direction — given an actor (a toolbox
 * template like "Treasure Chest"), show the TILE that represents it, so the
 * preview looks like what the room will actually display (tile 48 for `TKRA`).
 */

/** One tile that implies an actor. */
export interface TileActorDefinition {
  /** Tileset tile id (0-1023). */
  tile: number;
  /** Human-readable tile name from `tileproperties.json` (e.g. `Chest`). */
  name: string;
  /** Actor the tile places. */
  actorId: string;
  /** Default actor `Variable` for this tile, when the data specifies one. */
  actorValue?: number;
}

/** Shape of one `tileproperties.json` entry (only the keys used here). */
interface TilePropertyEntry {
  Name?: string;
  RequiredActorID?: string;
  ActorValue?: number;
}

/** Builds the tile list from `tileproperties.json`. */
export function buildTileActors(
  properties: Record<string, TilePropertyEntry>,
): TileActorDefinition[] {
  const tiles: TileActorDefinition[] = [];
  for (const [key, entry] of Object.entries(properties)) {
    const actorId = entry?.RequiredActorID;
    const tile = Number(key);
    if (!actorId || !Number.isFinite(tile)) {
      continue;
    }
    tiles.push({
      tile,
      name: entry.Name ?? actorId,
      actorId: actorId.toUpperCase(),
      ...(typeof entry.ActorValue === 'number' ? { actorValue: entry.ActorValue } : {}),
    });
  }
  return tiles.sort((a, b) => a.tile - b.tile);
}

/**
 * Picks the tile that best represents an actor: the first tile implying it
 * (falling back to an entry whose name is not a generic duplicate).
 *
 * @param actorId Actor id (4 characters).
 * @param tiles   Tiles from {@link buildTileActors}.
 */
export function tileForActor(
  actorId: string,
  tiles: readonly TileActorDefinition[],
): TileActorDefinition | undefined {
  const id = actorId.toUpperCase();
  return tiles.find((entry) => entry.actorId === id);
}

/** The actor a tile implies, if any. */
export function actorForTile(
  tile: number,
  tiles: readonly TileActorDefinition[],
): TileActorDefinition | undefined {
  return tiles.find((entry) => entry.tile === tile);
}
