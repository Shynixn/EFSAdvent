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
