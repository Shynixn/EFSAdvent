/**
 * GameCube / Wii BTI texture decoder.
 *
 * BTI files contain a fixed-size header, followed by palette data (for paletted
 * formats) and then the raw texture data. All multi-byte values are big-endian.
 *
 * Reference format: format byte at 0x00, alpha at 0x01, width (u16) at 0x02,
 * height (u16) at 0x04. For paletted formats the palette header sits at 0x08
 * (format u8, count u16, offset u32).
 *
 * Supported formats: I4, I8, IA4, IA8, RGB565, RGB5A3, RGBA8, CMPR.
 * (C4/C8/C14X2 paletted formats are supported too.)
 */

/** Decoded image: RGBA8888 pixel bytes plus dimensions. */
export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA8 pixels, length = width * height * 4. */
  rgba: Uint8ClampedArray;
}

/** GX texture format ids. */
enum GxFormat {
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

/** Decodes a BTI texture into RGBA8 pixels. Returns null if unsupported. */
export function decodeBti(data: Uint8Array): DecodedImage {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const textureFormat = data[0];
  const width = view.getUint16(2, false);
  const height = view.getUint16(4, false);

  if (width === 0 || height === 0) {
    throw new Error(`BTI has invalid dimensions ${width}x${height}`);
  }

  let palette: Uint8ClampedArray | null = null;
  let dataOffset = 0x20;

  // Paletted formats store palette metadata starting at 0x08. The palette
  // itself lives at the end of the file (`paletteOffset`); the texel data
  // always begins right after the 0x20-byte header.
  if (
    textureFormat === GxFormat.C4 ||
    textureFormat === GxFormat.C8 ||
    textureFormat === GxFormat.C14X2
  ) {
    const paletteFormat = data[9];
    const paletteCount = view.getUint16(10, false);
    const paletteOffset = view.getUint32(12, false);
    palette = decodePalette(data, paletteFormat, paletteCount, paletteOffset);
  }

  const rgba = new Uint8ClampedArray(width * height * 4);

  switch (textureFormat) {
    case GxFormat.I4:
      decodeI4(data, dataOffset, width, height, rgba);
      break;
    case GxFormat.I8:
      decodeI8(data, dataOffset, width, height, rgba);
      break;
    case GxFormat.IA4:
      decodeIA4(data, dataOffset, width, height, rgba);
      break;
    case GxFormat.IA8:
      decodeIA8(data, dataOffset, width, height, rgba);
      break;
    case GxFormat.RGB565:
      decodeRGB565(data, dataOffset, width, height, rgba);
      break;
    case GxFormat.RGB5A3:
      decodeRGB5A3(data, dataOffset, width, height, rgba);
      break;
    case GxFormat.RGBA8:
      decodeRGBA8(data, dataOffset, width, height, rgba);
      break;
    case GxFormat.CMPR:
      decodeCMPR(data, dataOffset, width, height, rgba);
      break;
    case GxFormat.C4:
    case GxFormat.C8:
    case GxFormat.C14X2:
      decodePaletted(data, dataOffset, width, height, textureFormat, palette!, rgba);
      break;
    default:
      throw new Error(`Unsupported BTI format 0x${textureFormat.toString(16)}`);
  }

  return { width, height, rgba };
}

// --- Palette ---------------------------------------------------------------

function decodePalette(
  data: Uint8Array,
  paletteFormat: number,
  count: number,
  offset: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const o = offset + i * 2;
    const value = (data[o] << 8) | data[o + 1];
    const [r, g, b, a] =
      paletteFormat === GxFormat.RGB5A3 ? rgb5a3ToRgba(value) : rgb565ToRgba(value);
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  }
  return out;
}

// --- Color helpers ---------------------------------------------------------

function rgb565ToRgba(value: number): [number, number, number, number] {
  const r = (value >> 11) & 0x1f;
  const g = (value >> 5) & 0x3f;
  const b = value & 0x1f;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), 255];
}

function rgb5a3ToRgba(value: number): [number, number, number, number] {
  if (value & 0x8000) {
    // Opaque RGB555
    const r = (value >> 10) & 0x1f;
    const g = (value >> 5) & 0x1f;
    const b = value & 0x1f;
    return [(r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2), 255];
  }
  // RGB4A3
  const a = (value >> 12) & 0x7;
  const r = (value >> 8) & 0xf;
  const g = (value >> 4) & 0xf;
  const b = value & 0xf;
  return [(r << 4) | r, (g << 4) | g, (b << 4) | b, (a << 5) | (a << 2) | (a >> 1)];
}

function setPixel(
  rgba: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const i = (y * width + x) * 4;
  rgba[i] = r;
  rgba[i + 1] = g;
  rgba[i + 2] = b;
  rgba[i + 3] = a;
}

// --- Format decoders -------------------------------------------------------

function decodeI4(
  data: Uint8Array,
  off: number,
  w: number,
  h: number,
  out: Uint8ClampedArray,
): void {
  const bw = Math.ceil(w / 8);
  const bh = Math.ceil(h / 8);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const blockOff = off + (by * bw + bx) * 32;
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px += 2) {
          const byte = data[blockOff + py * 4 + px / 2];
          const i0 = (byte >> 4) & 0xf;
          const i1 = byte & 0xf;
          const x = bx * 8 + px;
          const y = by * 8 + py;
          if (x < w && y < h) setPixel(out, w, x, y, i0 * 17, i0 * 17, i0 * 17, i0 * 17);
          if (x + 1 < w && y < h) setPixel(out, w, x + 1, y, i1 * 17, i1 * 17, i1 * 17, i1 * 17);
        }
      }
    }
  }
}

function decodeI8(
  data: Uint8Array,
  off: number,
  w: number,
  h: number,
  out: Uint8ClampedArray,
): void {
  const bw = Math.ceil(w / 8);
  const bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const blockOff = off + (by * bw + bx) * 32;
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 8; px++) {
          const i = data[blockOff + py * 8 + px];
          const x = bx * 8 + px;
          const y = by * 4 + py;
          if (x < w && y < h) setPixel(out, w, x, y, i, i, i, i);
        }
      }
    }
  }
}

function decodeIA4(
  data: Uint8Array,
  off: number,
  w: number,
  h: number,
  out: Uint8ClampedArray,
): void {
  const bw = Math.ceil(w / 8);
  const bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const blockOff = off + (by * bw + bx) * 32;
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 8; px++) {
          const byte = data[blockOff + py * 8 + px];
          const i = (byte >> 4) & 0xf;
          const a = byte & 0xf;
          const x = bx * 8 + px;
          const y = by * 4 + py;
          if (x < w && y < h) setPixel(out, w, x, y, i * 17, i * 17, i * 17, a * 17);
        }
      }
    }
  }
}

function decodeIA8(
  data: Uint8Array,
  off: number,
  w: number,
  h: number,
  out: Uint8ClampedArray,
): void {
  const bw = Math.ceil(w / 4);
  const bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const blockOff = off + (by * bw + bx) * 32;
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const a = data[blockOff + py * 8 + px * 2];
          const i = data[blockOff + py * 8 + px * 2 + 1];
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x < w && y < h) setPixel(out, w, x, y, i, i, i, a);
        }
      }
    }
  }
}

function decodeRGB565(
  data: Uint8Array,
  off: number,
  w: number,
  h: number,
  out: Uint8ClampedArray,
): void {
  const bw = Math.ceil(w / 4);
  const bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const blockOff = off + (by * bw + bx) * 32;
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const o = blockOff + py * 8 + px * 2;
          const value = (data[o] << 8) | data[o + 1];
          const [r, g, b, a] = rgb565ToRgba(value);
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x < w && y < h) setPixel(out, w, x, y, r, g, b, a);
        }
      }
    }
  }
}

function decodeRGB5A3(
  data: Uint8Array,
  off: number,
  w: number,
  h: number,
  out: Uint8ClampedArray,
): void {
  const bw = Math.ceil(w / 4);
  const bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const blockOff = off + (by * bw + bx) * 32;
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const o = blockOff + py * 8 + px * 2;
          const value = (data[o] << 8) | data[o + 1];
          const [r, g, b, a] = rgb5a3ToRgba(value);
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x < w && y < h) setPixel(out, w, x, y, r, g, b, a);
        }
      }
    }
  }
}

function decodeRGBA8(
  data: Uint8Array,
  off: number,
  w: number,
  h: number,
  out: Uint8ClampedArray,
): void {
  const bw = Math.ceil(w / 4);
  const bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const blockOff = off + (by * bw + bx) * 64;
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          // RGBA8 is stored as 32 AR (alpha+red) then 32 GB (green+blue).
          const arOff = blockOff + py * 8 + px * 2;
          const gbOff = blockOff + 32 + py * 8 + px * 2;
          const a = data[arOff];
          const r = data[arOff + 1];
          const g = data[gbOff];
          const b = data[gbOff + 1];
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x < w && y < h) setPixel(out, w, x, y, r, g, b, a);
        }
      }
    }
  }
}

function decodeCMPR(
  data: Uint8Array,
  off: number,
  w: number,
  h: number,
  out: Uint8ClampedArray,
): void {
  const bw = Math.ceil(w / 8);
  const bh = Math.ceil(h / 8);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const blockOff = off + (by * bw + bx) * 32;

      // First sub-block carries the two reference colors.
      const c0Raw = (data[blockOff] << 8) | data[blockOff + 1];
      const c1Raw = (data[blockOff + 2] << 8) | data[blockOff + 3];
      const pal = buildCmprPalette(c0Raw, c1Raw);

      // 4 sub-blocks of 4x4 (2 bits per pixel).
      for (let sub = 0; sub < 4; sub++) {
        const subX = (sub % 2) * 4;
        const subY = Math.floor(sub / 2) * 4;
        const bits = readUint32(data, blockOff + 4 + sub * 4);
        for (let py = 0; py < 4; py++) {
          for (let px = 0; px < 4; px++) {
            const shift = 30 - (py * 4 + px) * 2;
            const idx = (bits >>> shift) & 0x3;
            const c = pal[idx];
            const x = bx * 8 + subX + px;
            const y = by * 8 + subY + py;
            if (x < w && y < h) setPixel(out, w, x, y, c[0], c[1], c[2], c[3]);
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
    pal.push([0, 0, 0, 0]); // Transparent
  }

  return pal;
}

function decodePaletted(
  data: Uint8Array,
  off: number,
  w: number,
  h: number,
  format: number,
  palette: Uint8ClampedArray,
  out: Uint8ClampedArray,
): void {
  const bw = Math.ceil(w / 8);
  const bh = Math.ceil(h / 8);
  const bitsPerPixel = format === GxFormat.C4 ? 4 : format === GxFormat.C8 ? 8 : 16;

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const blockOff = off + (by * bw + bx) * 32;
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          let index: number;
          if (bitsPerPixel === 4) {
            const byte = data[blockOff + py * 4 + (px >> 1)];
            index = px % 2 === 0 ? (byte >> 4) & 0xf : byte & 0xf;
          } else if (bitsPerPixel === 8) {
            index = data[blockOff + py * 8 + px];
          } else {
            const o = blockOff + py * 16 + px * 2;
            index = ((data[o] << 8) | data[o + 1]) & 0x3fff;
          }

          const x = bx * 8 + px;
          const y = by * 8 + py;
          if (x < w && y < h && index * 4 + 3 < palette.length) {
            setPixel(
              out,
              w,
              x,
              y,
              palette[index * 4],
              palette[index * 4 + 1],
              palette[index * 4 + 2],
              palette[index * 4 + 3],
            );
          }
        }
      }
    }
  }
}
