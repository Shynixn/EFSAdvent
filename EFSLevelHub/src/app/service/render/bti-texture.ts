/**
 * GameCube / Wii BTI texture container parser.
 *
 * A BTI file holds a fixed header, optional palette data, and raw texture data.
 * Unlike `bti-decoder.ts`, this module does **not** flatten pixels to RGBA: it
 * keeps the GX texture format, dimensions and raw bytes intact so a renderer can
 * apply its own palettes, blending and format-specific rules — mirroring how
 * `FSALib.Rendering` uses `AuroraLib.Pixel.Texture.BTI`.
 *
 * All multi-byte values are big-endian.
 */

/** GX texture format ids (as found in the BTI header). */
export enum GxFormat {
  I4 = 0x0,
  I8 = 0x1,
  IA4 = 0x2,
  IA8 = 0x3,
  RGB565 = 0x4,
  RGB5A3 = 0x5,
  RGBA8 = 0x6,
  C4 = 0x8,
  C8 = 0x9,
  C14X2 = 0xa,
  CMPR = 0xe,
}

/** Human-readable name for a format, for logging/UI. */
export const GX_FORMAT_NAMES: Record<number, string> = {
  [GxFormat.I4]: 'I4',
  [GxFormat.I8]: 'I8',
  [GxFormat.IA4]: 'IA4',
  [GxFormat.IA8]: 'IA8',
  [GxFormat.RGB565]: 'RGB565',
  [GxFormat.RGB5A3]: 'RGB5A3',
  [GxFormat.RGBA8]: 'RGBA8',
  [GxFormat.C4]: 'C4',
  [GxFormat.C8]: 'C8',
  [GxFormat.C14X2]: 'C14X2',
  [GxFormat.CMPR]: 'CMPR',
};

/**
 * A parsed BTI texture whose pixels are still in their native format.
 *
 * `data` is the raw texel block stream starting at the format's data offset.
 * A renderer decodes it using `format`, `width` and `height`.
 */
export interface BtiTexture {
  format: GxFormat;
  width: number;
  height: number;
  /** Palette format id for paletted textures (C4/C8/C14X2), else null. */
  paletteFormat: GxFormat | null;
  /** Embedded palette colours as RGBA8888 (length = count * 4), if present. */
  palette: Uint8ClampedArray | null;
  /** Number of entries in the embedded palette. */
  paletteCount: number;
  /** Raw texel blocks. */
  data: Uint8Array;
}

/** Returns true if `data` looks like a BTI texture. */
export function isBti(data: Uint8Array): boolean {
  if (data.length < 0x20) {
    return false;
  }
  const format = data[0];
  const known =
    format === GxFormat.I4 ||
    format === GxFormat.I8 ||
    format === GxFormat.IA4 ||
    format === GxFormat.IA8 ||
    format === GxFormat.RGB565 ||
    format === GxFormat.RGB5A3 ||
    format === GxFormat.RGBA8 ||
    format === GxFormat.C4 ||
    format === GxFormat.C8 ||
    format === GxFormat.C14X2 ||
    format === GxFormat.CMPR;
  if (!known) {
    return false;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint16(2, false);
  const height = view.getUint16(4, false);
  return width > 0 && height > 0 && width <= 1024 && height <= 1024;
}

/** Parses a BTI file into its native-format texture description. */
export function parseBti(data: Uint8Array): BtiTexture {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const format = data[0] as GxFormat;
  const width = view.getUint16(2, false);
  const height = view.getUint16(4, false);

  if (width === 0 || height === 0) {
    throw new Error(`BTI has invalid dimensions ${width}x${height}`);
  }

  let paletteFormat: GxFormat | null = null;
  let palette: Uint8ClampedArray | null = null;
  let paletteCount = 0;
  let dataOffset = 0x20;

  if (format === GxFormat.C4 || format === GxFormat.C8 || format === GxFormat.C14X2) {
    paletteFormat = data[9] as GxFormat;
    paletteCount = view.getUint16(10, false);
    const paletteOffset = view.getUint32(12, false);
    palette = decodePaletteBytes(data, paletteFormat, paletteCount, paletteOffset);
    dataOffset = paletteOffset;
  }

  return {
    format,
    width,
    height,
    paletteFormat,
    palette,
    paletteCount,
    data: data.subarray(dataOffset),
  };
}

/** Decodes an embedded RGB565 / RGB5A3 palette to RGBA8888. */
function decodePaletteBytes(
  data: Uint8Array,
  format: GxFormat,
  count: number,
  offset: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const o = offset + i * 2;
    const value = (data[o] << 8) | data[o + 1];
    const [r, g, b, a] = format === GxFormat.RGB5A3 ? rgb5a3ToRgba(value) : rgb565ToRgba(value);
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  }
  return out;
}

// --- Color helpers (shared with bti-decoder) -------------------------------

export function rgb565ToRgba(value: number): [number, number, number, number] {
  const r = (value >> 11) & 0x1f;
  const g = (value >> 5) & 0x3f;
  const b = value & 0x1f;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), 255];
}

export function rgb5a3ToRgba(value: number): [number, number, number, number] {
  if (value & 0x8000) {
    const r = (value >> 10) & 0x1f;
    const g = (value >> 5) & 0x1f;
    const b = value & 0x1f;
    return [(r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2), 255];
  }
  const a = (value >> 12) & 0x7;
  const r = (value >> 8) & 0xf;
  const g = (value >> 4) & 0xf;
  const b = value & 0xf;
  return [(r << 4) | r, (g << 4) | g, (b << 4) | b, (a << 5) | (a << 2) | (a >> 1)];
}
