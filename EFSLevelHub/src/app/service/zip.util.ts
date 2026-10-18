/**
 * Minimal ZIP writer (STORE — no compression).
 *
 * The editor only needs to produce small archives (a stage's `manifest.json`
 * plus its `.arc`, which is already compressed by the game's YAZ0 format), so a
 * dependency-free STORE-only writer is enough. Every file is written verbatim
 * and the central directory is emitted last, which is what any standard unzip
 * implementation (including the WASM `Unzip` export) expects.
 */

/** One file to place in the archive. */
export interface ZipFileEntry {
  /** Path inside the archive, using forward slashes. */
  path: string;
  /** Raw (uncompressed) contents. */
  data: Uint8Array;
}

/** DOS time/date pair for a JS `Date` (as stored in ZIP headers). */
function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (Math.floor(date.getSeconds() / 2) & 0x1f) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getHours() & 0x1f) << 11);
  const day =
    (date.getDate() & 0x1f) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (((date.getFullYear() - 1980) & 0x7f) << 9);
  return { time, date: day };
}

/** CRC-32 of a byte array (the classic ZIP polynomial). */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Builds a ZIP archive containing `entries`.
 *
 * @param entries Files to store (paths are written as given, `/`-separated).
 * @param date    Modification timestamp recorded in the headers.
 */
export function createZip(entries: readonly ZipFileEntry[], date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { time, date: dosDate } = dosDateTime(date);

  /** Per-entry metadata needed to write the central directory. */
  interface CentralEntry {
    name: Uint8Array;
    crc: number;
    size: number;
    offset: number;
  }

  const files: Uint8Array[] = [];
  const central: CentralEntry[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path.replace(/\\/g, '/'));
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + name.length + entry.data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); // local file header signature
    view.setUint16(4, 20, true); // version needed (2.0)
    view.setUint16(6, 0, true); // flags
    view.setUint16(8, 0, true); // method: store
    view.setUint16(10, time, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, entry.data.length, true); // compressed size
    view.setUint32(22, entry.data.length, true); // uncompressed size
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true); // extra field length
    local.set(name, 30);
    local.set(entry.data, 30 + name.length);

    files.push(local);
    central.push({ name, crc, size: entry.data.length, offset });
    offset += local.length;
  }

  // Central directory.
  const centralParts: Uint8Array[] = [];
  let centralSize = 0;
  for (const entry of central) {
    const header = new Uint8Array(46 + entry.name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true); // central header signature
    view.setUint16(4, 20, true); // version made by
    view.setUint16(6, 20, true); // version needed
    view.setUint16(8, 0, true); // flags
    view.setUint16(10, 0, true); // method: store
    view.setUint16(12, time, true);
    view.setUint16(14, dosDate, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.size, true);
    view.setUint32(24, entry.size, true);
    view.setUint16(28, entry.name.length, true);
    view.setUint16(30, 0, true); // extra length
    view.setUint16(32, 0, true); // comment length
    view.setUint16(34, 0, true); // disk number
    view.setUint16(36, 0, true); // internal attributes
    view.setUint32(38, 0, true); // external attributes
    view.setUint32(42, entry.offset, true); // local header offset
    header.set(entry.name, 46);
    centralParts.push(header);
    centralSize += header.length;
  }

  // End of central directory.
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true); // disk number
  endView.setUint16(6, 0, true); // disk with central directory
  endView.setUint16(8, central.length, true);
  endView.setUint16(10, central.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true); // comment length

  const total = files.reduce((sum, part) => sum + part.length, 0) + centralSize + end.length;
  const out = new Uint8Array(total);
  let position = 0;
  // `Uint8Array<ArrayBufferLike>` vs `Uint8Array<ArrayBuffer>` typing mismatch on
  // `set`; both are plain byte views here.
  const target = out as unknown as Uint8Array<ArrayBuffer>;
  for (const part of files) {
    target.set(part, position);
    position += part.length;
  }
  for (const part of centralParts) {
    target.set(part, position);
    position += part.length;
  }
  target.set(end, position);
  return out;
}
