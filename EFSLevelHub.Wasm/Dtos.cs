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

/// <summary>A single entry extracted from a ZIP archive.</summary>
public sealed class ZipEntryDto
{
    /// <summary>Path of the entry inside the zip, using forward slashes.</summary>
    public string Path { get; set; } = string.Empty;

    /// <summary>Base64-encoded contents of the entry.</summary>
    public string Data { get; set; } = string.Empty;
}

/// <summary>JSON-serializable projection of a FSALib <c>TilesetDefinition</c>.</summary>
public sealed class TilesetDto
{
    public string Name { get; set; } = string.Empty;

    /// <summary>Internal tileset id used by the game's file naming convention.</summary>
    public string ID { get; set; } = string.Empty;

    /// <summary>Alternative id for the GBA-specific tileset files, if any.</summary>
    public string? GbaID { get; set; }

    /// <summary>
    /// Comma-separated asset flags (e.g. <c>"Development"</c>), or empty when the
    /// tileset is considered finished. Mirrors <c>AssetFlags</c>.
    /// </summary>
    public string AssetState { get; set; } = string.Empty;
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

/// <summary>
/// One render variant of an actor, projected from a FSALib
/// <c>ActorRenderVariant</c>.
/// </summary>
public sealed class ActorRenderVariantDto
{
    public short XOffset { get; set; }
    public short YOffset { get; set; }
    public float XScale { get; set; } = 1;
    public float YScale { get; set; } = 1;
    public float Rotation { get; set; }
    public short SpriteIndex { get; set; } = -1;
    public ushort SpriteListIndex { get; set; }
    public sbyte ReplacementPaletteIndex { get; set; } = -1;
    public sbyte TargetPaletteIndex { get; set; } = -1;
    public string BtiFile { get; set; } = string.Empty;
}

/// <summary>
/// A single variable key of an actor's render definition: the value of
/// <c>actor.Variable &amp; BitMask</c> and the variants drawn for it.
/// </summary>
public sealed class ActorRenderKeyDto
{
    public int Key { get; set; }
    public List<ActorRenderVariantDto> Variants { get; set; } = new();
}

/// <summary>JSON-serializable projection of a FSALib <c>ActorDefinition</c>.</summary>
public sealed class ActorDefinitionDto
{
    /// <summary>4-character actor id (e.g. <c>AMOS</c>).</summary>
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string InternalName { get; set; } = string.Empty;

    /// <summary>Category name (e.g. <c>Enemy</c>, <c>Boss</c>, <c>NPC</c>).</summary>
    public string Category { get; set; } = string.Empty;

    public bool NoGBASprite { get; set; }

    /// <summary>Level resource names used to locate the actor's sprite files.</summary>
    public List<string> Resources { get; set; } = new();

    /// <summary>Bit mask applied to <c>actor.Variable</c> to pick a variant key.</summary>
    public uint BitMask { get; set; }

    /// <summary>Render variants keyed by <c>Variable &amp; BitMask</c>.</summary>
    public List<ActorRenderKeyDto> Rendering { get; set; } = new();
}
