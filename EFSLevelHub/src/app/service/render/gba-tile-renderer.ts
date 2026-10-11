/**
 * Palette (SCL) loading and the shared 4bpp tile rasterizer.
 *
 * Ports of `FSALib.Rendering.GBA4bppTileRenderer<TColor>` and
 * `TilesetRenderer<TColor>`: the game stores graphics as 8×8 "parts" of 4bpp
 * indices, grouped into 16×16 tiles (four parts) and drawn through 16-colour
 * palettes. Colours are the same RGB555 ("BGR555" in AuroraLib terms) seen in
 * the SCL files.
 */

/** A 16-colour palette, RGBA8888 (length = 16 * 4). */
export type Palette = Uint8ClampedArray;

/** Number of colours in a palette. */
export const COLORS_PER_PALETTE = 16;

/** 8×8 pixels per tile part. */
export const PART_SIZE = 8;

/** 16×16 pixels per tile. */
export const TILE_SIZE = PART_SIZE * 2;

/** Bytes per 8×8 part at 4bpp. */
export const PART_INDEX_BYTES = (PART_SIZE * PART_SIZE) / 2;

/** Mirror flags, matching `FSALib.Structs.MirrorAxis`. */
export enum MirrorAxis {
  None = 0,
  Horizontal = 1,
  Vertical = 2,
  Both = Horizontal | Vertical,
}

/**
 * Simple RGBA8888 image buffer used as a render target.
 *
 * Mirrors the role of AuroraLib's `IImage<TColor>` but stores straight RGBA
 * bytes so it can be handed to a canvas or PNG encoder.
 */
export class ImageBuffer {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  /** Sets a pixel, skipping out-of-bounds writes. */
  set(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return;
    }
    const i = (y * this.width + x) * 4;
    this.pixels[i] = r;
    this.pixels[i + 1] = g;
    this.pixels[i + 2] = b;
    this.pixels[i + 3] = a;
  }

  /** Reads a pixel as [r, g, b, a]. */
  get(x: number, y: number): [number, number, number, number] {
    const i = (y * this.width + x) * 4;
    return [this.pixels[i], this.pixels[i + 1], this.pixels[i + 2], this.pixels[i + 3]];
  }

  /** Fills the whole buffer with an RGBA colour. */
  fill(r: number, g: number, b: number, a: number): void {
    for (let i = 0; i < this.pixels.length; i += 4) {
      this.pixels[i] = r;
      this.pixels[i + 1] = g;
      this.pixels[i + 2] = b;
      this.pixels[i + 3] = a;
    }
  }

  /**
   * Alpha-composites `source` onto this buffer at (x, y) using normal blending.
   *
   * Mirrors `AuroraLib.Pixel` `BlendModes.Normal` as used by
   * `StageRenderer.Draw` when copying a decoded texture onto the target.
   */
  blendFrom(source: ImageBuffer, x: number, y: number, intensity = 1): void {
    for (let sy = 0; sy < source.height; sy++) {
      const ty = y + sy;
      if (ty < 0 || ty >= this.height) {
        continue;
      }
      for (let sx = 0; sx < source.width; sx++) {
        const tx = x + sx;
        if (tx < 0 || tx >= this.width) {
          continue;
        }
        const si = (sy * source.width + sx) * 4;
        const sa = (source.pixels[si + 3] / 255) * intensity;
        if (sa <= 0) {
          continue;
        }
        const di = (ty * this.width + tx) * 4;
        const inv = 1 - sa;
        this.pixels[di] = source.pixels[si] * sa + this.pixels[di] * inv;
        this.pixels[di + 1] = source.pixels[si + 1] * sa + this.pixels[di + 1] * inv;
        this.pixels[di + 2] = source.pixels[si + 2] * sa + this.pixels[di + 2] * inv;
        this.pixels[di + 3] = 255 * sa + this.pixels[di + 3] * inv;
      }
    }
  }

  /**
   * Additively blends `source` onto this buffer at (x, y).
   *
   * Mirrors `BlendModes.Add`, which `StageRenderer` uses for I4 "light"
   * textures (see `StageRenderer.Draw`, `ifLight` branch).
   */
  addFrom(source: ImageBuffer, x: number, y: number, intensity = 1): void {
    for (let sy = 0; sy < source.height; sy++) {
      const ty = y + sy;
      if (ty < 0 || ty >= this.height) {
        continue;
      }
      for (let sx = 0; sx < source.width; sx++) {
        const tx = x + sx;
        if (tx < 0 || tx >= this.width) {
          continue;
        }
        const si = (sy * source.width + sx) * 4;
        const a = (source.pixels[si + 3] / 255) * intensity;
        if (a <= 0) {
          continue;
        }
        const di = (ty * this.width + tx) * 4;
        this.pixels[di] = Math.min(255, this.pixels[di] + source.pixels[si] * a);
        this.pixels[di + 1] = Math.min(255, this.pixels[di + 1] + source.pixels[si + 1] * a);
        this.pixels[di + 2] = Math.min(255, this.pixels[di + 2] + source.pixels[si + 2] * a);
        this.pixels[di + 3] = Math.min(255, this.pixels[di + 3] + source.pixels[si + 3] * a);
      }
    }
  }
}

/**
 * Loads 16-colour palettes from an SCL stream.
 *
 * SCL files are a flat array of big-endian RGB555 values, exactly as read by
 * `GBA4bppTileRenderer.LoadPalettes`.
 */
export function loadPalettes(scl: Uint8Array, count = 256): Palette[] {
  const palettes: Palette[] = [];
  for (let p = 0; p < count; p++) {
    const palette = new Uint8ClampedArray(COLORS_PER_PALETTE * 4);
    for (let c = 0; c < COLORS_PER_PALETTE; c++) {
      const o = (p * COLORS_PER_PALETTE + c) * 2;
      if (o + 1 >= scl.length) {
        palette[c * 4 + 3] = 0;
        continue;
      }
      // FSALib reads the SCL as raw `BGR555` values via MemoryMarshal.Cast,
      // which is LITTLE-endian and stores the channels in B-G-R order:
      //   bit 15    = unused
      //   bits 14-10 = BLUE
      //   bits  9-5  = GREEN
      //   bits  4-0  = RED
      const value = (scl[o + 1] << 8) | scl[o];
      const b = (value >> 10) & 0x1f;
      const g = (value >> 5) & 0x1f;
      const r = value & 0x1f;
      palette[c * 4] = (r << 3) | (r >> 2);
      palette[c * 4 + 1] = (g << 3) | (g >> 2);
      palette[c * 4 + 2] = (b << 3) | (b >> 2);
      palette[c * 4 + 3] = 255;
    }
    palettes.push(palette);
  }
  return palettes;
}

/**
 * Rasterizes one 8×8 4bpp part into `target` at (x, y).
 *
 * Port of `GBA4bppTileRenderer.DrawPart`: index 0 is treated as transparent and
 * left untouched, and horizontal/vertical mirroring is applied per part.
 */
export function drawPart(
  target: ImageBuffer,
  x: number,
  y: number,
  indices: Uint8Array,
  palette: Palette,
  mirror: MirrorAxis = MirrorAxis.None,
): void {
  if (x < 0 || y < 0 || x + PART_SIZE > target.width || y + PART_SIZE > target.height) {
    return;
  }

  const flipV = (mirror & MirrorAxis.Vertical) !== 0;
  const flipH = (mirror & MirrorAxis.Horizontal) !== 0;

  let p = 0;
  for (let line = 0; line < PART_SIZE; line++) {
    const targetY = y + (flipV ? PART_SIZE - 1 - line : line);
    if (!flipH) {
      for (let i = 0; i < PART_SIZE; i += 2) {
        const byte = indices[p++];
        const lo = byte & 0xf;
        if (lo !== 0) {
          writePalette(target, x + i, targetY, palette, lo);
        }
        const hi = byte >> 4;
        if (hi !== 0) {
          writePalette(target, x + i + 1, targetY, palette, hi);
        }
      }
    } else {
      for (let i = PART_SIZE - 1; i > 0; i -= 2) {
        const byte = indices[p++];
        const lo = byte & 0xf;
        if (lo !== 0) {
          writePalette(target, x + i, targetY, palette, lo);
        }
        const hi = byte >> 4;
        if (hi !== 0) {
          writePalette(target, x + i - 1, targetY, palette, hi);
        }
      }
    }
  }
}

function writePalette(
  target: ImageBuffer,
  x: number,
  y: number,
  palette: Palette,
  index: number,
): void {
  const o = index * 4;
  target.set(x, y, palette[o], palette[o + 1], palette[o + 2], palette[o + 3]);
}

/**
 * Renders a `.bti` I4 texture into a greyscale RGBA image at full intensity.
 *
 * I4 stores a 4-bit luminance per pixel. `StageRenderer` treats these as
 * additive "light" textures, so callers wanting the lit result should blend the
 * output with `ImageBuffer.addFrom` rather than compositing normally.
 */
export function decodeI4Texture(data: Uint8Array, width: number, height: number): ImageBuffer {
  const image = new ImageBuffer(width, height);
  const bw = Math.ceil(width / 8);
  const bh = Math.ceil(height / 8);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const blockOff = (by * bw + bx) * 32;
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px += 2) {
          const o = blockOff + py * 4 + px / 2;
          if (o >= data.length) {
            continue;
          }
          const byte = data[o];
          const i0 = (byte >> 4) & 0xf;
          const i1 = byte & 0xf;
          const x = bx * 8 + px;
          const y = by * 8 + py;
          if (x < width) {
            image.set(x, y, i0 * 17, i0 * 17, i0 * 17, 255);
          }
          if (x + 1 < width) {
            image.set(x + 1, y, i1 * 17, i1 * 17, i1 * 17, 255);
          }
        }
      }
    }
  }
  return image;
}
