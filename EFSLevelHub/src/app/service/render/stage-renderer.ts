/**
 * Stage renderer.
 *
 * Port of `FSALib.Rendering.StageRenderer<TColor>`. Renders a room's tile layers
 * (base + top), actors, and the TV overlay onto an `ImageBuffer`, matching the
 * C# draw order and palette handling.
 *
 * Data comes from the WASM `StageData` entity graph plus the stage's RARC
 * resource archive (read through `FSALibService`).
 */
import { ActorData, LayerData, RoomData, StageData } from '../../entity/fsalib.entity';
import {
  ActorDefinition,
  ActorRenderVariant,
  actorVariants,
} from '../../entity/actor-definition.entity';
import { SmartObjectDefinition, renderSmartObjectPreview } from '../../entity/smartobject.entity';
import { BtiTexture, parseBti } from './bti-texture';
import { decodeTexture } from './bti-image';
import {
  ImageBuffer,
  Palette,
  TILE_SIZE,
  COLORS_PER_PALETTE,
  loadPalettes,
} from './gba-tile-renderer';
import { SpriteRenderer, TilesetRenderer, parseSob } from './gba-sprite-renderer';

/** Whether an image buffer has any non-transparent pixel. */
function hasAlpha(buffer: ImageBuffer): boolean {
  for (let i = 3; i < buffer.pixels.length; i += 4) {
    if (buffer.pixels[i] > 0) {
      return true;
    }
  }
  return false;
}

/** Render toggles, mirroring `FSALib.Rendering.RenderOptions`. */
export enum RenderOptions {
  Nothing = 0,
  BaseLayer = 1 << 0,
  Actors = 1 << 1,
  TopLayer = 1 << 2,
  Overlay = 1 << 3,
  TileChanges = 1 << 4,
  Collision = 1 << 5,
  Environment = 1 << 6,
  Layers = BaseLayer | TopLayer,
}

/** Dimensions used by the game: 32×32 tiles, with the TV cropping 128px of height. */
const LAYER_DIMENSION = 32;
const TV_HEIGHT = 24;

/** The tileset holds 0x400 (1024) 16×16 tiles, laid out as a 16×64 sheet. */
export const TILESET_COLUMNS = 16;
export const TILESET_ROWS = 64;
export const TILESET_COUNT = TILESET_COLUMNS * TILESET_ROWS;

/** Index of the palette whose entries 8-10 carry environment transparency. */
const ENVIRONMENT_PALETTE = 13;

/** Minimal description of a tileset, mirroring `FSALib.AssetDefinitions.TilesetDefinition`. */
export interface TilesetInfo {
  ID: string;
  GbaID?: string | null;
  /** Human-readable tileset name (e.g. "Temple", "Hyrule Castle"). */
  Name?: string;
  /** Development state, e.g. "Development" for unfinished tilesets. */
  AssetState?: string | null;
}

/** Reads a file's bytes out of the stage resource archive. */
export type ResourceReader = (path: string) => Promise<Uint8Array>;

/**
 * Resolves natural paths (`SCH/bg_a_sch.szs`) to the archive's real paths.
 *
 * RARC stores directory names as 4-character identifiers that are space-padded
 * when shorter, so the on-disk path is `SCH /bg_a_sch.szs`. This maps a
 * normalized key to the exact path the archive reports.
 */
export class ArchivePathResolver {
  private readonly byKey = new Map<string, string>();

  constructor(paths: string[]) {
    for (const path of paths) {
      this.byKey.set(ArchivePathResolver.key(path), path);
    }
  }

  /** Normalizes a path to a comparable key: trimmed, lower-case, `/`-separated. */
  private static key(path: string): string {
    return path
      .replace(/\\/g, '/')
      .split('/')
      .map((segment) => segment.trim())
      .join('/')
      .toLowerCase();
  }

  /** Returns the archive's real path for `path`, or null when absent. */
  resolve(path: string): string | null {
    return this.byKey.get(ArchivePathResolver.key(path)) ?? null;
  }
}

/**
 * Renders FSA rooms.
 *
 * Construct with the parsed stage + a way to read files from the resource
 * archive, then call {@link draw} per room/layer.
 */
export class StageRenderer {
  private readonly tilesetTV = new TilesetRenderer();
  private readonly tilesetGBA = new TilesetRenderer();
  private readonly spriteTV = new SpriteRenderer();
  private readonly spriteGBA = new SpriteRenderer();

  /** Decoded TIMG textures from the stage resources, by file name. */
  private readonly images = new Map<string, ImageBuffer>();
  /** Raw BTI metadata by file name, so we can detect I4 "light" textures. */
  private readonly imageFormats = new Map<string, BtiTexture>();

  private currentTilesetIndex = -1;
  private currentSobIndex = -1;
  private layoutLoaded = false;

  /** In-flight sprite-sheet load, so concurrent callers await the same load. */
  private spritesPromise: Promise<void> | null = null;

  /** In-flight tileset load, so concurrent callers await the same load. */
  private tilesetPromise: Promise<void> | null = null;

  constructor(
    private readonly stage: StageData,
    private readonly readResource: ResourceReader,
    private readonly resolver: ArchivePathResolver,
    private readonly tilesets: Record<string, TilesetInfo>,
    /**
     * Actor definitions keyed by 4-character id. When provided, actors render
     * with their real sprites (SOB tiles) or BTI textures. Empty disables actor
     * rendering.
     */
    private readonly actors: Record<string, ActorDefinition> = {},
  ) {}

  /** Loads the shared tile layout (`bg_a_spl.szs`) and TIMG textures. */
  async init(): Promise<void> {
    if (!this.layoutLoaded) {
      const spl = await this.tryRead('SPL/bg_a_spl.szs');
      if (spl) {
        this.tilesetTV.loadTileLayout(spl);
        this.tilesetGBA.loadTileLayout(spl);
      }
      const baseSch = await this.tryRead('SCH/bg_base_sch.szs');
      if (baseSch) {
        this.tilesetTV.loadTiles(baseSch);
        this.tilesetGBA.loadTiles(baseSch);
      }
      this.layoutLoaded = true;
    }

    await this.loadImages();
  }

  /** Decodes every TIMG texture once, so actors/environment effects can reuse them. */
  private async loadImages(): Promise<void> {
    // Discover TIMG files from the stage's resource directory listing.
    const timg = this.stage.Resources.Directories['TIMG'];
    if (!timg) {
      return;
    }
    for (const name of timg.Files) {
      if (!name.toLowerCase().endsWith('.bti')) {
        continue;
      }
      const bytes = await this.tryRead(`TIMG/${name}`);
      if (!bytes) {
        continue;
      }
      try {
        const texture = parseBti(bytes);
        this.imageFormats.set(name, texture);
        this.images.set(name, decodeTexture(texture));
      } catch {
        // Skip textures that fail to parse; they're optional for rendering.
      }
    }
  }

  /** True if `name` is an I4 texture, which the renderer draws additively. */
  isLightTexture(name: string): boolean {
    return this.imageFormats.get(name)?.format === 0x0;
  }

  /** Returns a decoded TIMG texture by file name, if loaded. */
  getImage(name: string): ImageBuffer | undefined {
    return this.images.get(name);
  }

  /**
   * Renders one room layer onto `target`.
   *
   * @param target     Destination image (typically 512×512).
   * @param roomIndex  Room to draw.
   * @param layerLevel Layer level (0 = TV/top, 1 = GBA/base). Mirrors `layer` in C#.
   */
  async draw(
    target: ImageBuffer,
    roomIndex: number,
    layerLevel = 0,
    options: RenderOptions = RenderOptions.Layers | RenderOptions.Actors | RenderOptions.Overlay,
  ): Promise<void> {
    const room = this.stage.Rooms[roomIndex];
    if (!room) {
      return;
    }

    await this.ensureTileset(this.stage.Map.TileSheetId);
    await this.ensureSprites(this.stage.Map.NpcSheetId);

    const isTvLayer = layerLevel === 0;

    if (isTvLayer && (options & RenderOptions.Environment) !== 0) {
      const palette = this.tilesetTV.getPalette(ENVIRONMENT_PALETTE);
      palette[8 * 4 + 3] = 80;
      palette[9 * 4 + 3] = 120;
      palette[10 * 4 + 3] = 160;
    } else {
      const palette = this.tilesetTV.getPalette(ENVIRONMENT_PALETTE);
      palette[8 * 4 + 3] = 255;
      palette[9 * 4 + 3] = 255;
      palette[10 * 4 + 3] = 255;
    }

    const renderer = isTvLayer ? this.tilesetTV : this.tilesetGBA;
    const layerIndex = layerLevel;
    const baseLayer = room.Layers[layerIndex];
    const topLayer = room.Layers[8 + layerIndex];

    if (options & RenderOptions.BaseLayer) {
      if (baseLayer) {
        this.drawLayer(target, renderer, baseLayer);
      }
    }

    if (options & RenderOptions.Actors) {
      for (const actor of room.Actors) {
        if ((actor.Layer & 0x0f) !== layerLevel) {
          continue;
        }
        this.drawActor(target, actor, layerLevel, room);
      }
    }

    if (options & RenderOptions.TopLayer) {
      if (topLayer) {
        this.drawLayer(target, renderer, topLayer);
      }
    }
  }

  /** Draws a 32×32 tile layer. */
  private drawLayer(
    target: ImageBuffer,
    renderer: TilesetRenderer,
    layer: LayerData,
    skip?: ReadonlySet<number>,
  ): void {
    for (let y = 0; y < LAYER_DIMENSION; y++) {
      for (let x = 0; x < LAYER_DIMENSION; x++) {
        const offset = y * LAYER_DIMENSION + x;
        if (skip?.has(offset)) {
          continue;
        }
        const tile = layer.Tiles[offset];
        if (!tile) {
          continue;
        }
        renderer.drawTile(target, x * TILE_SIZE, y * TILE_SIZE, tile);
      }
    }
  }

  // --- Editor helpers -------------------------------------------------------
  // Everything below is used by the room editor (`room-canvas`) to draw a single
  // layer (without actors/overlays) and to render the tileset for tile picking.

  /** Ensures the tileset for the stage's tilesheet is loaded. */
  async prepareTileset(): Promise<void> {
    await this.ensureTileset(this.stage.Map.TileSheetId);
  }

  /**
   * Draws one layer of a room only (no actors or overlay), for editing.
   *
   * @param target     Destination (expected [`VISIBLE_ROOM_WIDTH`] ×
   *                   [`VISIBLE_ROOM_HEIGHT`]).
   * @param roomIndex  Room to draw.
   * @param layerIndex 0-7 = base layers, 8-15 = top layers.
   * @param gba        Use the GBA tileset (layer level 1) instead of the TV one.
   * @param skip       Tile offsets (row*32+col) to leave untouched — used to let
   *                   the ground grid show through where it is painted.
   */
  drawSingleLayer(
    target: ImageBuffer,
    roomIndex: number,
    layerIndex: number,
    gba = false,
    skip?: ReadonlySet<number>,
  ): void {
    const room = this.stage.Rooms[roomIndex];
    const layer = room?.Layers[layerIndex];
    if (!layer) {
      return;
    }
    this.drawLayer(target, gba ? this.tilesetGBA : this.tilesetTV, layer, skip);
  }

  /**
   * Draws a layer's base tiles followed by its top tiles (the "Layers" view),
   * for editing. The top layer uses `layerIndex + 8`, matching the game's layer
   * pairing (base 0-7, top 8-15).
   *
   * This mirrors the EFSAdvent WinForms editor's default render
   * (`RenderOptions.Layers = BaseLayer | TopLayer`), so props such as trees
   * (whose trunk is on the base layer and canopy on the top layer) composite
   * correctly instead of appearing incomplete.
   *
   * @param target     Destination (expected [`VISIBLE_ROOM_WIDTH`] ×
   *                   [`VISIBLE_ROOM_HEIGHT`]).
   * @param roomIndex  Room to draw.
   * @param layerIndex Base layer index (0-7). Its top layer is `layerIndex + 8`.
   * @param gba        Use the GBA tileset (layer level 1) instead of the TV one.
   */
  drawLayerStack(target: ImageBuffer, roomIndex: number, layerIndex: number, gba = false): void {
    const room = this.stage.Rooms[roomIndex];
    if (!room) {
      return;
    }
    const renderer = gba ? this.tilesetGBA : this.tilesetTV;
    const base = room.Layers[layerIndex];
    if (base) {
      this.drawLayer(target, renderer, base);
    }
    const top = room.Layers[layerIndex + 8];
    if (top) {
      this.drawLayer(target, renderer, top);
    }
  }

  /** Draws one 16×16 tile from the tileset at (x, y) — used for tile previews. */
  drawTilesetTile(target: ImageBuffer, x: number, y: number, tileIndex: number, gba = false): void {
    (gba ? this.tilesetGBA : this.tilesetTV).drawTile(target, x, y, tileIndex);
  }

  /**
   * Draws a full-canvas ground grid (row-major tile ids, 0 = empty) for editing.
   *
   * Used as the ground brush underlay in the room editor: ground tiles are drawn
   * first, then the room layers/decorations composite over them.
   *
   * @param target     Destination image.
   * @param tiles      Row-major tile ids (length 32×32). `0` entries are skipped.
   * @param gba        Use the GBA tileset (layer level 1) instead of the TV one.
   */
  drawGround(target: ImageBuffer, tiles: number[], gba = false): void {
    const renderer = gba ? this.tilesetGBA : this.tilesetTV;
    for (let y = 0; y < LAYER_DIMENSION; y++) {
      for (let x = 0; x < LAYER_DIMENSION; x++) {
        const tile = tiles[y * LAYER_DIMENSION + x];
        if (!tile) {
          continue;
        }
        renderer.drawTile(target, x * TILE_SIZE, y * TILE_SIZE, tile);
      }
    }
  }

  /**
   * Loads the sprite sheets, SOB attribute lists and palettes needed to draw
   * actors for the stage's NPC sheet index. Safe to call repeatedly.
   */
  async prepareActors(): Promise<void> {
    await this.ensureSprites(this.stage.Map.NpcSheetId & 0xff);
  }

  /**
   * Whether an actor's graphics actually exist in **this stage's** resources, so
   * a placed actor would draw something.
   *
   * Sprite parts and BTI textures live in the stage archive, so an actor can be
   * known to the catalog yet have no drawable graphics here (e.g. a boss whose
   * sprite sheet is not part of this stage). Used by the toolbox to hide such
   * actors instead of offering a blank entry.
   *
   * @param id       Actor id (4 characters).
   * @param variable Actor variable value selecting the render variant.
   * @param gba      Check the GBA sprite sheet.
   */
  canRenderActor(id: string, variable = 0, gba = false): boolean {
    const variants = this.resolveVariants(id, variable);
    if (variants.length === 0) {
      return false;
    }
    for (const variant of variants) {
      if (variant.SpriteIndex !== -1) {
        const rendered = (gba ? this.spriteGBA : this.spriteTV).renderSpriteToBuffer(
          variant.SpriteIndex,
          variant.SpriteListIndex,
          variant.ReplacementPaletteIndex,
          variant.TargetPaletteIndex,
        );
        if (rendered && hasAlpha(rendered.buffer)) {
          return true;
        }
        continue;
      }
      if (variant.BtiFile && this.images.has(variant.BtiFile)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Draws a single actor at a pixel offset (used by the room editor to overlay
   * actors on the layer canvas). Coordinates are pixels, not half-tiles.
   *
   * @param target     Destination image.
   * @param actor      Actor record (its `X`/`Y` are half-tiles).
   * @param gba        Draw the GBA variant (layer level 1) instead of the TV one.
   * @param offsetX    Extra pixel offset applied after the actor's own position.
   * @param offsetY    Extra pixel offset applied after the actor's own position.
   * @param additiveBti Blend BTI textures additively (I4 "light" textures, as the
   *                   room render does) instead of normally.
   */
  drawActorAt(
    target: ImageBuffer,
    actor: ActorData,
    gba = false,
    offsetX = 0,
    offsetY = 0,
    additiveBti = false,
  ): void {
    const renderer = gba ? this.spriteGBA : this.spriteTV;
    const variants = this.resolveVariants(actor.Id, actor.Variable);
    if (variants.length === 0) {
      return;
    }

    // Mirrors the game's `FSALib.Rendering.StageRenderer.Draw`, which draws EVERY
    // variant of the resolved key (multi-part actors such as the hovering Force
    // Gem list several sprites):
    // - SOB sprite (SpriteIndex != -1): at the actor origin (X*8 + XOffset, Y*8 + YOffset).
    //   The sprite's own attributes carry any further offsets.
    // - BTI texture (no SOB sprite, TV layer only): CENTRED on the actor origin,
    //   i.e. (X*8 - width/2, Y*8 - height/2).
    for (const variant of variants) {
      if (variant.SpriteIndex !== -1) {
        const drawX = actor.X * 8 + variant.XOffset + offsetX;
        const drawY = actor.Y * 8 + variant.YOffset + offsetY;
        const scaled = variant.XScale !== 1 || variant.YScale !== 1;
        if (scaled) {
          // Scaled sprites (e.g. the 2× "big" Chief Soldier variant) are drawn
          // through a scratch buffer, then blitted enlarged. Mirrors the game's
          // transform path.
          const rendered = renderer.renderSpriteToBuffer(
            variant.SpriteIndex,
            variant.SpriteListIndex,
            variant.ReplacementPaletteIndex,
            variant.TargetPaletteIndex,
          );
          if (rendered) {
            target.blendScaledFrom(
              rendered.buffer,
              drawX + Math.round(rendered.originX * variant.XScale),
              drawY + Math.round(rendered.originY * variant.YScale),
              variant.XScale,
              variant.YScale,
            );
          }
          continue;
        }
        renderer.drawSprite(
          target,
          drawX,
          drawY,
          variant.SpriteIndex,
          variant.SpriteListIndex,
          variant.ReplacementPaletteIndex,
          variant.TargetPaletteIndex,
        );
        continue;
      }
      const image = variant.BtiFile ? this.images.get(variant.BtiFile) : undefined;
      if (!image) {
        continue;
      }
      const drawX = actor.X * 8 - Math.floor(image.width / 2) + variant.XOffset + offsetX;
      const drawY = actor.Y * 8 - Math.floor(image.height / 2) + variant.YOffset + offsetY;
      if (additiveBti && this.isLightTexture(variant.BtiFile)) {
        target.addFrom(image, drawX, drawY, 0.6);
      } else {
        target.blendFrom(image, drawX, drawY);
      }
    }
  }

  /**
   * The pixel rectangle an actor's sprite actually occupies on the canvas.
   *
   * Unlike a fixed tile-sized box, this accounts for the resolved variant's
   * `XOffset`/`YOffset` **and** the sprite's real size (a sprite is several
   * attributes, each with its own offset and block dimensions), so large actors
   * are outlined/hit-tested over their true footprint.
   *
   * @param actor  Actor record (its `X`/`Y` are half-tiles).
   * @param gba    Use the GBA sprite sheet.
   * @returns Top-left pixel plus size, or null when the actor cannot be resolved.
   */
  actorBounds(
    actor: ActorData,
    gba = false,
  ): { x: number; y: number; width: number; height: number } | null {
    const variants = this.resolveVariants(actor.Id, actor.Variable);
    if (variants.length === 0) {
      return null;
    }
    const renderer = gba ? this.spriteGBA : this.spriteTV;

    // Union the pixel rect of every variant's sprite, matching drawActorAt (the
    // game draws all variants of a key), so multi-part actors are fully covered.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const include = (x: number, y: number, w: number, h: number): void => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    };

    for (const variant of variants) {
      if (variant.SpriteIndex !== -1) {
        const bounds = renderer.spriteBounds(variant.SpriteIndex, variant.SpriteListIndex);
        if (!bounds) {
          continue;
        }
        // Scale the sprite's footprint (the variant may enlarge it, e.g. 2×).
        const w = Math.max(1, bounds.maxX - bounds.minX) * variant.XScale;
        const h = Math.max(1, bounds.maxY - bounds.minY) * variant.YScale;
        include(
          actor.X * 8 + variant.XOffset + bounds.minX * variant.XScale,
          actor.Y * 8 + variant.YOffset + bounds.minY * variant.YScale,
          w,
          h,
        );
        continue;
      }
      const image = variant.BtiFile ? this.images.get(variant.BtiFile) : undefined;
      if (!image) {
        continue;
      }
      const w = image.width * variant.XScale;
      const h = image.height * variant.YScale;
      include(
        actor.X * 8 - Math.floor(w / 2) + variant.XOffset,
        actor.Y * 8 - Math.floor(h / 2) + variant.YOffset,
        w,
        h,
      );
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      return null;
    }
    return {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }

  /**
   * Renders a single actor into a fresh transparent buffer sized to fit it (for
   * the toolbox's Enemies thumbnails).
   *
   * @param id       Actor id (4 characters).
   * @param variable Actor variable value selecting the render variant.
   * @param width    Buffer width in pixels.
   * @param height   Buffer height in pixels.
   * @param gba      Use the GBA sprite sheet.
   */
  renderActorPreview(
    id: string,
    variable = 0,
    width = 32,
    height = 32,
    gba = false,
  ): ImageBuffer | null {
    const variants = this.resolveVariants(id, variable);
    if (variants.length === 0) {
      return null;
    }

    // Measure the sprite relative to an arbitrary origin, then compute the
    // output size and the origin that centres the sprite's real footprint. This
    // keeps large / offset sprites (bigger than one tile, or with negative
    // attribute offsets) fully framed instead of clipped or pushed off-centre.
    const measure = this.actorBounds({ Id: id, Layer: 0, X: 0, Y: 0, Variable: variable }, gba);
    const spriteW = measure?.width ?? 16;
    const spriteH = measure?.height ?? 16;
    const outW = Math.max(width, spriteW);
    const outH = Math.max(height, spriteH);

    // With origin (0,0) the sprite occupies [measure.x, measure.x + spriteW).
    // Shift the actor so that box is centred in the buffer. Rounded to whole
    // pixels: the renderer writes at integer coordinates.
    const targetMinX = Math.round((outW - spriteW) / 2);
    const targetMinY = Math.round((outH - spriteH) / 2);
    const deltaX = targetMinX - (measure?.x ?? 0);
    const deltaY = targetMinY - (measure?.y ?? 0);

    const buffer = new ImageBuffer(outW, outH);
    buffer.fill(0, 0, 0, 0);
    // Draw at origin (0,0) and use the pixel offset args for the exact shift, so
    // odd-sized sprites are centred without rounding to whole half-tiles.
    this.drawActorAt(
      buffer,
      { Id: id, Layer: 0, X: 0, Y: 0, Variable: variable },
      gba,
      deltaX,
      deltaY,
    );
    return buffer;
  }

  /**
   * Renders a smart-object definition into a fresh RGBA buffer sized to its
   * bounding box, for the toolbox thumbnail. Honours the GBA tileset flag.
   */
  renderSmartObjectPreview(
    definition: SmartObjectDefinition,
    gba = false,
    variantIndex = 0,
  ): ImageBuffer {
    return renderSmartObjectPreview(
      definition,
      (target, px, py, tileId) => this.drawTilesetTile(target, px, py, tileId, gba),
      variantIndex,
    );
  }

  /**
   * Renders the entire tileset into a [`TILESET_COLUMNS` × `TILESET_ROWS`] grid
   * of 16×16 tiles (256×1024 px), for the room editor's tile palette. Mirrors
   * `TilesetRenderer.Draw(target)` in FSALib.
   */
  drawTileset(target: ImageBuffer, gba = false): void {
    const renderer = gba ? this.tilesetGBA : this.tilesetTV;
    for (let i = 0; i < TILESET_COUNT; i++) {
      const x = (i & 0xf) * TILE_SIZE;
      const y = (i >> 4) * TILE_SIZE;
      renderer.drawTile(target, x, y, i);
    }
  }

  /**
   * Draws a single actor.
   *
   * Sprite actors are drawn through the sprite renderer; BTI actors are copied
   * as textures, using additive blending for I4 "light" textures exactly as
   * `StageRenderer.Draw` does.
   */
  private drawActor(
    target: ImageBuffer,
    actor: ActorData,
    layerLevel: number,
    room: RoomData,
  ): void {
    // 11-byte layout: ID(4) Layer(1) X(1) Y(1) as in FSALib.Structs.Actor.
    const id = actor.Id;
    if (id.length < 4) {
      return;
    }
    // Delegate to the shared editor path so the room render and the room editor
    // agree: it draws every variant of the resolved key and honours variant
    // scale. The only room-render extra is additive blending for I4 light
    // textures (handled inside `drawActorAt` via `additiveBti`).
    this.drawActorAt(target, actor, layerLevel !== 0, 0, 0, true);
  }

  /**
   * Resolves the render variants for an actor from the actor definition catalog
   * (keyed by the 4-character id), selecting the variant list via
   * `actor.Variable & bitMask`.
   *
   * Returns **every** variant of the selected key (multi-part actors such as the
   * hovering Force Gem list several sprites), or an empty array when the actor /
   * definition / rendering is unknown.
   */
  private resolveVariants(id: string, variable: number): ActorRenderVariant[] {
    const definition = this.actors[id];
    if (!definition) {
      return [];
    }
    return actorVariants(definition, variable);
  }

  /**
   * Resolves the first render variant for an actor, or null when the actor /
   * definition / rendering is unknown.
   */
  private resolveVariant(_id: string, _variable: number): ActorRenderVariant | null {
    return this.resolveVariants(_id, _variable)[0] ?? null;
  }

  /** Loads the tileset + palette for `index` if not already active. */
  private async ensureTileset(index: number): Promise<void> {
    if (this.currentTilesetIndex === index) {
      // A load for this tileset is done or in flight; await it if needed.
      if (this.tilesetPromise) {
        await this.tilesetPromise;
      }
      return;
    }
    this.currentTilesetIndex = index;
    this.tilesetPromise = this.loadTileset(index);
    await this.tilesetPromise;
    this.tilesetPromise = null;
  }

  /** Performs the actual tileset/palette load for `index`. */
  private async loadTileset(index: number): Promise<void> {
    const info = this.tilesets[String(index)];
    if (!info) {
      return;
    }

    const sch = await this.tryRead(`SCH/bg_${info.ID}_sch.szs`);
    if (sch) {
      this.tilesetTV.loadTiles(sch);
    }
    const gbaSch = await this.tryRead(`SCH/bg_${info.GbaID ?? info.ID}_sch.szs`);
    if (gbaSch) {
      this.tilesetGBA.loadTiles(gbaSch);
    }

    const scl = await this.tryRead(`SCL/bg_${info.ID}_scl.szs`);
    if (scl) {
      this.applyPalettes(this.tilesetTV, loadPalettes(scl));
    }
    const gbaScl = await this.tryRead(`SCL/bg_${info.ID}_gb_scl.szs`);
    if (gbaScl) {
      this.applyPalettes(this.tilesetGBA, loadPalettes(gbaScl));
    }
  }

  /** Loads the sprite sheet + palettes for an NPC sheet index. */
  private async ensureSprites(index: number): Promise<void> {
    if (this.currentSobIndex === index) {
      // A load for this index is done or in flight; await it if needed. Without
      // this, a concurrent caller (e.g. `prepareActors()` racing `init()`)
      // would return immediately while the sheet is still loading, and actors
      // would silently draw nothing until some later redraw.
      if (this.spritesPromise) {
        await this.spritesPromise;
      }
      return;
    }
    this.currentSobIndex = index;
    this.spritesPromise = this.loadSprites(index);
    await this.spritesPromise;
    this.spritesPromise = null;
  }

  /** Performs the actual sprite-sheet/attribute-list/palette load. */
  private async loadSprites(index: number): Promise<void> {
    const base = await this.tryRead('SCH/gb_ch_obj_base_sch.szs');
    if (base) {
      this.spriteTV.loadInto(base.subarray(0, 0x7000), 0);
      this.spriteGBA.loadInto(base.subarray(0, 0x7000), 0);
    }

    const tiles = await this.tryRead(`SCH/gb_ch_obj_tr_sch${index.toString(16)}.szs`);
    if (tiles) {
      this.spriteTV.loadInto(tiles, 0x7000);
      this.spriteGBA.loadInto(tiles, 0x7000);
    }

    const enemy = await this.tryRead('SCH/enemy_sch.szs');
    if (enemy) {
      this.spriteTV.loadInto(enemy, 0x8000);
      this.spriteGBA.loadInto(enemy, 0x8000);
    }

    const sobFiles = [
      'SOB/enemy_both_sob.bin',
      'SOB/enemy_both2_sob.bin',
      'SOB/enemy_gc_sob.bin',
      'SOB/player_sob.bin',
      'SOB/kage_sob.bin',
      'SOB/player_kage_sob.bin',
    ];
    for (const sob of sobFiles) {
      const bytes = await this.tryRead(sob);
      if (bytes) {
        this.spriteTV.loadAttributeLists(parseSob(bytes));
        this.spriteGBA.loadAttributeLists(parseSob(bytes));
      }
    }

    const palette = await this.tryRead('SCL/cu_cl_obj_base_scl.szs');
    if (palette) {
      this.applySpritePalettes(this.spriteTV, loadPalettes(palette));
    }
    const gbaPalette = await this.tryRead('SCL/gb_cl_obj_base_scl.szs');
    if (gbaPalette) {
      this.applySpritePalettes(this.spriteGBA, loadPalettes(gbaPalette));
    }
  }

  private applyPalettes(renderer: TilesetRenderer, palettes: Palette[]): void {
    for (let i = 0; i < palettes.length && i < renderer.palettes.length; i++) {
      renderer.palettes[i] = palettes[i];
    }
  }

  private applySpritePalettes(renderer: SpriteRenderer, palettes: Palette[]): void {
    for (let i = 0; i < palettes.length && i < renderer.palettes.length; i++) {
      renderer.palettes[i] = palettes[i];
    }
  }

  /** Reads a resource file, returning null when it doesn't exist or is empty. */
  private async tryRead(path: string): Promise<Uint8Array | null> {
    const real = this.resolver.resolve(path);
    if (!real) {
      return null;
    }
    try {
      const bytes = await this.readResource(real);
      return bytes.byteLength > 0 ? bytes : null;
    } catch {
      return null;
    }
  }
}

/** Nominal colour used to mark things the renderer could not resolve. */
export const MISSING_COLOR: readonly [number, number, number, number] = [255, 0, 255, 255];

/** Default target size used by the game's room render (512×512). */
export const ROOM_PIXELS = LAYER_DIMENSION * TILE_SIZE;

/** Visible height of a TV-layer room, in pixels. */
export const TV_PIXELS = TV_HEIGHT * TILE_SIZE;

/**
 * Visible size of a rendered room after the TV crop: the full 512px width but
 * only {@link TV_PIXELS} (384px) of height. The bottom band the game hides is
 * dropped when rendering room previews.
 */
export const VISIBLE_ROOM_WIDTH = ROOM_PIXELS;
export const VISIBLE_ROOM_HEIGHT = TV_PIXELS;
