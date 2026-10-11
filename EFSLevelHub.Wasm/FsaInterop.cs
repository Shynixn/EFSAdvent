using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;
using System.Text.Json.Serialization;
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

    /// <summary>Liveness probe returning the FSALib version.</summary>
    [JSExport]
    public static string GetVersion()
        => typeof(Stage).Assembly.GetName().Version?.ToString() ?? "unknown";

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
    {
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
