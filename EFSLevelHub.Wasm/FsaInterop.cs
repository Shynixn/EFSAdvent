using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;
using System.Text.Json.Serialization;
using AuroraLib.Compression;
using AuroraLib.Core.Format.Identifier;
using AuroraLib.Core.IO;
using FSALib;
using FSALib.AssetDefinitions;
using FSALib.Structs;

namespace EFSLevelHub.Wasm;

/// <summary>
/// JS interop surface. Parses FSA stage archives with FSALib and returns the
/// result as JSON for the Angular app.
/// </summary>
public static partial class FsaInterop
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        // Incoming payloads from the Angular app use camelCase keys (e.g. the
        // actor list's `{ id, layer, x, y, variable }`); the DTOs are PascalCase.
        // Without this, System.Text.Json silently leaves every property at its
        // default and placed actors are written as empty/zero records.
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>
    /// Logs a start/end trace for one JS-exported call, prefixed with a
    /// wall-clock timestamp and <c>[FSAWASM]</c>.
    /// </summary>
    /// <remarks>
    /// Calls into wasm are the slowest part of stage loading (the interpreter
    /// runs at a fraction of native speed), so every export is traced: the
    /// matching BEGIN/END pair with a duration makes the culprit obvious in the
    /// browser console.
    /// </remarks>
    /// <param name="name">Exported method name.</param>
    /// <param name="detail">Optional argument summary appended to BEGIN.</param>
    private static TimedTrace Trace(string name, string detail = "")
        => new(name, detail);

    /// <summary>
    /// A BEGIN/END trace scope: dispose (or <see cref="Done"/>) to log the end
    /// line with the elapsed milliseconds.
    /// </summary>
    private readonly struct TimedTrace : IDisposable
    {
        private readonly string name;
        private readonly System.Diagnostics.Stopwatch stopwatch;

        public TimedTrace(string name, string detail)
        {
            this.name = name;
            stopwatch = System.Diagnostics.Stopwatch.StartNew();
            Log($"BEGIN {name}{(detail.Length > 0 ? $" {detail}" : string.Empty)}");
        }

        /// <summary>Logs the END line (idempotent: a second call is ignored).</summary>
        public void Dispose()
            => Log($"END {name} ({stopwatch.Elapsed.TotalMilliseconds:F1}ms)");
    }

    /// <summary>Writes a timestamped <c>[FSAWASM]</c> line to the wasm console.</summary>
    private static void Log(string message)
        => Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] [FSAWASM] {message}");

    /// <summary>
    /// Parses a stage archive (<c>bossXXX.arc</c>, optionally YAZ0-compressed)
    /// and returns its <see cref="StageDto"/> as JSON.
    /// </summary>
    [JSExport]
    public static string ParseStage(byte[] arcData)
    {
        using var trace = Trace("ParseStage", $"({arcData.Length} bytes)");
        try
        {
            using var stream = new MemoryStream(arcData, writable: false);
            using var rarc = new Rarc(stream);
            using var stage = new Stage(rarc);

            return JsonSerializer.Serialize(ToDto(stage), JsonOptions);
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { error = ex.Message }, JsonOptions);
        }
    }

    /// <summary>
    /// Re-indexes a stage archive so it can occupy a different stage slot.
    /// </summary>
    /// <remarks>
    /// Each <c>bossNNN.arc</c> is internally bound to its own map index: its
    /// RARC holds <c>B0NN</c>/<c>M0NN</c> folders and <c>0NN_…</c> files, and the
    /// game resolves stage resources by that index. Placing the archive in a
    /// different slot therefore requires rewriting those names/data to the
    /// destination index. This loads the stage, sets its
    /// <see cref="Stage.Index"/> (which drives every internal rename) and
    /// re-serializes it.
    /// </remarks>
    /// <param name="arcData">Raw bytes of the source <c>bossNNN.arc</c>.</param>
    /// <param name="targetIndex">Destination stage index (e.g. 10 for boss010).</param>
    /// <returns>The re-indexed archive bytes, or an empty array on failure.</returns>
    [JSExport]
    public static byte[] RetargetStageIndex(byte[] arcData, int targetIndex)
    {
        using var trace = Trace("RetargetStageIndex", $"(index {targetIndex}, {arcData.Length} bytes)");
        try
        {
            using var stream = new MemoryStream(arcData, writable: false);
            using var rarc = new Rarc(stream);
            using var stage = new Stage(rarc)
            {
                Index = targetIndex,
            };

            return SerializeStage(stage);
        }
        catch
        {
            return Array.Empty<byte>();
        }
    }

    /// <summary>
    /// Serializes a stage and normalizes its map CSV files to the exact format
    /// the game expects.
    /// </summary>
    /// <remarks>
    /// FSALib's <see cref="MapLayout.WriteToStream"/> uses <c>StreamWriter</c>,
    /// which on non-Windows runtimes writes <c>\n</c> line endings and a UTF-8
    /// BOM. The game's CSV parser requires <c>\r\n</c> with no BOM, so a plain
    /// round-trip would otherwise produce an archive the game crashes on. This
    /// writes the stage, re-opens the produced RARC and rewrites each
    /// <c>map*.csv</c> file with CRLF endings and no BOM.
    /// </remarks>
    private static byte[] SerializeStage(Stage stage)
    {
        // Phase 1: serialize normally.
        using var first = new MemoryStream();
        stage.WriteToStream(first);
        first.Position = 0;

        // Phase 2: re-open, fix the CSVs, re-serialize.
        using var rarc = new Rarc(first);
        NormalizeCsvFiles(rarc.Root);

        using var final = new MemoryStream();
        rarc.WriteToStream(final, CompressionSettings.Maximum);
        final.WriteAlign(0x10);
        return final.ToArray();
    }

    /// <summary>Rewrites every <c>.csv</c> under the tree with CRLF and no BOM.</summary>
    private static void NormalizeCsvFiles(Rarc.DirectoryNode node)
    {
        foreach (var file in node.Files)
        {
            if (!file.Name.EndsWith(".csv", StringComparison.OrdinalIgnoreCase))
                continue;

            var source = file.Data;
            source.Position = 0;
            using var reader = new StreamReader(source, System.Text.Encoding.UTF8, true, 1024, true);
            string text = reader.ReadToEnd();

            // Strip a UTF-8 BOM if present and normalize to CRLF.
            text = text.TrimStart('\uFEFF');
            text = text.Replace("\r\n", "\n").Replace("\r", "\n").Replace("\n", "\r\n");

            var bytes = System.Text.Encoding.ASCII.GetBytes(text);
            file.Data = new MemoryStream(bytes);
        }

        foreach (var dir in node.Directorys.Values)
            NormalizeCsvFiles(dir);
    }




    /// <summary>
    /// Creates, replaces or deletes a room in the map layout and re-serializes
    /// the stage.
    /// </summary>
    /// <remarks>
    /// The map layout (<c>mapNNN.csv</c>) is what binds a (x, y) grid cell to a
    /// room index, so creating a room means:
    ///
    /// 1. take the next free room slot (<see cref="Stage.GetNextFreeRoom"/>),
    /// 2. give it an id and optional source content — either a copy of another
    ///    room (<c>copyFromRoom &gt;= 0</c>) or a blank room,
    /// 3. point the grid cell at it.
    ///
    /// Deleting clears the cell and then drops every room that no map layout
    /// references any more (<see cref="Stage.RemoveUnusedRooms"/>), so no orphan
    /// files are written back.
    ///
    /// The single-player layout (<c>mapNNN_1.csv</c>) is kept in sync, because
    /// that is the map the game reads in normal play. Shadow-battle stages have
    /// no single-player map and are handled by the null check.
    /// </remarks>
    /// <param name="arcData">Raw bytes of the stage archive.</param>
    /// <param name="x">Grid column of the room cell.</param>
    /// <param name="y">Grid row of the room cell.</param>
    /// <param name="copyFromRoom">
    /// Room index whose content is copied into the new room, or -1 for a blank
    /// room. Ignored when deleting.
    /// </param>
    /// <param name="delete">When true, the cell is emptied instead.</param>
    /// <returns>The re-serialized archive bytes, or an empty array on failure.</returns>
    [JSExport]
    public static byte[] SetRoomSlot(byte[] arcData, int x, int y, int copyFromRoom, bool delete)
    {
        using var trace = Trace("SetRoomSlot", $"({x},{y} copyFrom {copyFromRoom} delete {delete})");
        try
        {
            using var stream = new MemoryStream(arcData, writable: false);
            using var rarc = new Rarc(stream);
            using var stage = new Stage(rarc);

            if (!IsCellInBounds(stage.Map, x, y))
            {
                return Array.Empty<byte>();
            }

            if (delete)
            {
                stage.Map[x, y] = MapLayout.EMPTY_ROOM_VALUE;
                if (stage.MapSingleplayer != null && IsCellInBounds(stage.MapSingleplayer, x, y))
                {
                    stage.MapSingleplayer[x, y] = MapLayout.EMPTY_ROOM_VALUE;
                }
                stage.RemoveUnusedRooms();
                return SerializeStage(stage);
            }

            int roomIndex = stage.GetNextFreeRoom();
            if (roomIndex < 0)
            {
                Log("SetRoomSlot: no free room slot.");
                return Array.Empty<byte>();
            }

            Room room;
            if (copyFromRoom >= 0 && copyFromRoom < stage.Rooms.Length && stage.Rooms[copyFromRoom] is { } source)
            {
                room = CloneRoom(source);
            }
            else
            {
                room = new Room();
            }
            stage.Rooms[roomIndex] = room;

            // Bind BOTH layouts to the new room: the game plays the
            // single-player one, while the editor/previews read the shared map.
            stage.Map[x, y] = roomIndex;
            if (stage.MapSingleplayer != null && IsCellInBounds(stage.MapSingleplayer, x, y))
            {
                stage.MapSingleplayer[x, y] = roomIndex;
            }

            return SerializeStage(stage);
        }
        catch (Exception ex)
        {
            Log($"SetRoomSlot failed: {ex}");
            return Array.Empty<byte>();
        }
    }

    /// <summary>
    /// Pastes a room taken from ANOTHER stage archive into a grid cell of the
    /// destination stage, then re-serializes the destination.
    /// </summary>
    /// <remarks>
    /// Cross-stage pasting cannot just reference a room index (room indices and
    /// file names are per archive), so the source room's layers and actors are
    /// deep-copied into a fresh slot of the destination stage — exactly what
    /// <see cref="SetRoomSlot"/> does for a same-stage paste.
    ///
    /// Both map layouts of the destination are rebound, because the game plays
    /// the single-player map (<c>mapNNN_1.csv</c>).
    /// </remarks>
    /// <param name="destArcData">Raw bytes of the DESTINATION stage archive.</param>
    /// <param name="sourceArcData">Raw bytes of the SOURCE stage archive.</param>
    /// <param name="x">Grid column in the destination stage.</param>
    /// <param name="y">Grid row in the destination stage.</param>
    /// <param name="sourceRoomIndex">Room index to copy inside the source stage.</param>
    /// <returns>The re-serialized destination archive, or an empty array on failure.</returns>
    [JSExport]
    public static byte[] PasteRoomFromStage(
        byte[] destArcData,
        byte[] sourceArcData,
        int x,
        int y,
        int sourceRoomIndex)
    {
        using var trace = Trace(
            "PasteRoomFromStage",
            $"({x},{y} from room {sourceRoomIndex})");
        try
        {
            Room? sourceRoom;
            using (var sourceStream = new MemoryStream(sourceArcData, writable: false))
            using (var sourceRarc = new Rarc(sourceStream))
            using (var sourceStage = new Stage(sourceRarc))
            {
                if (sourceRoomIndex < 0 || sourceRoomIndex >= sourceStage.Rooms.Length)
                {
                    Log("PasteRoomFromStage: source room out of range.");
                    return Array.Empty<byte>();
                }
                sourceRoom = sourceStage.Rooms[sourceRoomIndex];
            }
            if (sourceRoom == null)
            {
                Log("PasteRoomFromStage: source room is empty.");
                return Array.Empty<byte>();
            }

            using var destStream = new MemoryStream(destArcData, writable: false);
            using var destRarc = new Rarc(destStream);
            using var destStage = new Stage(destRarc);

            if (!IsCellInBounds(destStage.Map, x, y))
            {
                return Array.Empty<byte>();
            }

            int roomIndex = destStage.GetNextFreeRoom();
            if (roomIndex < 0)
            {
                Log("PasteRoomFromStage: no free room slot.");
                return Array.Empty<byte>();
            }

            destStage.Rooms[roomIndex] = CloneRoom(sourceRoom);
            destStage.Map[x, y] = roomIndex;
            if (destStage.MapSingleplayer != null && IsCellInBounds(destStage.MapSingleplayer, x, y))
            {
                destStage.MapSingleplayer[x, y] = roomIndex;
            }

            return SerializeStage(destStage);
        }
        catch (Exception ex)
        {
            Log($"PasteRoomFromStage failed: {ex}");
            return Array.Empty<byte>();
        }
    }

    private static bool IsCellInBounds(MapLayout layout, int x, int y)
        => x >= 0 && y >= 0 && x < layout.XDimension && y < layout.YDimension;

    /// <summary>
    /// Moves a stage's start room to an existing room cell and re-serializes the
    /// archive.
    /// </summary>
    /// <remarks>
    /// The start room is stored as a grid position, not a room index:
    /// <c>MapLayout.StartX</c> / <c>MapLayout.StartY</c> in the map CSV header
    /// (<c>mapNNN,x,y,...</c>). Both layouts are updated because the game reads
    /// the single-player map (<c>mapNNN_1.csv</c>) in normal play.
    ///
    /// The cell must already contain a room — this only relocates the entry
    /// point, it never creates a room.
    /// </remarks>
    /// <param name="arcData">Raw bytes of the stage archive.</param>
    /// <param name="x">Grid column of the new start cell.</param>
    /// <param name="y">Grid row of the new start cell.</param>
    /// <returns>The re-serialized archive bytes, or an empty array on failure.</returns>
    [JSExport]
    public static byte[] SetStartRoom(byte[] arcData, int x, int y)
    {
        using var trace = Trace("SetStartRoom", $"({x},{y})");
        try
        {
            using var stream = new MemoryStream(arcData, writable: false);
            using var rarc = new Rarc(stream);
            using var stage = new Stage(rarc);

            if (!IsCellInBounds(stage.Map, x, y) || stage.Map[x, y] == MapLayout.EMPTY_ROOM_VALUE)
            {
                Log($"SetStartRoom: cell ({x},{y}) is empty or out of bounds.");
                return Array.Empty<byte>();
            }

            stage.Map.StartX = x;
            stage.Map.StartY = y;
            if (stage.MapSingleplayer != null && IsCellInBounds(stage.MapSingleplayer, x, y))
            {
                stage.MapSingleplayer.StartX = x;
                stage.MapSingleplayer.StartY = y;
            }

            return SerializeStage(stage);
        }
        catch (Exception ex)
        {
            Log($"SetStartRoom failed: {ex}");
            return Array.Empty<byte>();
        }
    }

    /// <summary>
    /// Deep-copies a room's layers and actors.
    /// </summary>
    /// <remarks>
    /// <see cref="Room"/> exposes its layers as a <c>ReadOnlySpan</c> of mutable
    /// <see cref="Layer"/> objects, so a new room is built by copying the tile
    /// arrays across (the actor list is rebuilt from the source's actors).
    /// </remarks>
    private static Room CloneRoom(Room source)
    {
        var room = new Room();
        var layers = source.Layers;
        for (int i = 0; i < layers.Length; i++)
        {
            room.Layers[i].SetTiles(layers[i].Tiles, 0);
        }
        foreach (var actor in source.Actors)
        {
            room.Actors.Add(actor);
        }
        return room;
    }


    /// <summary>Liveness probe returning the FSALib version.</summary>
    [JSExport]
    public static string GetVersion()
    {
        using var trace = Trace("GetVersion");
        return typeof(Stage).Assembly.GetName().Version?.ToString() ?? "unknown";
    }

    /// <summary>
    /// Applies a whole room save in ONE deserialize/serialize cycle.
    /// </summary>
    /// <remarks>
    /// Saving used to call one setter per change — <c>SetStageTileSheet</c>,
    /// <c>SetStageBackgroundMusic</c>, one <c>SetRoomLayer</c> per dirty layer and
    /// one <c>SetRoomActors</c> per dirty room. Every one of those re-opened the
    /// archive, ran a full (double) re-serialization and handed the whole archive
    /// back across the WASM boundary; a single room save therefore paid that cost
    /// around five times.
    ///
    /// This method opens the archive ONCE, applies every pending change to the
    /// in-memory <see cref="Stage"/>, and serializes once. It produces exactly the
    /// same bytes, because all of these fields live in files that
    /// <see cref="SerializeStage"/> rewrites as a unit anyway.
    ///
    /// Every argument is optional (`null`/empty skips that part), so the caller can
    /// pass only what actually changed.
    /// </remarks>
    /// <param name="arcData">Raw bytes of the stage archive.</param>
    /// <param name="tileSheetId">Tileset id to write into both map headers, or -1 to leave it.</param>
    /// <param name="musicId">Background music id to write into both map headers, or -1 to leave it.</param>
    /// <param name="layersJson">
    /// JSON array of <c>{ roomIndex, layerIndex, tiles }</c>. Each entry replaces
    /// that room layer's 1024 tiles.
    /// </param>
    /// <param name="actorsJson">
    /// JSON array of <c>{ roomIndex, actors }</c>. Each entry replaces that room's
    /// actor list.
    /// </param>
    /// <returns>The re-serialized archive bytes, or an empty array on failure.</returns>
    [JSExport]
    public static byte[] SaveRoom(
        byte[] arcData,
        int tileSheetId,
        int musicId,
        string? layersJson,
        string? actorsJson)
    {
        using var trace = Trace("SaveRoom", $"(tileset {tileSheetId}, music {musicId})");
        try
        {
            List<RoomLayerDto> layers = new();
            if (!string.IsNullOrEmpty(layersJson))
            {
                var parsed = JsonSerializer.Deserialize<List<RoomLayerDto>>(layersJson, JsonOptions);
                if (parsed == null)
                {
                    Log("SaveRoom: layer payload did not parse.");
                    return Array.Empty<byte>();
                }
                layers = parsed;
            }

            List<RoomActorsDto> actorRooms = new();
            if (!string.IsNullOrEmpty(actorsJson))
            {
                var parsed = JsonSerializer.Deserialize<List<RoomActorsDto>>(actorsJson, JsonOptions);
                if (parsed == null)
                {
                    Log("SaveRoom: actor payload did not parse.");
                    return Array.Empty<byte>();
                }
                actorRooms = parsed;
            }

            // Validate every tile payload BEFORE touching the stage, so a bad
            // request can never leave a half-updated archive behind.
            foreach (var layer in layers)
            {
                if (layer.Tiles == null || layer.Tiles.Length < Layer.TILES)
                {
                    Log($"SaveRoom: room {layer.RoomIndex} layer {layer.LayerIndex} has too few tiles.");
                    return Array.Empty<byte>();
                }
            }

            using var stream = new MemoryStream(arcData, writable: false);
            using var rarc = new Rarc(stream);
            using var stage = new Stage(rarc);

            // --- map headers (tileset + music), both layouts -------------------
            if (tileSheetId >= 0)
            {
                stage.Map.TileSheetId = tileSheetId;
                if (stage.MapSingleplayer != null)
                    stage.MapSingleplayer.TileSheetId = tileSheetId;
            }
            if (musicId >= 0)
            {
                stage.Map.BackgroundMusicId = musicId;
                if (stage.MapSingleplayer != null)
                    stage.MapSingleplayer.BackgroundMusicId = musicId;
            }

            // --- room layers ---------------------------------------------------
            foreach (var layer in layers)
            {
                if (layer.RoomIndex < 0 || layer.RoomIndex >= stage.Rooms.Length)
                {
                    Log($"SaveRoom: room index {layer.RoomIndex} out of range.");
                    return Array.Empty<byte>();
                }
                Room? room = stage.Rooms[layer.RoomIndex];
                if (room == null || layer.LayerIndex < 0 || layer.LayerIndex >= room.Layers.Length)
                {
                    Log($"SaveRoom: layer {layer.LayerIndex} of room {layer.RoomIndex} is missing.");
                    return Array.Empty<byte>();
                }
                room.Layers[layer.LayerIndex].SetTiles(layer.Tiles.AsSpan(0, Layer.TILES), 0);
            }

            // --- room actors ---------------------------------------------------
            foreach (var entry in actorRooms)
            {
                if (entry.RoomIndex < 0 || entry.RoomIndex >= stage.Rooms.Length)
                {
                    Log($"SaveRoom: room index {entry.RoomIndex} out of range (actors).");
                    return Array.Empty<byte>();
                }
                Room? room = stage.Rooms[entry.RoomIndex];
                if (room == null)
                {
                    Log($"SaveRoom: room {entry.RoomIndex} is missing (actors).");
                    return Array.Empty<byte>();
                }

                room.Actors.Clear();
                foreach (var dto in entry.Actors ?? new List<ActorDto>())
                {
                    if (string.IsNullOrEmpty(dto.Id))
                    {
                        // A blank id means the payload did not map onto ActorDto
                        // (e.g. a JSON casing mismatch) — fail loudly instead of
                        // writing a corrupt actor.
                        Log("SaveRoom: actor payload has an empty id.");
                        return Array.Empty<byte>();
                    }
                    room.Actors.Add(new Actor(
                        new Identifier32(dto.Id.AsSpan()),
                        dto.Layer,
                        dto.X,
                        dto.Y,
                        dto.Variable));
                }
            }

            return SerializeStage(stage);
        }
        catch (Exception ex)
        {
            Log($"SaveRoom failed: {ex}");
            return Array.Empty<byte>();
        }
    }

    /// <summary>
    /// Returns every tile that implies an actor, from FSALib's
    /// <c>tileproperties.json</c> (<c>RequiredActorID</c>).
    /// </summary>
    /// <remarks>
    /// The editor uses this to draw an actor's toolbox preview as the TILE that
    /// represents it (e.g. tile 48, the chest, for <c>TKRA</c>) instead of a
    /// sprite, since the game renders many actors through their tile.
    /// </remarks>
    [JSExport]
    public static string GetTileActors()
    {
        using var trace = Trace("GetTileActors");
        try
        {
            EnsureAssets();
            var tiles = new List<TileActorDto>();
            foreach (var pair in FSALib.Assets.TileProperties)
            {
                var definition = pair.Value;
                if (definition?.RequiredActorID is not { } actorId)
                {
                    continue;
                }
                tiles.Add(new TileActorDto
                {
                    Tile = pair.Key,
                    Name = definition.Name,
                    ActorId = actorId.ToString(),
                    ActorValue = definition.ActorValue,
                });
            }

            return JsonSerializer.Serialize(tiles, JsonOptions);
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { error = ex.Message }, JsonOptions);
        }
    }
    /// Merges one stage's *content* (map layout, rooms, actors and layers) into
    /// another stage's archive, keeping the destination's slot structure.
    /// </summary>
    /// <remarks>
    /// Swapping whole archives between slots crashes the game, because each
    /// archive is structurally bound to its own slot. This instead loads the
    /// <paramref name="targetArcData"/> (the slot's own stage, so all of its
    /// slot-specific resources stay valid), overwrites its map layout and every
    /// room's actors/layers with the corresponding data from
    /// <paramref name="sourceArcData"/>, and re-serializes it. The result is a
    /// correctly-shaped <c>bossNNN.arc</c> whose gameplay content comes from the
    /// source stage.
    /// </remarks>
    /// <param name="targetArcData">Archive of the slot to write into.</param>
    /// <param name="sourceArcData">Archive whose content should be copied in.</param>
    /// <returns>The merged archive bytes, or an empty array on failure.</returns>
    [JSExport]
    public static byte[] MergeStageContent(byte[] targetArcData, byte[] sourceArcData)
    {
        using var trace = Trace("MergeStageContent", $"({sourceArcData.Length} → {targetArcData.Length} bytes)");
        try
        {
            using var targetStream = new MemoryStream(targetArcData, writable: false);
            using var targetRarc = new Rarc(targetStream);
            using var target = new Stage(targetRarc);

            using var sourceStream = new MemoryStream(sourceArcData, writable: false);
            using var sourceRarc = new Rarc(sourceStream);
            using var source = new Stage(sourceRarc);

            // Remember the destination slot index; copying the source map below
            // would otherwise drag the source's index along with it.
            int targetIndex = target.Index;

            // --- Map layout(s) -------------------------------------------------
            CopyMapLayout(source.Map, target.Map);
            if (source.MapSingleplayer is not null && target.MapSingleplayer is not null)
                CopyMapLayout(source.MapSingleplayer, target.MapSingleplayer);

            // Re-assert the destination index so every subsequent rename/save
            // writes slot-correct names (B0NN/M0NN, 0NN_…).
            target.Index = targetIndex;

            // --- Rooms (actors + layers) ---------------------------------------
            var targetRooms = target.Rooms;
            var sourceRooms = source.Rooms;
            int count = Math.Min(targetRooms.Length, sourceRooms.Length);
            for (int i = 0; i < count; i++)
            {
                var src = sourceRooms[i];
                if (src is null)
                {
                    targetRooms[i] = null;
                    continue;
                }

                var dst = targetRooms[i] ?? new Room();
                targetRooms[i] = dst;
                CopyRoomContent(src, dst);
            }

            return SerializeStage(target);
        }
        catch
        {
            return Array.Empty<byte>();
        }
    }

    /// <summary>Copies a map layout's serializable state into another instance.</summary>
    private static void CopyMapLayout(MapLayout from, MapLayout to)
    {
        using var buffer = new MemoryStream();
        from.WriteToStream(buffer);
        buffer.Position = 0;
        to.ReadFromStream(buffer);
    }

    /// <summary>Copies a room's actors and every layer into another instance.</summary>
    private static void CopyRoomContent(Room from, Room to)
    {
        // Actors.
        using (var actorBuffer = new MemoryStream())
        {
            from.Actors.WriteToStream(actorBuffer);
            actorBuffer.Position = 0;
            to.Actors.ReadFromStream(actorBuffer);
        }

        // Layers (base + top).
        var fromLayers = from.Layers;
        var toLayers = to.Layers;
        int layerCount = Math.Min(fromLayers.Length, toLayers.Length);
        for (int i = 0; i < layerCount; i++)
        {
            using var layerBuffer = new MemoryStream();
            fromLayers[i].WriteToStream(layerBuffer);
            layerBuffer.Position = 0;
            toLayers[i].ReadFromStream(layerBuffer);
        }
    }

    /// <summary>
    /// Returns the tileset definitions loaded by FSALib (<c>Assets.Tilesets</c>)
    /// as JSON, keyed by tileset id. Lets the Angular renderer resolve tileset
    /// file names without shipping a duplicate copy of the data.
    /// </summary>
    [JSExport]
    public static string GetTilesets()
    {
        using var trace = Trace("GetTilesets");
        try
        {
            var map = new Dictionary<string, TilesetDto>();
            foreach (var pair in FSALib.Assets.Tilesets)
            {
                map[pair.Key.ToString()] = new TilesetDto
                {
                    Name = pair.Value.Name,
                    ID = pair.Value.ID,
                    GbaID = pair.Value.GbaID,
                    AssetState = pair.Value.AssetState == 0
                    ? string.Empty
                    : pair.Value.AssetState.ToString(),
                };
            }
            return JsonSerializer.Serialize(map, JsonOptions);
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { error = ex.Message }, JsonOptions);
        }
    }

    /// <summary>
    /// Returns the song list loaded by FSALib (<c>Assets.Songs</c>) as JSON,
    /// keyed by song id.
    ///
    /// Drives the room editor's background-music dropdown: a stage's
    /// <c>Map.BackgroundMusicId</c> is one of these ids.
    /// </summary>
    [JSExport]
    public static string GetSongs()
    {
        using var trace = Trace("GetSongs");
        try
        {
            var map = new Dictionary<string, string>();
            foreach (var pair in FSALib.Assets.Songs)
            {
                map[pair.Key.ToString()] = pair.Value;
            }
            return JsonSerializer.Serialize(map, JsonOptions);
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { error = ex.Message }, JsonOptions);
        }
    }

    /// <summary>
    /// Returns the stage definitions loaded by FSALib (<c>Assets.Stages</c>) as
    /// JSON, keyed by stage id (e.g. <c>boss010</c>).
    ///
    /// The overview map draws a dot per stage; <c>WorldID</c> plus the
    /// <c>wNN_MM.bti</c> title graphic encode each stage's position on the map.
    /// </summary>
    [JSExport]
    public static string GetStages()
    {
        using var trace = Trace("GetStages");
        try
        {
            var map = new Dictionary<string, StageDefinitionDto>();
            foreach (var pair in FSALib.Assets.Stages)
            {
                map[pair.Key] = new StageDefinitionDto
                {
                    Name = pair.Value.Name,
                    WorldID = pair.Value.WorldID,
                    TextID = pair.Value.TextID,
                    TitleCardGraphic = pair.Value.TitleCardGraphic,
                };
            }
            return JsonSerializer.Serialize(map, JsonOptions);
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { error = ex.Message }, JsonOptions);
        }
    }

    /// <summary>
    /// Returns the actor definitions loaded by FSALib (<c>Assets.Actors</c>) as
    /// JSON, keyed by their 4-character id. Lets the Angular editor list enemy
    /// types and resolve their render variants without shipping a duplicate copy
    /// of the data.
    /// </summary>
    [JSExport]
    public static string GetActors()
    {
        using var trace = Trace("GetActors");
        try
        {
            var map = new Dictionary<string, ActorDefinitionDto>();
            foreach (var pair in FSALib.Assets.Actors)
            {
                var definition = pair.Value;
                var dto = new ActorDefinitionDto
                {
                    Id = pair.Key.ToString(),
                    Name = definition.Name,
                    Description = definition.Description,
                    InternalName = definition.InternalName,
                    Category = definition.Category.ToString(),
                    NoGBASprite = definition.NoGBASprite,
                    Resources = definition.Resources ?? new List<string>(),
                };

                // Variable fields, in catalog order. Exported so the editor can
                // build a bit-accurate context menu without hard-coding each
                // actor's layout (see rawiso/entitymig.md).
                foreach (var field in definition.Fields ?? new List<VariableField>())
                {
                    var fieldDto = new ActorFieldDto
                    {
                        Name = field.Name,
                        Description = field.Description,
                        BitOffset = field.BitOffset,
                        BitSize = field.BitSize,
                        ValueType = field.ValueType.ToString(),
                        Mask = field.Mask,
                    };
                    if (field.EnumValues != null)
                    {
                        foreach (var entry in field.EnumValues.OrderBy(e => e.Key))
                        {
                            fieldDto.Values.Add(new ActorFieldValueDto
                            {
                                Value = entry.Key,
                                Name = entry.Value.Name,
                                Description = entry.Value.Description,
                                Broken = entry.Value.AssetState.HasFlag(AssetFlags.Broken),
                            });
                        }
                    }
                    dto.Fields.Add(fieldDto);
                }

                if (definition.Rendering != null)
                {
                    dto.BitMask = definition.Rendering.BitMask;
                    foreach (var variant in definition.Rendering.Variants)
                    {
                        var key = new ActorRenderKeyDto { Key = variant.Key };
                        foreach (var render in variant.Value)
                        {
                            key.Variants.Add(new ActorRenderVariantDto
                            {
                                XOffset = render.XOffset,
                                YOffset = render.YOffset,
                                XScale = render.XScale,
                                YScale = render.YScale,
                                Rotation = render.Rotation,
                                SpriteIndex = render.SpriteIndex,
                                SpriteListIndex = render.SpriteListIndex,
                                ReplacementPaletteIndex = render.ReplacementPaletteIndex,
                                TargetPaletteIndex = render.TargetPaletteIndex,
                                BtiFile = render.BtiFile,
                            });
                        }
                        dto.Rendering.Add(key);
                    }
                }

                map[dto.Id] = dto;
            }
            return JsonSerializer.Serialize(map, JsonOptions);
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { error = ex.Message }, JsonOptions);
        }
    }

    /// <summary>
    /// Materializes FSALib's embedded asset JSON files and returns every static
    /// definition the editor needs, in a single call.
    /// </summary>
    /// <remarks>
    /// FSALib reads its definitions from a real filesystem (<c>assets/*.json</c>),
    /// which the browser-wasm VFS does not contain by default, and its
    /// <see cref="Assets.Reload"/> re-deserializes all ~370 actor definitions
    /// (several seconds under the wasm interpreter). The Angular app therefore
    /// calls this ONCE at ISO-import time and persists the result to OPFS
    /// (<c>/editor/cache/stageassets.json</c>); every later stage open reads that
    /// file instead of touching the wasm module. Only stage-archive-specific data
    /// (parsing <c>bossNNN.arc</c>) still goes through wasm.
    ///
    /// The returned object mirrors the former individual exports
    /// (<see cref="GetTilesets"/>, <see cref="GetStages"/>,
    /// <see cref="GetActors"/>, <see cref="GetTileActors"/>) so callers can keep
    /// their existing DTO shapes.
    /// </remarks>
    /// <returns>JSON of <see cref="StageAssetsDto"/>, or <c>{ error }</c>.</returns>
    [JSExport]
    public static string GetStageAssets()
    {
        using var trace = Trace("GetStageAssets");
        try
        {
            string error = EnsureAssetsCore();
            if (error.Length > 0)
            {
                return JsonSerializer.Serialize(new { error }, JsonOptions);
            }

            // Each accessor below is a pure projection over the in-memory
            // Assets caches, so the cost is only serialization.
            long tilesetsMs, stagesMs, actorsMs, tileActorsMs, songsMs;
            var timer = System.Diagnostics.Stopwatch.StartNew();
            string tilesetsJson = GetTilesets();
            tilesetsMs = timer.ElapsedMilliseconds;

            timer.Restart();
            string stagesJson = GetStages();
            stagesMs = timer.ElapsedMilliseconds;

            timer.Restart();
            string actorsJson = GetActors();
            actorsMs = timer.ElapsedMilliseconds;

            timer.Restart();
            string tileActorsJson = GetTileActors();
            tileActorsMs = timer.ElapsedMilliseconds;

            timer.Restart();
            string songsJson = GetSongs();
            songsMs = timer.ElapsedMilliseconds;

            if (tilesetsJson.Contains("\"error\"") ||
                stagesJson.Contains("\"error\"") ||
                actorsJson.Contains("\"error\"") ||
                tileActorsJson.Contains("\"error\"") ||
                songsJson.Contains("\"error\""))
            {
                return JsonSerializer.Serialize(
                    new { error = "One or more FSALib accessors returned an error." },
                    JsonOptions);
            }

            Log($"  tilesets={tilesetsMs}ms stages={stagesMs}ms " +
                $"actors={actorsMs}ms tileActors={tileActorsMs}ms songs={songsMs}ms");

            // Embed the already-serialized fragments instead of re-serializing
            // the DTOs, so nothing is parsed twice.
            return
                "{\"Tilesets\":" + tilesetsJson +
                ",\"Stages\":" + stagesJson +
                ",\"Actors\":" + actorsJson +
                ",\"TileActors\":" + tileActorsJson +
                ",\"Songs\":" + songsJson + "}";
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { error = ex.Message }, JsonOptions);
        }
    }

    /// <summary>
    /// Extracts the FSALib asset JSON files embedded in this assembly into the
    /// current working directory, then reloads FSALib's <c>Assets</c> cache.
    ///
    /// Kept as an explicit export for debugging/tooling; production code goes
    /// through <see cref="GetStageAssets"/>, which only needs the one-shot work.
    /// </summary>
    [JSExport]
    public static string EnsureAssets()
    {
        using var trace = Trace("EnsureAssets");
        string error = EnsureAssetsCore();
        return error.Length == 0
            ? JsonSerializer.Serialize(new { tilesets = FSALib.Assets.Tilesets.Count }, JsonOptions)
            : JsonSerializer.Serialize(new { error }, JsonOptions);
    }

    /// <summary>
    /// One-shot asset materialization + <see cref="FSALib.Assets.Reload"/>.
    /// </summary>
    /// <returns>An error message, or an empty string on success.</returns>
    private static string EnsureAssetsCore()
    {
        string actorsDirectory = Path.Combine("assets", "actors");

        // The extracted asset tree is the only state we keep: FSALib's Assets
        // cache is populated by its static constructor, so once the files are on
        // disk the definitions are already loaded and reloading them would only
        // re-deserialize every actor JSON (several seconds in wasm).
        if (File.Exists(Path.Combine("assets", "tilesets.json")) &&
            Directory.Exists(actorsDirectory))
        {
            return string.Empty;
        }

        var total = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            var assembly = typeof(FsaInterop).Assembly;
            int written = 0;

            foreach (string resource in assembly.GetManifestResourceNames())
            {
                if (!resource.StartsWith("assets/", StringComparison.Ordinal))
                {
                    continue;
                }

                string relative = resource["assets/".Length..].Replace('/', Path.DirectorySeparatorChar);
                string destination = Path.Combine("assets", relative);
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);

                using Stream? source = assembly.GetManifestResourceStream(resource);
                if (source is null)
                {
                    continue;
                }
                using FileStream target = File.Create(destination);
                source.CopyTo(target);
                written++;
            }

            long extractDone = total.ElapsedMilliseconds;
            var reloadTimer = System.Diagnostics.Stopwatch.StartNew();
            FSALib.Assets.Reload();
            long reloadMs = reloadTimer.ElapsedMilliseconds;

            Log(
                $"  written={written} extract(until)={extractDone}ms " +
                $"reload={reloadMs}ms total={total.ElapsedMilliseconds}ms");
            return string.Empty;
        }
        catch (Exception ex)
        {
            Log($"EnsureAssets failed after {total.ElapsedMilliseconds}ms: {ex.Message}");
            return ex.Message;
        }
    }

    /// <summary>
    /// Caches a shared archive (e.g. `data.arc`) inside the wasm module so its
    /// bytes no longer cross the JS↔wasm boundary on every read.
    /// </summary>
    /// <remarks>
    /// Every export call marshals its arguments into the wasm heap, so
    /// <see cref="ReadArchiveFile(byte[], string)"/> copied the whole ~1.2 MB
    /// `data.arc` per call — about a second under the interpreter, regardless of
    /// how small the file being read was. Caching the archive makes that a
    /// one-time cost per session; afterwards only the requested payloads move.
    ///
    /// The cache holds at most two archives (the stage's `.arc` can also be
    /// registered), evicting the least recently used one.
    /// </remarks>
    /// <param name="key">Logical name for the archive, e.g. `data.arc`.</param>
    /// <param name="arcData">Raw archive bytes (optionally YAZ0-compressed).</param>
    /// <returns>JSON `{ cached: true, bytes }`.</returns>
    [JSExport]
    public static string CacheArchive(string key, byte[] arcData)
    {
        using var trace = Trace("CacheArchive", $"({key}, {arcData.Length} bytes)");
        if (cachedArchives.TryGetValue(key, out var entry) &&
            entry.Data.Length == arcData.Length)
        {
            // Same key and size: keep the parse, just refresh the usage order.
            cachedArchives.Remove(key);
            cachedArchives[key] = entry;
            return JsonSerializer.Serialize(
                new { cached = true, bytes = entry.Data.Length, reused = true },
                JsonOptions);
        }

        // Bound the cache to two archives (LRU): a stage + the shared data.arc.
        while (cachedArchives.Count >= 2)
        {
            cachedArchives.Remove(cachedArchives.First().Key);
        }

        cachedArchives[key] = new CachedArchive(arcData);
        Log($"  cached '{key}' ({arcData.Length} bytes)");
        return JsonSerializer.Serialize(new { cached = true, bytes = arcData.Length }, JsonOptions);
    }

    /// <summary>One parsed archive held in wasm memory.</summary>
    private sealed class CachedArchive
    {
        public CachedArchive(byte[] data) => Data = data;

        public byte[] Data { get; }
    }

    /// <summary>Archives cached in wasm memory, keyed by logical name (LRU order).</summary>
    private static readonly Dictionary<string, CachedArchive> cachedArchives = new();

    /// <summary>
    /// Reads many files out of a cached archive in a single JS→wasm call.
    /// </summary>
    /// <remarks>
    /// This is the fast path for rendering: the archive was registered once via
    /// <see cref="CacheArchive(string, byte[])"/>, so each call transfers only the
    /// requested payloads instead of the whole archive. Paths that do not exist
    /// are simply absent from the returned array, matching the caller's
    /// resolve-then-read flow.
    ///
    /// Returns `byte[][]` rather than JSON/base64 because the source-generated
    /// interop can marshal nested byte arrays directly — no encoding overhead.
    /// The requested paths are therefore passed as a single newline-separated
    /// string (string arrays are not supported by the generator).
    /// </remarks>
    /// <param name="archiveKey">Key the archive was cached under, e.g. `data.arc`.</param>
    /// <param name="pathsNewlineSeparated">File paths separated by `\n`.</param>
    /// <returns>
    /// One packed buffer: a 4-byte little-endian count, then a 4-byte
    /// little-endian length per entry, then every payload back-to-back. A
    /// single `byte[]` is used because source-generated interop cannot marshal
    /// nested arrays, and packing avoids base64/JSON overhead entirely.
    /// Entries that could not be read are reported with length -1.
    /// </returns>
    [JSExport]
    public static byte[] ReadCachedArchiveFiles(string archiveKey, string pathsNewlineSeparated)
    {
        using var trace = Trace("ReadCachedArchiveFiles", $"({archiveKey})");
        if (!cachedArchives.TryGetValue(archiveKey, out var cached))
        {
            throw new InvalidOperationException($"Archive '{archiveKey}' is not cached.");
        }

        string[] paths = pathsNewlineSeparated.Split(
            '\n',
            StringSplitOptions.RemoveEmptyEntries);

        using var stream = new MemoryStream(cached.Data, writable: false);
        using var rarc = new Rarc(stream);

        // Read every payload first so the total size is known up front.
        var payloads = new byte[]?[paths.Length];
        long totalBytes = 0;
        for (int i = 0; i < paths.Length; i++)
        {
            try
            {
                Rarc.DirectoryNode dir = rarc.Root;
                string[] segments = paths[i]
                    .Replace('\\', '/')
                    .Split('/', StringSplitOptions.RemoveEmptyEntries);
                for (int j = 0; j < segments.Length - 1; j++)
                {
                    dir = dir.Directorys[
                        new AuroraLib.Core.Format.Identifier.Identifier32(segments[j].AsSpan())];
                }

                Rarc.FileNode file = dir.GetFile(segments[^1]);
                using var ms = new MemoryStream();
                file.Data.Position = 0;
                file.Data.CopyTo(ms);
                payloads[i] = ms.ToArray();
                totalBytes += payloads[i]!.Length;
            }
            catch
            {
                // Unreadable/missing paths are marked -1; the caller tolerates
                // absent resources.
                payloads[i] = null;
            }
        }

        int headerSize = 4 + paths.Length * 4;
        var packed = new byte[headerSize + totalBytes];
        WriteInt32LE(packed, 0, paths.Length);
        int offset = headerSize;
        for (int i = 0; i < paths.Length; i++)
        {
            var payload = payloads[i];
            WriteInt32LE(packed, 4 + i * 4, payload?.Length ?? -1);
            if (payload != null)
            {
                Buffer.BlockCopy(payload, 0, packed, offset, payload.Length);
                offset += payload.Length;
            }
        }

        Log($"  {paths.Length} requested, {totalBytes} byte(s) packed");
        return packed;
    }

    /// <summary>Writes a 32-bit little-endian integer (JS uses DataView LE).</summary>
    private static void WriteInt32LE(byte[] buffer, int offset, int value)
    {
        buffer[offset] = (byte)value;
        buffer[offset + 1] = (byte)(value >> 8);
        buffer[offset + 2] = (byte)(value >> 16);
        buffer[offset + 3] = (byte)(value >> 24);
    }

    /// <summary>
    /// Lists every file entry in a RARC archive with its full path and size.
    /// Used by the Angular app to locate image data (e.g. inside data.arc).
    /// </summary>
    [JSExport]
    public static string ListArchiveFiles(byte[] arcData)
    {
        using var trace = Trace("ListArchiveFiles", $"({arcData.Length} bytes)");
        try
        {
            using var stream = new MemoryStream(arcData, writable: false);
            using var rarc = new Rarc(stream);

            var list = new List<ArchiveFileDto>();
            WalkDirectory(rarc.Root, string.Empty, list);
            return JsonSerializer.Serialize(list, JsonOptions);
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { error = ex.Message }, JsonOptions);
        }
    }

    /// <summary>
    /// Reads a single file from a RARC archive by its full path.
    /// Returns the raw bytes (YAZ0/YAY0 already decompressed by FSALib).
    /// </summary>
    [JSExport]
    public static byte[] ReadArchiveFile(byte[] arcData, string path)
    {
        using var trace = Trace("ReadArchiveFile", $"({path})");
        using var stream = new MemoryStream(arcData, writable: false);
        using var rarc = new Rarc(stream);

        Rarc.DirectoryNode dir = rarc.Root;
        string[] segments = path.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        for (int i = 0; i < segments.Length - 1; i++)
        {
            dir = dir.Directorys[new AuroraLib.Core.Format.Identifier.Identifier32(segments[i].AsSpan())];
        }

        Rarc.FileNode file = dir.GetFile(segments[^1]);
        using var ms = new MemoryStream();
        file.Data.Position = 0;
        file.Data.CopyTo(ms);
        return ms.ToArray();
    }

    /// <summary>
    /// Lists every <c>.bti</c> texture anywhere in a RARC archive, with the path
    /// that <see cref="ReadArchiveFile"/> accepts.
    /// </summary>
    /// <remarks>
    /// Used at ISO-import time to generate actor sprite icons from the game's own
    /// textures. Returns a JSON array of <c>{ Path, Name, Size }</c>.
    /// </remarks>
    [JSExport]
    public static string ListArchiveTextures(byte[] arcData)
    {
        using var trace = Trace("ListArchiveTextures", $"({arcData.Length} bytes)");
        try
        {
            using var stream = new MemoryStream(arcData, writable: false);
            using var rarc = new Rarc(stream);

            var list = new List<ArchiveFileDto>();
            WalkDirectory(rarc.Root, string.Empty, list);
            var textures = list
                .Where(f => f.Path.EndsWith(".bti", StringComparison.OrdinalIgnoreCase))
                .ToList();
            return JsonSerializer.Serialize(textures, JsonOptions);
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { error = ex.Message }, JsonOptions);
        }
    }

    /// <summary>
    /// Extracts every file from a ZIP archive and returns them as JSON, each
    /// entry carrying its path and base64-encoded contents.
    /// </summary>
    /// <remarks>
    /// Used to import a shared stage package (a zip holding a <c>manifest.json</c>
    /// and a <c>stage.arc</c>). Directory entries are skipped.
    /// </remarks>
    /// <param name="zipData">Raw bytes of the ZIP archive.</param>
    /// <returns>JSON array of <see cref="ZipEntryDto"/>, or an error object.</returns>
    [JSExport]
    public static string Unzip(byte[] zipData)
    {
        using var trace = Trace("Unzip", $"({zipData.Length} bytes)");
        try
        {
            using var stream = new MemoryStream(zipData, writable: false);
            using var archive = new System.IO.Compression.ZipArchive(stream, System.IO.Compression.ZipArchiveMode.Read);

            var entries = new List<ZipEntryDto>();
            foreach (var entry in archive.Entries)
            {
                // Skip pure directory entries (they have an empty name).
                if (string.IsNullOrEmpty(entry.Name))
                {
                    continue;
                }

                using var entryStream = entry.Open();
                using var buffer = new MemoryStream();
                entryStream.CopyTo(buffer);

                entries.Add(new ZipEntryDto
                {
                    Path = entry.FullName.Replace('\\', '/'),
                    Data = Convert.ToBase64String(buffer.ToArray()),
                });
            }

            return JsonSerializer.Serialize(entries, JsonOptions);
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { error = ex.Message }, JsonOptions);
        }
    }

    private static void WalkDirectory(Rarc.DirectoryNode dir, string prefix, List<ArchiveFileDto> list)
    {
        foreach (Rarc.FileNode file in dir.Files)
        {
            list.Add(new ArchiveFileDto
            {
                Path = prefix.Length == 0 ? file.Name : $"{prefix}/{file.Name}",
                Name = file.Name,
                Size = (int)file.Length,
            });
        }

        foreach (var pair in dir.Directorys)
        {
            string name = pair.Key.ToString();
            WalkDirectory(pair.Value, prefix.Length == 0 ? name : $"{prefix}/{name}", list);
        }
    }

    private static StageDto ToDto(Stage stage) => new()
    {
        Index = stage.Index,
        Map = ToMapDto(stage.Map),
        MapSingleplayer = stage.MapSingleplayer is null ? null : ToMapDto(stage.MapSingleplayer),
        Rooms = ToRooms(stage),
        Resources = ToDirectoryDto(stage.Resources),
    };

    private static List<RoomDto?> ToRooms(Stage stage)
    {
        var rooms = new List<RoomDto?>();
        Span<Room?> span = stage.Rooms;
        for (int i = 0; i < span.Length; i++)
        {
            rooms.Add(span[i] is { } room ? ToRoomDto(room) : null);
        }
        return rooms;
    }

    private static MapLayoutDto ToMapDto(MapLayout map)
    {
        var dto = new MapLayoutDto
        {
            Index = map.Index,
            StartX = map.StartX,
            StartY = map.StartY,
            IsShadowBattle = map.IsShadowBattle,
            BackgroundMusicId = map.BackgroundMusicId,
            TileSheetId = map.TileSheetId,
            NpcSheetId = map.NPCSheetID,
            OverlayTextureId = map.OverlayTextureId,
            XDimension = map.XDimension,
            YDimension = map.YDimension,
            EmptyRoomValue = MapLayout.EMPTY_ROOM_VALUE,
        };

        for (int y = 0; y < map.YDimension; y++)
        {
            for (int x = 0; x < map.XDimension; x++)
            {
                dto.Rooms.Add(map[x, y]);
            }
        }
        return dto;
    }

    private static RoomDto ToRoomDto(Room room)
    {
        var dto = new RoomDto();

        foreach (Layer layer in room.Layers)
        {
            var layerDto = new LayerDto();
            foreach (ushort tile in layer.Tiles)
            {
                layerDto.Tiles.Add(tile);
            }
            dto.Layers.Add(layerDto);
        }

        foreach (Actor actor in room.Actors)
        {
            dto.Actors.Add(new ActorDto
            {
                Id = actor.ID.ToString(),
                Layer = actor.Layer,
                X = actor.XCoord,
                Y = actor.YCoord,
                Variable = actor.Variable,
            });
        }

        return dto;
    }

    private static RarcDirectoryDto ToDirectoryDto(Rarc.DirectoryNode dir)
    {
        var dto = new RarcDirectoryDto { Name = dir.Name };

        foreach (Rarc.FileNode file in dir.Files)
        {
            dto.Files.Add(file.Name);
        }

        foreach (var pair in dir.Directorys)
        {
            dto.Directories[pair.Key.ToString()] = ToDirectoryDto(pair.Value);
        }

        return dto;
    }
}
