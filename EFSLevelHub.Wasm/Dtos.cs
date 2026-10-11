namespace EFSLevelHub.Wasm;

/// <summary>
/// JSON-serializable projection of a FSALib <c>Stage</c>.
/// These DTOs exist because the FSALib entity graph can't be serialized
/// directly (it exposes <c>Span&lt;T&gt;</c> properties and <c>Stream</c> data).
/// </summary>
public sealed class StageDto
{
    public int Index { get; set; }
    public MapLayoutDto Map { get; set; } = new();
    public MapLayoutDto? MapSingleplayer { get; set; }
    public List<RoomDto?> Rooms { get; set; } = new();
    public RarcDirectoryDto Resources { get; set; } = new();
}

/// <summary>JSON-serializable projection of a FSALib <c>MapLayout</c>.</summary>
public sealed class MapLayoutDto
{
    public int Index { get; set; }
    public int StartX { get; set; }
    public int StartY { get; set; }
    public bool IsShadowBattle { get; set; }
    public int BackgroundMusicId { get; set; }
    public int TileSheetId { get; set; }
    public int NpcSheetId { get; set; }
    public int OverlayTextureId { get; set; }
    public int XDimension { get; set; }
    public int YDimension { get; set; }
    public int EmptyRoomValue { get; set; }

    /// <summary>Row-major room indices, length = XDimension * YDimension.</summary>
    public List<int> Rooms { get; set; } = new();
}

/// <summary>JSON-serializable projection of a FSALib <c>Room</c>.</summary>
public sealed class RoomDto
{
    public List<LayerDto> Layers { get; set; } = new();
    public List<ActorDto> Actors { get; set; } = new();
}

/// <summary>JSON-serializable projection of a FSALib <c>Layer</c>.</summary>
public sealed class LayerDto
{
    public List<ushort> Tiles { get; set; } = new();
}

/// <summary>JSON-serializable projection of a FSALib <c>Actor</c>.</summary>
public sealed class ActorDto
{
    public string Id { get; set; } = string.Empty;
    public byte Layer { get; set; }
    public byte X { get; set; }
    public byte Y { get; set; }
    public uint Variable { get; set; }
}

/// <summary>JSON-serializable projection of a FSALib <c>Rarc.DirectoryNode</c>.</summary>
public sealed class RarcDirectoryDto
{
    public string Name { get; set; } = string.Empty;
    public List<string> Files { get; set; } = new();
    public Dictionary<string, RarcDirectoryDto> Directories { get; set; } = new();
}

/// <summary>A single file entry inside a RARC archive.</summary>
public sealed class ArchiveFileDto
{
    /// <summary>Full path relative to the archive root, e.g. `timg/foo.bti`.</summary>
    public string Path { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int Size { get; set; }
}

/// <summary>JSON-serializable projection of a FSALib <c>TilesetDefinition</c>.</summary>
public sealed class TilesetDto
{
    public string Name { get; set; } = string.Empty;

    /// <summary>Internal tileset id used by the game's file naming convention.</summary>
    public string ID { get; set; } = string.Empty;

    /// <summary>Alternative id for the GBA-specific tileset files, if any.</summary>
    public string? GbaID { get; set; }
}

/// <summary>JSON-serializable projection of a FSALib <c>StageDefinition</c>.</summary>
public sealed class StageDefinitionDto
{
    public string Name { get; set; } = string.Empty;

    /// <summary>Identifier of the world this stage belongs to.</summary>
    public int WorldID { get; set; }

    /// <summary>Text index from the BMD archive.</summary>
    public int TextID { get; set; }

    /// <summary>Texture shown as the stage title card, e.g. <c>w01_03.bti</c>.</summary>
    public string TitleCardGraphic { get; set; } = string.Empty;
}
