import { Injectable, inject } from '@angular/core';
import { OpfsCacheService } from './opfs-cache.service';
import { LoggingService } from './logging.service';
import { ExtractionProgress, ExtractionResult, FstEntry, ResolvedFile } from '../entity/iso.entity';

/** Callback invoked throughout the extraction pipeline to report progress. */
export type ExtractionProgressCallback = (progress: ExtractionProgress) => void;

/**
 * IsoExtractorService
 * -------------------
 * Memory-safe GameCube ISO / GCM parser and extractor.
 *
 * Design constraints:
 *  - The source `File` is treated as a zero-memory pointer. Only targeted
 *    `file.slice()` reads are performed, so we never materialize the whole
 *    (up to ~2 GB) disc image in RAM.
 *  - All multi-byte integers in the GameCube header / FST are 32-bit big-endian.
 *  - Extracted payloads are streamed straight into OPFS via the cache service.
 */
@Injectable({ providedIn: 'root' })
export class IsoExtractorService {
  private readonly opfs = inject(OpfsCacheService);
  private readonly logger = inject(LoggingService);

  /** GameCube header offset (big-endian uint32) pointing at the FST. */
  private static readonly FST_OFFSET_POS = 0x0424;
  /** GameCube header offset (big-endian uint32) holding the FST size. */
  private static readonly FST_SIZE_POS = 0x0428;
  /** Fixed size of a single FST entry, in bytes. */
  private static readonly FST_ENTRY_SIZE = 12;

  /**
   * Stable root folder that every extracted path is re-rooted under, replacing
   * the disc's own FST root name (which varies by region, e.g. `GC4Sword_pal`).
   */
  static readonly ROOT_FOLDER = 'GC4swords';

  /**
   * Extracts every file from a GameCube ISO into OPFS.
   *
   * @param file             The user-selected `.iso` / `.gcm` file.
   * @param progressCallback Optional callback fired once per extracted file.
   * @returns `{ totalFiles }` — the number of files written to OPFS.
   */
  async extractAndCacheIso(
    file: File,
    progressCallback?: ExtractionProgressCallback,
  ): Promise<ExtractionResult> {
    const startedAt = performance.now();
    this.logger.info(`Starting extraction for "${file.name}" (${this.toMB(file.size)} MB)`);

    // Best-effort: ask for durable storage before we start writing gigabytes.
    progressCallback?.({
      phase: 'persisting',
      message: 'Requesting persistent storage…',
      extractedCount: 0,
      totalFiles: 0,
    });
    const persisted = await this.opfs.ensurePersistence();
    this.logger.info(`Persistent storage granted: ${persisted}`);

    // 1. Read the 8 header bytes that hold the FST location + size.
    //    0x0424 .. 0x042c covers both the 32-bit offset and the 32-bit size.
    progressCallback?.({
      phase: 'reading-header',
      message: 'Reading disc header…',
      extractedCount: 0,
      totalFiles: 0,
    });
    this.logger.info(`Reading FST header at 0x${IsoExtractorService.FST_OFFSET_POS.toString(16)}…`);
    const headerBuffer = await this.readSlice(
      file,
      IsoExtractorService.FST_OFFSET_POS,
      IsoExtractorService.FST_SIZE_POS + 4,
    );
    const headerView = new DataView(headerBuffer);
    const fstOffset = headerView.getUint32(0, false); // big-endian
    const fstSize = headerView.getUint32(4, false); // big-endian
    this.logger.info(`FST offset = 0x${fstOffset.toString(16)}, size = ${fstSize} bytes`);

    if (fstOffset <= 0 || fstSize <= 0) {
      throw new Error(
        'Invalid GameCube ISO: FST offset/size could not be resolved. Is this a valid .iso/.gcm file?',
      );
    }

    // Defensive limit (mirrors Dolphin): a real FST is never anywhere near
    // 128 MiB. This prevents a corrupt header from triggering a huge read.
    const MAX_FST_SIZE = 128 * 1024 * 1024;
    if (fstSize > MAX_FST_SIZE) {
      throw new Error(`Invalid GameCube ISO: FST size (${fstSize} bytes) is implausibly large.`);
    }

    // 2. Read only the FST chunk.
    progressCallback?.({
      phase: 'reading-fst',
      message: `Reading file system table (${this.toMB(fstSize)} MB)…`,
      extractedCount: 0,
      totalFiles: 0,
    });
    this.logger.info('Reading FST chunk…');
    const fstBuffer = await this.readSlice(file, fstOffset, fstOffset + fstSize);
    const fstView = new DataView(fstBuffer);
    this.logger.info(`FST chunk read: ${fstBuffer.byteLength} bytes`);

    const rootEntryCount = fstView.getUint32(8, false); // big-endian
    this.logger.info(`Root entry count = ${rootEntryCount}`);
    if (rootEntryCount === 0) {
      throw new Error('Invalid GameCube ISO: FST root entry count is zero.');
    }

    // The entry table must fit inside the FST; otherwise the header is corrupt.
    if (rootEntryCount * IsoExtractorService.FST_ENTRY_SIZE > fstSize) {
      throw new Error('Invalid GameCube ISO: FST entry count exceeds FST size.');
    }

    // 3. Parse all entries, then resolve only the *files* into full paths.
    progressCallback?.({
      phase: 'parsing-fst',
      message: `Parsing ${rootEntryCount} file system entries…`,
      extractedCount: 0,
      totalFiles: 0,
    });
    this.logger.info('Parsing FST entries…');
    const entries = this.parseFstEntries(fstView, rootEntryCount);
    const stringTable = new Uint8Array(fstBuffer);
    const stringTableOffset = rootEntryCount * IsoExtractorService.FST_ENTRY_SIZE;

    this.logger.info('Resolving file paths…');
    const files = this.resolveFilePaths(entries, stringTable, stringTableOffset);
    this.logger.info(`Resolved ${files.length} file(s) to extract.`);

    // 4. Stream each resolved file to OPFS.
    let extractedCount = 0;
    for (const resolved of files) {
      this.logger.info(
        `[${extractedCount + 1}/${files.length}] Extracting ${resolved.path} ` +
          `(offset=0x${resolved.offset.toString(16)}, size=${resolved.size})`,
      );
      const blob = file.slice(resolved.offset, resolved.offset + resolved.size);
      await this.opfs.writeExtractedFile(resolved.path, blob);

      extractedCount++;
      progressCallback?.({
        phase: 'extracting',
        message: `Extracting ${resolved.path}`,
        extractedCount,
        totalFiles: files.length,
        currentFileName: resolved.path,
      });

      // Yield to the event loop every few files so Angular can repaint the UI
      // instead of the status appearing frozen during long extractions.
      if (extractedCount % 5 === 0) {
        await this.yieldToUi();
      }
    }

    progressCallback?.({
      phase: 'complete',
      message: `Extracted ${extractedCount} file(s).`,
      extractedCount,
      totalFiles: files.length,
    });

    this.logger.info(
      `Extraction complete: ${extractedCount} file(s) in ${Math.round(performance.now() - startedAt)} ms`,
    );
    return { totalFiles: extractedCount };
  }

  /** Yields control back to the browser so pending UI updates can paint. */
  private yieldToUi(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  private toMB(bytes: number): string {
    return (bytes / (1024 * 1024)).toFixed(2);
  }

  /**
   * Parses `count` fixed-size (12-byte) FST entries starting at the beginning
   * of the FST.
   */
  private parseFstEntries(view: DataView, count: number): FstEntry[] {
    const entries: FstEntry[] = [];

    for (let i = 0; i < count; i++) {
      const base = i * IsoExtractorService.FST_ENTRY_SIZE;

      // Byte 0: 0x01 = directory, 0x00 = file.
      const isDirectory = view.getUint8(base) === 0x01;

      // Bytes 1-3: 24-bit big-endian name offset into the string table.
      const nameOffset =
        (view.getUint8(base + 1) << 16) | (view.getUint8(base + 2) << 8) | view.getUint8(base + 3);

      // Bytes 4-7: file offset, or parent index for directories.
      const offset = view.getUint32(base + 4, false);

      // Bytes 8-11: file size, or next-entry index for directories.
      const size = view.getUint32(base + 8, false);

      entries.push({ isDirectory, nameOffset, offset, size });
    }

    return entries;
  }

  /**
   * Walks the entry tree from the root, building full paths for every file.
   *
   * Directory entries store `size` as the index of the first entry *after*
   * their subtree, which lets us recurse without extra bookkeeping.
   *
   * The walk is defensively bounded: a malformed directory whose `size` does
   * not advance past its own index would otherwise loop forever (freezing the
   * tab at "reading file system table").
   */
  private resolveFilePaths(
    entries: FstEntry[],
    stringTable: Uint8Array,
    stringTableOffset: number,
  ): ResolvedFile[] {
    const files: ResolvedFile[] = [];
    let visitedEntries = 0;

    const walk = (entryIndex: number, endIndex: number, parentPath: string) => {
      let i = entryIndex;
      while (i < endIndex) {
        if (++visitedEntries > entries.length) {
          this.logger.error('FST walk exceeded entry count — aborting to avoid infinite loop.');
          throw new Error('Invalid GameCube ISO: FST walk did not terminate.');
        }

        const entry = entries[i];
        const name = this.readString(stringTable, stringTableOffset + entry.nameOffset);

        if (entry.isDirectory) {
          // `entry.size` is the exclusive end index of this directory's subtree,
          // clamped to the enclosing range and forced to advance past `i` so we
          // can never get stuck.
          const childEnd = Math.min(Math.max(entry.size, i + 1), endIndex);
          const childPath = parentPath ? `${parentPath}/${name}` : name;
          this.logger.info(`FST dir: ${childPath || '(root)'} [entries ${i + 1}..${childEnd})`);
          // Children start right after the directory entry itself.
          walk(i + 1, childEnd, childPath);
          i = childEnd;
        } else {
          const path = parentPath ? `${parentPath}/${name}` : name;
          files.push({ path, offset: entry.offset, size: entry.size });
          i++;
        }
      }
    };

    // Root entry is index 0; its subtree spans all parsed entries.
    walk(1, entries.length, '');

    // The disc nests everything inside its own region-specific root folder
    // (e.g. `GC4Sword_pal` on PAL). Strip that top segment and re-root every
    // path under a single stable folder so paths become `GC4swords/...`.
    const root = IsoExtractorService.ROOT_FOLDER;
    return files.map((file) => ({
      ...file,
      path: `${root}/${file.path.replace(/^GC4Sword[^/]*\//i, '')}`,
    }));
  }

  /** Reads a null-terminated UTF-8 string from a byte buffer. */
  private readString(bytes: Uint8Array, offset: number): string {
    let end = offset;
    while (end < bytes.length && bytes[end] !== 0x00) {
      end++;
    }
    return new TextDecoder().decode(bytes.subarray(offset, end)) || 'unnamed';
  }

  /** Reads an arbitrary `[start, end)` byte range from the file as an ArrayBuffer. */
  private readSlice(file: File, start: number, end: number): Promise<ArrayBuffer> {
    return file.slice(start, end).arrayBuffer();
  }
}
