/**
 * Tileset and sprite rasterizers.
 *
 * Ports of `FSALib.Rendering.TilesetRenderer<TColor>` and
 * `FSALib.Rendering.SpriteRenderer<TColor>`.
 *
 * Both build on a shared "part index sheet": a flat byte blob of 8×8 4bpp
 * parts that graphics data is read from. The tileset uses 0x8000 bytes and the
 * sprite renderer 0x2000 * 16 bytes, matching the C# allocations.
 */
import {
  COLORS_PER_PALETTE,
  ImageBuffer,
  MirrorAxis,
  Palette,
  PART_INDEX_BYTES,
  PART_SIZE,
  TILE_SIZE,
  drawPart,
} from './gba-tile-renderer';

/** A parsed 16×16 tile: four 8×8 parts, each with palette index + flip flags. */
export interface Tile {
  /** Packed parts in order TopLeft, TopRight, BottomLeft, BottomRight. */
  parts: PackedPart[];
}

/** A packed tile part: 4-bit palette, 2-bit flip, 10-bit part index. */
export interface PackedPart {
  palette: number;
  flip: MirrorAxis;
  index: number;
}

/** Unpacks a `Part` ushort (PPPPHVII IIIIIIII) as in `FSALib.Structs.Part`. */
export function unpackPart(value: number): PackedPart {
  return {
    palette: (value >> 12) & 0xf,
    flip: ((value >> 10) & 0x3) as MirrorAxis,
    index: value & 0x3ff,
  };
}

/**
 * Port of `TilesetRenderer<TColor>`.
 *
 * Holds 0x400 tiles (SPL layout) plus a 0x8000-byte sheet of 4bpp part indices
 * (SCH), and draws them through up to 0x100 16-colour palettes (SCL).
 */
export class TilesetRenderer {
  /** 0x400 tiles, each four parts. */
  readonly tiles: Tile[] = new Array(0x400);
  /** Part index sheet; the SCH data lives in the first 0x6000 bytes. */
  readonly partIndices = new Uint8Array(0x8000);
  /** Up to 0x100 loaded palettes. */
  readonly palettes: Palette[] = new Array(0x100);

  constructor() {
    for (let i = 0; i < this.tiles.length; i++) {
      this.tiles[i] = { parts: new Array(4) };
    }
    for (let i = 0; i < this.palettes.length; i++) {
      this.palettes[i] = new Uint8ClampedArray(COLORS_PER_PALETTE * 4);
    }
  }

  /**
   * Loads the base `bg_a_spl.szs` tile layout.
   *
   * The SPL file is a flat array of little-endian ushorts, four per tile.
   */
  loadTileLayout(spl: Uint8Array, offset = 0): void {
    const view = new DataView(spl.buffer, spl.byteOffset, spl.byteLength);
    for (let t = 0; t < this.tiles.length; t++) {
      for (let p = 0; p < 4; p++) {
        const o = offset + (t * 4 + p) * 2;
        this.tiles[t].parts[p] =
          o + 1 < spl.length
            ? unpackPart(view.getUint16(o, true))
            : { palette: 0, flip: MirrorAxis.None, index: 0 };
      }
    }
  }

  /** Loads tileset part indices (SCH) from `bg_XXX_sch.szs`. */
  loadTiles(sch: Uint8Array): void {
    this.partIndices.set(sch.subarray(0, 0x6000), 0);
  }

  /** Loads palettes (SCL) into the palette array. */
  loadPalette(palette: Palette, index = 0): void {
    this.palettes[index] = palette;
  }

  /** Returns the 16-colour palette at `index` (0-15 as used by parts). */
  getPalette(index: number): Palette {
    return this.palettes[index] ?? this.palettes[0];
  }

  /** Returns the 32 raw bytes for an 8×8 part at `index`. */
  getPartIndices(index: number): Uint8Array {
    const source = index * PART_INDEX_BYTES;
    return this.partIndices.subarray(source, source + PART_INDEX_BYTES);
  }

  /** Draws a single 16×16 tile (four parts) at (x, y). */
  drawTile(target: ImageBuffer, x: number, y: number, tileIndex: number): void {
    const tile = this.tiles[tileIndex];
    if (!tile) {
      return;
    }
    this.drawPackedPart(target, x, y, tile.parts[0]);
    this.drawPackedPart(target, x + PART_SIZE, y, tile.parts[1]);
    this.drawPackedPart(target, x, y + PART_SIZE, tile.parts[2]);
    this.drawPackedPart(target, x + PART_SIZE, y + PART_SIZE, tile.parts[3]);
  }

  /** Draws one packed part using its own palette and flip flags. */
  drawPackedPart(target: ImageBuffer, x: number, y: number, part: PackedPart): void {
    if (!part) {
      return;
    }
    drawPart(
      target,
      x,
      y,
      this.getPartIndices(part.index),
      this.getPalette(part.palette),
      part.flip,
    );
  }

  /**
   * Draws a 32×32 tile layer onto the target.
   *
   * Port of `TilesetRenderer.Draw(target, Layer, offset)`.
   */
  drawLayer(target: ImageBuffer, tiles: Uint16Array, offsetX = 0, offsetY = 0): void {
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const tile = tiles[y * 32 + x];
        if (tile === 0) {
          continue;
        }
        this.drawTile(target, offsetX + x * TILE_SIZE, offsetY + y * TILE_SIZE, tile);
      }
    }
  }
}

/** Block shape/size tables, ported from `SpriteAttribute.GetBlockDimensions`. */
const SQUARE: [number, number][] = [
  [1, 1],
  [2, 2],
  [4, 4],
  [8, 8],
];
const WIDE: [number, number][] = [
  [2, 1],
  [4, 1],
  [4, 2],
  [8, 4],
];
const TALL: [number, number][] = [
  [1, 2],
  [1, 4],
  [2, 4],
  [4, 8],
];

/** One entry of a sprite attribute list (SOB), mirroring `SpriteAttribute`. */
export interface SpriteAttribute {
  xOffset: number;
  yOffset: number;
  blockShape: number;
  blockSize: number;
  flip: MirrorAxis;
  pageOffset: number;
  paletteIndex: number;
  page: number;
}

/**
 * Parses a SOB file into sprite attribute lists.
 *
 * Port of `SpriteRenderer.LoadSpriteAttributeList(ReadOnlySpan<byte>, ...)`.
 * Each sprite is a run of 6-byte attributes delimited by an offset table.
 */
export function parseSob(sob: Uint8Array): SpriteAttribute[][] {
  if (sob.length < 4) {
    return [];
  }
  const view = new DataView(sob.buffer, sob.byteOffset, sob.byteLength);
  const spriteCount = view.getUint16(0, true);
  const lists: SpriteAttribute[][] = [];

  for (let i = 0; i < spriteCount; i++) {
    const start = view.getUint16(2 + i * 2, true);
    const end = view.getUint16(2 + (i + 1) * 2, true);
    const attributes: SpriteAttribute[] = [];
    for (let o = start; o + 6 <= end && o + 6 <= sob.length; o += 6) {
      const blockShape = sob[o + 1] >> 6;
      const objectAttributes = sob[o + 3];
      attributes.push({
        yOffset: (sob[o] << 24) >> 24,
        xOffset: (sob[o + 2] << 24) >> 24,
        blockShape,
        blockSize: objectAttributes >> 6,
        flip: ((objectAttributes >> 4) & 0x3) as MirrorAxis,
        pageOffset: sob[o + 4],
        paletteIndex: sob[o + 5] >> 4,
        page: sob[o + 5] & 0xf,
      });
    }
    lists.push(attributes);
  }
  return lists;
}

/** Returns the [width, height] of a sprite in 8×8 blocks. */
export function spriteBlockDimensions(shape: number, size: number): [number, number] {
  const table = shape === 0 ? SQUARE : shape === 1 ? WIDE : TALL;
  return table[size] ?? [1, 1];
}

/**
 * Port of `SpriteRenderer<TColor>`.
 *
 * Consumes the sprite part sheet (0x2000 * 16 bytes) and draws sprites by
 * walking their attribute lists.
 */
export class SpriteRenderer {
  /** Sprite part index sheet, 0x2000 * 16 bytes as in the C# constructor. */
  readonly partIndices = new Uint8Array(0x2000 * 16);
  readonly palettes: Palette[] = new Array(0x100);
  /**
   * Parsed SOB attribute lists, in the order they were added.
   *
   * Outer index = SOB file, middle = sprite index, inner = that sprite's parts.
   */
  readonly attributeLists: SpriteAttribute[][][] = [];

  constructor() {
    for (let i = 0; i < this.palettes.length; i++) {
      this.palettes[i] = new Uint8ClampedArray(COLORS_PER_PALETTE * 4);
    }
  }

  /** Writes sprite graphics into the part sheet at a byte offset. */
  loadInto(sheet: Uint8Array, offset: number): void {
    const length = Math.min(sheet.length, this.partIndices.length - offset);
    this.partIndices.set(sheet.subarray(0, length), offset);
  }

  /** Adds one SOB file's parsed attribute lists as a new list index. */
  loadAttributeLists(lists: SpriteAttribute[][]): void {
    this.attributeLists.push(lists);
  }

  getPalette(index: number): Palette {
    return this.palettes[index] ?? this.palettes[0];
  }

  getPartIndices(index: number): Uint8Array {
    const source = index * PART_INDEX_BYTES;
    return this.partIndices.subarray(source, source + PART_INDEX_BYTES);
  }

  /**
   * Renders a sprite into a fresh transparent buffer whose origin is the
   * sprite's draw position, sized to hold its full footprint.
   *
   * Returns the buffer plus the offset (in pixels) from the buffer's top-left to
   * the sprite's draw origin, so a transformed blit can place it correctly.
   */
  renderSpriteToBuffer(
    spriteIndex: number,
    attributeList = 0,
    replacementPaletteIndex = -1,
    targetPaletteIndex = -1,
  ): { buffer: ImageBuffer; originX: number; originY: number } | null {
    const bounds = this.spriteBounds(spriteIndex, attributeList);
    if (!bounds) {
      return null;
    }
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const buffer = new ImageBuffer(width, height);
    buffer.fill(0, 0, 0, 0);
    this.drawSprite(
      buffer,
      -bounds.minX,
      -bounds.minY,
      spriteIndex,
      attributeList,
      replacementPaletteIndex,
      targetPaletteIndex,
    );
    return { buffer, originX: bounds.minX, originY: bounds.minY };
  }

  /** Draws a sprite by list + index, matching `DrawSprite(target, x, y, spriteIndex, attributeList)`. */
  drawSprite(
    target: ImageBuffer,
    x: number,
    y: number,
    spriteIndex: number,
    attributeList = 0,
    replacementPaletteIndex = -1,
    targetPaletteIndex = -1,
  ): void {
    const list = this.attributeLists[attributeList];
    if (!list) {
      return;
    }
    const attributes = list[spriteIndex];
    if (!attributes) {
      return;
    }
    this.drawAttributes(target, x, y, attributes, replacementPaletteIndex, targetPaletteIndex);
  }

  /**
   * Pixel bounding box of a sprite, relative to the sprite's draw origin
   * `(x, y)`.
   *
   * A sprite is a set of attributes, each drawn at its own `xOffset`/`yOffset`
   * and covering `blocks × PART_SIZE` pixels, so the union of those rectangles is
   * the sprite's true footprint. Used to outline/hit-test actors of any size
   * (large actors like buildings span many tiles).
   *
   * Returns `null` when the sprite cannot be resolved.
   */
  spriteBounds(
    spriteIndex: number,
    attributeList = 0,
  ): { minX: number; minY: number; maxX: number; maxY: number } | null {
    const list = this.attributeLists[attributeList];
    const attributes = list?.[spriteIndex];
    if (!attributes || attributes.length === 0) {
      return null;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const attribute of attributes) {
      const [blocksX, blocksY] = spriteBlockDimensions(attribute.blockShape, attribute.blockSize);
      const left = attribute.xOffset;
      const top = attribute.yOffset;
      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, left + blocksX * PART_SIZE);
      maxY = Math.max(maxY, top + blocksY * PART_SIZE);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      return null;
    }
    return { minX, minY, maxX, maxY };
  }

  /** Draws a set of attributes, applying optional palette replacement. */
  drawAttributes(
    target: ImageBuffer,
    x: number,
    y: number,
    attributes: SpriteAttribute[],
    replacementPaletteIndex = -1,
    targetPaletteIndex = -1,
  ): void {
    // Drawn back-to-front, as in the C# implementation.
    for (let i = attributes.length - 1; i >= 0; i--) {
      const attribute = attributes[i];
      let p = attribute.paletteIndex;
      if (replacementPaletteIndex !== -1) {
        p = targetPaletteIndex === -1 || p === targetPaletteIndex ? replacementPaletteIndex : p;
      }
      this.drawAttribute(target, x, y, attribute, p);
    }
  }

  /** Draws a single sprite attribute using palette `paletteIndex`. */
  drawAttribute(
    target: ImageBuffer,
    x: number,
    y: number,
    attribute: SpriteAttribute,
    paletteIndex: number,
  ): void {
    const [blocksX, blocksY] = spriteBlockDimensions(attribute.blockShape, attribute.blockSize);
    const flipH = (attribute.flip & MirrorAxis.Horizontal) !== 0;
    const flipV = (attribute.flip & MirrorAxis.Vertical) !== 0;
    const baseTileIndex = attribute.page * 256 + attribute.pageOffset;
    const palette = this.getPalette(paletteIndex);

    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        const tileIndex = baseTileIndex + by * 32 + bx;
        const tile = this.getPartIndices(tileIndex);

        const tileOffsetX = flipH ? (blocksX - 1 - bx) * PART_SIZE : bx * PART_SIZE;
        const tileOffsetY = flipV ? (blocksY - 1 - by) * PART_SIZE : by * PART_SIZE;

        drawPart(
          target,
          x + attribute.xOffset + tileOffsetX,
          y + attribute.yOffset + tileOffsetY,
          tile,
          palette,
          attribute.flip,
        );
      }
    }
  }
}
