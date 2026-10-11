/**
 * Decodes a parsed BTI texture (`BtiTexture`) into an `ImageBuffer`.
 *
 * This is the format-aware counterpart to `bti-decoder.ts`: it keeps the GX
 * format semantics that `FSALib.Rendering` relies on, most importantly:
 *
 * - **I4 / I8** decode to opaque greyscale so they can be used as additive
 *   "light" textures (see `StageRenderer`, `ifLight` branch).
 * - **Paletted formats** (C4/C8/C14X2) can be decoded through an *external*
 *   palette, which is what allows the Kawazoko water effect to swap in its own
 *   colour ramp (`PaletteImage<I4, TColor>`).
 * - **CMPR** applies the two-colour block rule with the transparency branch.
 */
import { BtiTexture, GxFormat, GX_FORMAT_NAMES, rgb5a3ToRgba, rgb565ToRgba } from './bti-texture';
import { ImageBuffer, Palette } from './gba-tile-renderer';

/** Human-readable name of a texture's format, for logging/UI. */
export function formatName(format: GxFormat): string {
  return GX_FORMAT_NAMES[format] ?? `0x${format.toString(16)}`;
}

/** Returns true when the format is a paletted (indexed) texture. */
export function isPaletted(format: GxFormat): boolean {
  return format === GxFormat.C4 || format === GxFormat.C8 || format === GxFormat.C14X2;
}

/**
 * Decodes a BTI texture to RGBA.
 *
 * @param texture  Parsed texture (native format + raw texel blocks).
 * @param override Optional palette to use instead of the embedded one, for
 *                 paletted formats. Mirrors `PaletteImage` in AuroraLib.
 */
export function decodeTexture(texture: BtiTexture, override?: Palette): ImageBuffer {
  const { format, width, height, data } = texture;

  // GX stores texels in fixed-size blocks, so the *encoded* image is padded up
  // to a whole number of blocks on both axes. Decoding straight into a
  // `width x height` buffer is wrong whenever the true size is not a multiple
  // of the block size (e.g. the 811x597 overworld map, whose 4x4 blocks pad to
  // 812x600): the padded pitch no longer matches the buffer pitch and the
  // overflow spills into a seam along the right edge.
  //
  // Mirror AuroraLib by decoding into the padded buffer, then cropping.
  const [blockW, blockH] = blockDimensions(format);
  const paddedW = Math.ceil(width / blockW) * blockW;
  const paddedH = Math.ceil(height / blockH) * blockH;
  const target = new ImageBuffer(paddedW, paddedH);

  switch (format) {
    case GxFormat.I4:
      decodeI4(data, width, height, target);
      break;
    case GxFormat.I8:
      decodeI8(data, width, height, target);
      break;
    case GxFormat.IA4:
      decodeIA4(data, width, height, target);
      break;
    case GxFormat.IA8:
      decodeIA8(data, width, height, target);
      break;
    case GxFormat.RGB565:
      decodeRGB565(data, width, height, target);
      break;
    case GxFormat.RGB5A3:
      decodeRGB5A3(data, width, height, target);
      break;
    case GxFormat.RGBA8:
      decodeRGBA8(data, width, height, target);
      break;
    case GxFormat.CMPR:
      decodeCMPR(data, width, height, target);
      break;
    case GxFormat.C4:
    case GxFormat.C8:
    case GxFormat.C14X2: {
      const palette = override ?? texture.palette;
      if (!palette) {
        throw new Error(`${formatName(format)} texture has no palette`);
      }
      decodePaletted(data, width, height, format, palette, target);
      break;
    }
    default:
      throw new Error(`Unsupported BTI format ${formatName(format)}`);
  }

  return crop(target, width, height);
}

/**
 * Block dimensions (width, height) per GX format, matching AuroraLib's
 * `GXImageFormat_Info` tables. Used to pad the decode buffer.
 */
function blockDimensions(format: GxFormat): [number, number] {
  switch (format) {
    case GxFormat.I4:
    case GxFormat.C4:
    case GxFormat.CMPR:
      return [8, 8];
    case GxFormat.I8:
    case GxFormat.IA4:
    case GxFormat.C8:
      return [8, 4];
    default:
      return [4, 4];
  }
}

/** Crops a padded decode buffer down to its true pixel dimensions. */
function crop(source: ImageBuffer, width: number, height: number): ImageBuffer {
  if (source.width === width && source.height === height) {
    return source;
  }
  const out = new ImageBuffer(width, height);
  for (let y = 0; y < height; y++) {
    const src = y * source.width * 4;
    out.pixels.set(source.pixels.subarray(src, src + width * 4), y * width * 4);
  }
  return out;
}

/** Decodes an I4 texture to opaque greyscale (usable as an additive light map). */
function decodeI4(data: Uint8Array, w: number, h: number, out: ImageBuffer): void {
  const bw = Math.ceil(w / 8);
  const bh = Math.ceil(h / 8);
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
          const i0 = ((byte >> 4) & 0xf) * 17;
          const i1 = (byte & 0xf) * 17;
          const x = bx * 8 + px;
          const y = by * 8 + py;
          out.set(x, y, i0, i0, i0, 255);
          out.set(x + 1, y, i1, i1, i1, 255);
        }
      }
    }
  }
}

/** Decodes an I8 texture to opaque greyscale. */
function decodeI8(data: Uint8Array, w: number, h: number, out: ImageBuffer): void {
  const bw = Math.ceil(w / 8);
  const bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const blockOff = (by * bw + bx) * 32;
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 8; px++) {
          const o = blockOff + py * 8 + px;
          if (o >= data.length) {
            continue;
          }
          const i = data[o];
          out.set(bx * 8 + px, by * 4 + py, i, i, i, 255);
        }
      }
    }
  }
}

/** Decodes an IA4 texture (4-bit intensity + 4-bit alpha). */
function decodeIA4(data: Uint8Array, w: number, h: number, out: ImageBuffer): void {
  const bw = Math.ceil(w / 8);
  const bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const blockOff = (by * bw + bx) * 32;
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 8; px++) {
          const o = blockOff + py * 8 + px;
          if (o >= data.length) {
            continue;
          }
          const byte = data[o];
          const i = ((byte >> 4) & 0xf) * 17;
          const a = (byte & 0xf) * 17;
          out.set(bx * 8 + px, by * 4 + py, i, i, i, a);
        }
      }
    }
  }
}

/** Decodes an IA8 texture (8-bit alpha + 8-bit intensity). */
function decodeIA8(data: Uint8Array, w: number, h: number, out: ImageBuffer): void {
  const bw = Math.ceil(w / 4);
  const bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const blockOff = (by * bw + bx) * 32;
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const o = blockOff + py * 8 + px * 2;
          if (o + 1 >= data.length) {
            continue;
          }
          const a = data[o];
          const i = data[o + 1];
          out.set(bx * 4 + px, by * 4 + py, i, i, i, a);
        }
      }
    }
  }
}

/** Decodes an RGB565 texture. */
function decodeRGB565(data: Uint8Array, w: number, h: number, out: ImageBuffer): void {
  const bw = Math.ceil(w / 4);
  const bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const blockOff = (by * bw + bx) * 32;
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const o = blockOff + py * 8 + px * 2;
          if (o + 1 >= data.length) {
            continue;
          }
          const [r, g, b, a] = rgb565ToRgba((data[o] << 8) | data[o + 1]);
          out.set(bx * 4 + px, by * 4 + py, r, g, b, a);
        }
      }
    }
  }
}

/** Decodes an RGB5A3 texture. */
function decodeRGB5A3(data: Uint8Array, w: number, h: number, out: ImageBuffer): void {
  const bw = Math.ceil(w / 4);
  const bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const blockOff = (by * bw + bx) * 32;
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const o = blockOff + py * 8 + px * 2;
          if (o + 1 >= data.length) {
            continue;
          }
          const [r, g, b, a] = rgb5a3ToRgba((data[o] << 8) | data[o + 1]);
          out.set(bx * 4 + px, by * 4 + py, r, g, b, a);
        }
      }
    }
  }
}

/** Decodes an RGBA8 texture (split AR / GB halves). */
function decodeRGBA8(data: Uint8Array, w: number, h: number, out: ImageBuffer): void {
  const bw = Math.ceil(w / 4);
  const bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const blockOff = (by * bw + bx) * 64;
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const arOff = blockOff + py * 8 + px * 2;
          const gbOff = blockOff + 32 + py * 8 + px * 2;
          if (gbOff + 1 >= data.length) {
            continue;
          }
          out.set(
            bx * 4 + px,
            by * 4 + py,
            data[arOff + 1],
            data[gbOff],
            data[gbOff + 1],
            data[arOff],
          );
        }
      }
    }
  }
}

/** Decodes a CMPR (S3TC-like) texture, honouring the 3-colour + transparent branch. */
function decodeCMPR(data: Uint8Array, w: number, h: number, out: ImageBuffer): void {
  const bw = Math.ceil(w / 8);
  const bh = Math.ceil(h / 8);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const blockOff = (by * bw + bx) * 32;
      if (blockOff + 8 > data.length) {
        continue;
      }
      const c0Raw = (data[blockOff] << 8) | data[blockOff + 1];
      const c1Raw = (data[blockOff + 2] << 8) | data[blockOff + 3];
      const palette = buildCmprPalette(c0Raw, c1Raw);

      for (let sub = 0; sub < 4; sub++) {
        const subX = (sub % 2) * 4;
        const subY = Math.floor(sub / 2) * 4;
        const bits = readUint32(data, blockOff + 4 + sub * 4);
        for (let py = 0; py < 4; py++) {
          for (let px = 0; px < 4; px++) {
            const shift = 30 - (py * 4 + px) * 2;
            const idx = (bits >>> shift) & 0x3;
            const c = palette[idx];
            // Index 3 in the 3-colour branch is fully transparent.
            out.set(bx * 8 + subX + px, by * 8 + subY + py, c[0], c[1], c[2], c[3]);
          }
        }
      }
    }
  }
}

function readUint32(data: Uint8Array, off: number): number {
  return ((data[off] << 24) | (data[off + 1] << 16) | (data[off + 2] << 8) | data[off + 3]) >>> 0;
}

function buildCmprPalette(c0Raw: number, c1Raw: number): [number, number, number, number][] {
  const c0 = rgb565ToRgba(c0Raw);
  const c1 = rgb565ToRgba(c1Raw);
  const pal: [number, number, number, number][] = [];

  if (c0Raw > c1Raw) {
    pal.push(c0, c1);
    pal.push([(2 * c0[0] + c1[0]) / 3, (2 * c0[1] + c1[1]) / 3, (2 * c0[2] + c1[2]) / 3, 255]);
    pal.push([(c0[0] + 2 * c1[0]) / 3, (c0[1] + 2 * c1[1]) / 3, (c0[2] + 2 * c1[2]) / 3, 255]);
  } else {
    pal.push(c0, c1);
    pal.push([(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2, (c0[2] + c1[2]) / 2, 255]);
    pal.push([0, 0, 0, 0]);
  }

  return pal;
}

/**
 * Decodes a paletted (C4 / C8 / C14X2) texture through `palette`.
 *
 * Block geometry must match AuroraLib's `GXImageFormat_Info` tables, which
 * differ per format and are *not* all 8×8:
 *
 * | format | block | bits/px | bytes/block |
 * |--------|-------|---------|-------------|
 * | C4     | 8×8   | 4       | 32          |
 * | C8     | 8×4   | 8       | 32          |
 * | C14X2  | 4×4   | 16      | 32          |
 *
 * C8 in particular decodes exactly like I8 (8×4 blocks); treating it as 8×8
 * scrambles the image.
 */
function decodePaletted(
  data: Uint8Array,
  w: number,
  h: number,
  format: GxFormat,
  palette: Palette,
  out: ImageBuffer,
): void {
  const [blockW, blockH] =
    format === GxFormat.C4 ? [8, 8] : format === GxFormat.C8 ? [8, 4] : [4, 4];
  // Derive the grid from the *destination* buffer, which `decodeTexture` has
  // already padded up to whole blocks. Using the unpadded width here would
  // make the write pitch disagree with the buffer pitch whenever the true
  // size is not block-aligned.
  const bw = out.width / blockW;
  const bh = out.height / blockH;

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const blockOff = (by * bw + bx) * 32;
      for (let py = 0; py < blockH; py++) {
        for (let px = 0; px < blockW; px++) {
          let index: number;
          if (format === GxFormat.C4) {
            // 4bpp: two indices per byte, high nibble first.
            const o = blockOff + py * (blockW / 2) + (px >> 1);
            if (o >= data.length) {
              continue;
            }
            const byte = data[o];
            index = px % 2 === 0 ? (byte >> 4) & 0xf : byte & 0xf;
          } else if (format === GxFormat.C8) {
            // 8bpp: one index per byte.
            const o = blockOff + py * blockW + px;
            if (o >= data.length) {
              continue;
            }
            index = data[o];
          } else {
            // C14X2: one 16-bit index per pixel, 14 bits significant.
            const o = blockOff + py * blockW * 2 + px * 2;
            if (o + 1 >= data.length) {
              continue;
            }
            index = ((data[o] << 8) | data[o + 1]) & 0x3fff;
          }

          const po = index * 4;
          if (po + 3 < palette.length) {
            out.set(
              bx * blockW + px,
              by * blockH + py,
              palette[po],
              palette[po + 1],
              palette[po + 2],
              palette[po + 3],
            );
          }
        }
      }
    }
  }
}
