using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;
using System.Text.Json.Serialization;
using AuroraLib.Compression;
using AuroraLib.Core.IO;
using FSALib;
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
    };

    /// <summary>
    /// Parses a stage archive (<c>bossXXX.arc</c>, optionally YAZ0-compressed)
    /// and returns its <see cref="StageDto"/> as JSON.
    /// </summary>
    [JSExport]
    public static string ParseStage(byte[] arcData)
    {
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
    /// Sets a stage's tileset (its <c>Map.TileSheetId</c>) and re-serializes the
    /// archive, so the change is written back into the stage's own <c>.arc</c>.
    /// </summary>
    /// <remarks>
    /// The tileset id lives in the map's CSV header. A stage carries TWO maps:
    /// <c>mapNNN.csv</c> (the shared/multiplayer map, <see cref="Stage.Map"/>) and
    /// <c>mapNNN_1.csv</c> (the single-player map,
    /// <see cref="Stage.MapSingleplayer"/>, which is what the game actually uses
    /// in single-player). Both headers must be updated or the game keeps drawing
    /// the old tileset. Serialization goes through <see cref="SerializeStage"/>
    /// so the CSVs keep the CRLF/no-BOM format the game requires.
    /// </remarks>
    /// <param name="arcData">Raw bytes of the stage archive.</param>
    /// <param name="tileSheetId">New tileset index to store.</param>
    /// <returns>The re-serialized archive bytes, or an empty array on failure.</returns>
    [JSExport]
    public static byte[] SetStageTileSheet(byte[] arcData, int tileSheetId)
    {
        try
        {
            using var stream = new MemoryStream(arcData, writable: false);
            using var rarc = new Rarc(stream);
            using var stage = new Stage(rarc);
            stage.Map.TileSheetId = tileSheetId;
            // The single-player map (`mapNNN_1.csv`) is a separate CSV and is the
            // one the game reads in single-player, so it must be updated too.
            // Shadow-battle stages have no single-player map.
            if (stage.MapSingleplayer != null)
            {
                stage.MapSingleplayer.TileSheetId = tileSheetId;
            }
            return SerializeStage(stage);
        }
        catch
        {
            return Array.Empty<byte>();
        }
    }

    /// <summary>Liveness probe returning the FSALib version.</summary>
    [JSExport]
    public static string GetVersion()
        => typeof(Stage).Assembly.GetName().Version?.ToString() ?? "unknown";
    /// <summary>
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
    /// Returns the stage definitions loaded by FSALib (<c>Assets.Stages</c>) as
    /// JSON, keyed by stage id (e.g. <c>boss010</c>).
    ///
    /// The overview map draws a dot per stage; <c>WorldID</c> plus the
    /// <c>wNN_MM.bti</c> title graphic encode each stage's position on the map.
    /// </summary>
    [JSExport]
    public static string GetStages()
    {
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
    /// Extracts the FSALib asset JSON files embedded in this assembly into the
    /// current working directory, then reloads FSALib's <c>Assets</c> cache.
    ///
    /// FSALib loads its definitions from a real filesystem (<c>assets/*.json</c>),
    /// which the browser-wasm VFS does not contain by default. Idempotent.
    /// </summary>
    [JSExport]
    public static string EnsureAssets()
    {
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

            FSALib.Assets.Reload();
            return JsonSerializer.Serialize(new { files = written, tilesets = FSALib.Assets.Tilesets.Count }, JsonOptions);
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { error = ex.Message }, JsonOptions);
        }
    }

    /// <summary>
    /// Lists every file entry in a RARC archive with its full path and size.
    /// Used by the Angular app to locate image data (e.g. inside data.arc).
    /// </summary>
    [JSExport]
    public static string ListArchiveFiles(byte[] arcData)
    {        try
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
