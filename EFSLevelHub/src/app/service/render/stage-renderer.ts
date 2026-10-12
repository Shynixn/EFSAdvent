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

  /** In-flight tileset load, so concurrent callers await the same load. */
  private tilesetPromise: Promise<void> | null = null;

  constructor(
    private readonly stage: StageData,
    private readonly readResource: ResourceReader,
    private readonly resolver: ArchivePathResolver,
    private readonly tilesets: Record<string, TilesetInfo>,
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
  private drawLayer(target: ImageBuffer, renderer: TilesetRenderer, layer: LayerData): void {
    for (let y = 0; y < LAYER_DIMENSION; y++) {
      for (let x = 0; x < LAYER_DIMENSION; x++) {
        const tile = layer.Tiles[y * LAYER_DIMENSION + x];
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
   */
  drawSingleLayer(target: ImageBuffer, roomIndex: number, layerIndex: number, gba = false): void {
    const room = this.stage.Rooms[roomIndex];
    const layer = room?.Layers[layerIndex];
    if (!layer) {
      return;
    }
    this.drawLayer(target, gba ? this.tilesetGBA : this.tilesetTV, layer);
  }

  /** Draws one 16×16 tile from the tileset at (x, y) — used for tile previews. */
  drawTilesetTile(target: ImageBuffer, x: number, y: number, tileIndex: number, gba = false): void {
    (gba ? this.tilesetGBA : this.tilesetTV).drawTile(target, x, y, tileIndex);
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

    const actorOffsetX = actor.X * 8;
    const actorOffsetY = actor.Y * 8;
    const renderer = layerLevel === 0 ? this.spriteTV : this.spriteGBA;
    const variant = this.resolveVariant(id, actor.Variable);
    if (!variant) {
      return;
    }

    if (variant.spriteIndex !== undefined && variant.spriteIndex !== -1) {
      renderer.drawSprite(
        target,
        actorOffsetX + variant.xOffset,
        actorOffsetY + variant.yOffset,
        variant.spriteIndex,
        variant.spriteListIndex,
        variant.replacementPaletteIndex,
        variant.targetPaletteIndex,
      );
      return;
    }

    // BTI-rendered actor (TV layer only in the C# renderer).
    if (layerLevel !== 0 || !variant.btiFile) {
      return;
    }
    const image = this.images.get(variant.btiFile);
    if (!image) {
      return;
    }
    const drawX = actorOffsetX + variant.xOffset - Math.floor(image.width / 2);
    const drawY = actorOffsetY + variant.yOffset - Math.floor(image.height / 2);
    if (this.isLightTexture(variant.btiFile)) {
      target.addFrom(image, drawX, drawY, 0.6);
    } else {
      target.blendFrom(image, drawX, drawY);
    }
  }

  /**
   * Resolves the render variant for an actor.
   *
   * The full definition lives in `actors/*.json` (not shipped to the browser),
   * so this returns null until an actor-render definition source is wired up.
   * Placeholder keeps the draw path exercised and easy to extend.
   */
  private resolveVariant(
    _id: string,
    _variable: number,
  ): {
    spriteIndex?: number;
    spriteListIndex?: number;
    replacementPaletteIndex?: number;
    targetPaletteIndex?: number;
    xOffset: number;
    yOffset: number;
    btiFile?: string;
  } | null {
    return null;
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
      return;
    }
    this.currentSobIndex = index;

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
