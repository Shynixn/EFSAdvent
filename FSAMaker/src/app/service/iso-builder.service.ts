import { Injectable, inject } from '@angular/core';
import { LoggingService } from './logging.service';
import { IsoSourceService } from './iso-source.service';
import { OpfsCacheService } from './opfs-cache.service';
import { EditorService } from './editor.service';
import { FSALibService } from './fsalib.service';
import { StageService, DEFAULT_STAGE_ARC_ORDER, stageArcFilePath } from './stage.service';
import { WorldService } from './world.service';
import { sha256Hex } from './hash.util';

/** Byte offset in the GameCube header holding the FST offset (big-endian u32). */
const FST_OFFSET_POS = 0x0424;
/** Byte offset in the GameCube header holding the FST size (big-endian u32). */
const FST_SIZE_POS = 0x0428;
/** Fixed size (bytes) of a single FST entry. */
const FST_ENTRY_SIZE = 12;
/** Bytes of alignment applied between consecutive file payloads. */
const FILE_ALIGNMENT = 4;

/** A single FST entry (raw, as stored in the disc). */
interface RawEntry {
  isDirectory: boolean;
  nameOffset: number;
  offset: number;
  size: number;
}

/** Progress callback for the export pipeline. */
export type ExportProgressCallback = (progress: ExportProgress) => void;

/** Progress event emitted throughout the ISO export pipeline. */
export interface ExportProgress {
  /** 0–100 progress percentage. */
  percent: number;
  /** Human-readable description of the current step. */
  message: string;
}

/** Result of a completed export. */
export interface ExportResult {
  /** Number of arc files that were replaced with editor versions. */
  replacedArcs: number;
  /** Number of those arcs that had to be re-indexed into a different slot. */
  retargetedArcs: number;
  /** Total bytes written. */
  outputSize: number;
}

/**
 * Minimal output sink the builder writes to. Implemented both by the File
 * System Access API's `FileSystemWritableFileStream` and by an in-memory
 * collector used for the download fallback.
 */
export interface IsoWriter {
  /**
   * Ensures the output is exactly `size` bytes long. Called once before any
   * payload is written so the destination is pre-allocated to a known length.
   */
  size(size: number): Promise<void>;
  /** Writes `data` at the given absolute byte `position`. */
  write(position: number, data: BlobPart): Promise<void>;
  /** Truncates the output to `size` bytes. */
  truncate(size: number): Promise<void>;
  /** Finalizes the output. */
  close(): Promise<void>;
  /** Aborts and discards the output. */
  abort(): Promise<void>;
}

/**
 * IsoBuilderService
 * -----------------
 * Rebuilds a GameCube ISO from the persisted source image (`IsoSourceService`)
 * with the world's stage arcs replaced by the editor's own arc files.
 *
 * For each stage reference in the selected world, the referenced stage id maps
 * to `/editor/stage/<guid>.arc`. The FST entry whose file name matches that
 * reference's `arcFileName` (e.g. `boss010.arc`) is rewritten with the editor
 * arc's bytes instead of the original extracted bytes.
 *
 * Because a replacement arc may differ in size, the whole image is rebuilt:
 * the prefix (header, DOL, filler and the FST) is copied verbatim with the FST
 * entry offsets/sizes patched, then every payload is written back-to-back with
 * 4-byte alignment.
 */
@Injectable({ providedIn: 'root' })
export class IsoBuilderService {
  private readonly logger = inject(LoggingService);
  private readonly isoSource = inject(IsoSourceService);
  private readonly opfs = inject(OpfsCacheService);
  private readonly editor = inject(EditorService);
  private readonly fsaLib = inject(FSALibService);
  private readonly stageService = inject(StageService);
  private readonly worldService = inject(WorldService);

  /**
   * Builds a patched ISO for the given world and streams it into `output`.
   *
   * @param worldId  World whose stage arcs should be applied.
   * @param output   Destination writer (file stream or in-memory collector).
   * @param onProgress Optional progress callback.
   */
  async exportWorld(
    worldId: string,
    output: IsoWriter,
    onProgress?: ExportProgressCallback,
  ): Promise<ExportResult> {
    const iso = await this.isoSource.getFile();
    if (!iso) {
      throw new Error(
        'Source ISO is not available. Re-import the disc image so it can be saved for export.',
      );
    }

    await this.worldService.load();
    const world = this.worldService.getById(worldId);
    if (!world) {
      throw new Error(`Unknown world "${worldId}".`);
    }

    // Map each arc file name (e.g. `boss010.arc`) to the editor arc bytes that
    // should replace it.
    onProgress?.({ percent: 2, message: 'Resolving replacement stage archives…' });
    const { map: replacements, retargeted } = await this.resolveReplacements(world.stages);

    return this.buildIso(iso, replacements, retargeted, output, onProgress);
  }

  /**
   * Builds a "test" ISO where the given (currently open) stage is placed into
   * the **first** stage slot (`boss010.arc`) only.
   *
   * The stage's archive is re-indexed to that slot's map index (10) so the game
   * resolves it correctly. All other slots keep their original arcs.
   *
   * @param stageId  Stage whose archive is used for the first slot.
   * @param output   Destination writer (file stream or in-memory collector).
   * @param onProgress Optional progress callback.
   */
  async exportTestIso(
    stageId: string,
    output: IsoWriter,
    onProgress?: ExportProgressCallback,
  ): Promise<ExportResult> {
    const iso = await this.isoSource.getFile();
    if (!iso) {
      throw new Error(
        'Source ISO is not available. Re-import the disc image so it can be saved for export.',
      );
    }

    onProgress?.({ percent: 2, message: 'Resolving test stage archive…' });
    const { map: replacements, retargeted } = await this.resolveSingleStageForFirstSlot(stageId);

    return this.buildIso(iso, replacements, retargeted, output, onProgress);
  }

  /**
   * Builds the replacement map for a test ISO: the stage archive is placed in
   * the FIRST {@link DEFAULT_STAGE_ARC_ORDER} slot (`boss010.arc`), re-indexed
   * to that slot.
   */
  private async resolveSingleStageForFirstSlot(
    stageId: string,
  ): Promise<{ map: Map<string, Uint8Array>; retargeted: number }> {
    const map = new Map<string, Uint8Array>();
    let retargeted = 0;

    const original = await this.editor.readEditorFile(stageArcFilePath(stageId));
    if (!original) {
      throw new Error('This stage has no editor archive to export yet.');
    }

    const arcId = DEFAULT_STAGE_ARC_ORDER[0];
    if (!arcId) {
      throw new Error('No stage slots are configured.');
    }
    const arcName = `${arcId}.arc`;
    const targetIndex = Number.parseInt(arcId.replace(/\D/g, ''), 10);
    const { bytes, retargeted: didRetarget } = await this.retargetIfNeeded(
      original,
      arcId,
      targetIndex,
      arcName,
    );
    if (didRetarget) {
      retargeted++;
    }
    map.set(arcName.toLowerCase(), bytes);

    return { map, retargeted };
  }

  /**
   * Writes the rebuilt image: patches the FST and streams the prefix + every
   * payload (with `replacements` substituted) contiguously into `output`.
   */
  private async buildIso(
    iso: File,
    replacements: Map<string, Uint8Array>,
    retargeted: number,
    output: IsoWriter,
    onProgress?: ExportProgressCallback,
  ): Promise<ExportResult> {
    // 1. Read and parse the FST.
    onProgress?.({ percent: 5, message: 'Reading file system table…' });
    const { fstOffset, fstSize, fstRaw, entries, stringTable } = await this.readFst(iso);

    // 2. Resolve every file entry to its full path.
    const files = this.resolveFiles(entries, stringTable);
    this.logger.info(
      `ISO export: ${files.length} file(s), ${replacements.size} replacement arc(s).`,
    );

    // 3. Compute the byte length of the prefix (everything before the first
    //    payload). Its content is copied verbatim; the FST inside it is patched.
    const firstPayload = Math.min(...files.map((f) => f.entry.offset));
    const prefixLength = firstPayload;

    // 4. Compute new offsets for every payload, walking in original offset order
    //    so the relative layout is preserved. Payload sizes are known: original
    //    size, unless a replacement arc overrides it.
    const ordered = [...files].sort((a, b) => a.entry.offset - b.entry.offset);
    let cursor = alignUp(prefixLength, FILE_ALIGNMENT);

    interface PlannedFile {
      entry: RawEntry;
      /** Index of the entry within the FST entry table. */
      entryIndex: number;
      sourceOffset: number;
      sourceSize: number;
      outputOffset: number;
      /** Size of the bytes that will be written for this file. */
      outputSize: number;
      replacement?: Uint8Array;
    }

    const planned: PlannedFile[] = ordered.map((file) => {
      const replacement = replacements.get(file.name.toLowerCase());
      const outputSize = replacement ? replacement.byteLength : file.entry.size;
      const outputOffset = cursor;
      cursor = alignUp(cursor + outputSize, FILE_ALIGNMENT);
      return {
        entry: file.entry,
        entryIndex: file.entryIndex,
        sourceOffset: file.entry.offset,
        sourceSize: file.entry.size,
        outputOffset,
        outputSize,
        replacement,
      };
    });

    // Total image length is known up-front: the aligned end of the last payload.
    const finalLength = cursor;

    // 5. Patch the FST (in a copy) with the recomputed offsets/sizes.
    const fstBytes = fstRaw.slice();
    const fstView = new DataView(fstBytes.buffer);
    for (const item of planned) {
      const base = item.entryIndex * FST_ENTRY_SIZE;
      fstView.setUint32(base + 4, item.outputOffset, false);
      fstView.setUint32(base + 8, item.outputSize, false);
    }

    // 6. Write the output contiguously. The destination is pre-sized to the
    //    known total length and every byte is written in order — no sparse
    //    seeks past the end, which some writers silently mishandle.
    const writer = output;
    try {
      onProgress?.({ percent: 8, message: 'Allocating output…' });
      await writer.size(finalLength);

      onProgress?.({ percent: 10, message: 'Writing image header…' });
      // Prefix `[0, prefixLength)`: everything before the first payload, with
      // the patched FST swapped in at its original location.
      const fstEnd = fstOffset + fstSize;
      await this.streamRange(writer, 0, iso, 0, Math.min(fstOffset, prefixLength));
      await writer.write(fstOffset, toBlobPart(fstBytes));
      if (fstEnd < prefixLength) {
        await this.streamRange(writer, fstEnd, iso, fstEnd, prefixLength);
      }

      // Walk the payloads in output order, filling any alignment gaps with
      // explicit zero bytes so the stream stays fully contiguous.
      let written = prefixLength;
      let done = 0;
      for (const item of planned) {
        // Fill the gap between the previous payload and this one (padding).
        if (item.outputOffset > written) {
          await writer.write(written, new Uint8Array(item.outputOffset - written));
          written = item.outputOffset;
        }

        // Replacements come from memory; everything else is streamed straight
        // from the source ISO as a Blob slice (no full read into RAM).
        if (item.replacement) {
          await writer.write(item.outputOffset, toBlobPart(item.replacement));
        } else {
          await this.streamRange(
            writer,
            item.outputOffset,
            iso,
            item.sourceOffset,
            item.sourceOffset + item.sourceSize,
          );
        }
        written = item.outputOffset + item.outputSize;

        // Zero-fill this payload's trailing alignment padding.
        const nextOffset = alignUp(written, FILE_ALIGNMENT);
        if (nextOffset > written) {
          await writer.write(written, new Uint8Array(nextOffset - written));
          written = nextOffset;
        }

        done++;
        const percent = 12 + Math.floor((done / planned.length) * 86);
        onProgress?.({
          percent,
          message: `Writing file ${done}/${planned.length}…`,
        });

        // Yield periodically so the progress dialog can repaint.
        if (done % 10 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      await writer.close();

      onProgress?.({ percent: 100, message: 'Export complete.' });
      this.logger.info(
        `ISO export: wrote ${finalLength} bytes (${replacements.size} arc(s) replaced, ` +
          `${retargeted} re-indexed).`,
      );
      return {
        replacedArcs: replacements.size,
        retargetedArcs: retargeted,
        outputSize: finalLength,
      };
    } catch (error) {
      await writer.abort().catch(() => undefined);
      this.logger.error('ISO export: failed while writing the image', error);
      throw error;
    }
  }

  /** Copies `[start, end)` from the source ISO into `outputPos` of the writer. */
  private async streamRange(
    writer: IsoWriter,
    outputPos: number,
    iso: File,
    start: number,
    end: number,
  ): Promise<void> {
    if (end <= start) {
      return;
    }
    const blob = iso.slice(start, end);
    await writer.write(outputPos, blob);
  }

  /**
   * Builds a map of lower-cased arc file names (e.g. `boss010.arc`) to the
   * editor arc bytes that should replace them.
   *
   * The target arc name is derived from each stage's **slot index** via
   * {@link DEFAULT_STAGE_ARC_ORDER} — slot 0 always maps to `boss010.arc`,
   * slot 1 to `boss011.arc`, and so on. This is independent of the world ref's
   * stored `arcFileName`, which is display metadata only and may be blank.
   *
   * A stage archive is internally bound to its own map index (`B0NN`/`M0NN`
   * folders and `0NN_…` files). When the slot's target index differs from the
   * editor stage's own index, the archive is **re-indexed** via FSALib so the
   * game can resolve it in the new slot.
   */
  private async resolveReplacements(
    stages: { id: string; arcFileName: string }[],
  ): Promise<{ map: Map<string, Uint8Array>; retargeted: number }> {
    await this.stageService.load();
    const map = new Map<string, Uint8Array>();
    let retargeted = 0;

    for (let slot = 0; slot < stages.length; slot++) {
      const ref = stages[slot];
      if (!ref?.id) {
        continue;
      }
      const arcId = DEFAULT_STAGE_ARC_ORDER[slot];
      if (!arcId) {
        continue;
      }
      const arcName = `${arcId}.arc`;
      const targetIndex = Number.parseInt(arcId.replace(/\D/g, ''), 10);

      const original = await this.editor.readEditorFile(stageArcFilePath(ref.id));
      if (!original) {
        this.logger.warn(
          `ISO export: no editor arc for stage "${ref.id}" (expected ${arcName}); keeping original.`,
        );
        continue;
      }

      // Skip stages that are untouched (same bytes as imported) and still in
      // their own slot — the ISO's original payload is used as-is.
      const stage = this.stageService.getById(ref.id);
      const originalIndex = stage?.originalIndex;
      if (originalIndex === undefined || originalIndex === targetIndex) {
        const originalHash = stage?.originalHash ?? (await this.hashExtractedArc(arcId));
        if (originalHash && originalHash === (await sha256Hex(original))) {
          this.logger.info(`ISO export: "${arcName}" unchanged — keeping the original arc.`);
          continue;
        }
      }

      const { bytes, retargeted: didRetarget } = await this.retargetIfNeeded(
        original,
        arcId,
        targetIndex,
        arcName,
      );
      if (didRetarget) {
        retargeted++;
      }
      map.set(arcName.toLowerCase(), bytes);
    }

    return { map, retargeted };
  }

  /**
   * Makes an editor arc usable in the given target slot.
   *
   * If the stage already belongs to that slot (same map index) it is used as-is.
   * Otherwise the archive is **re-indexed** to the target slot: every internal
   * name and the map index are rewritten (`boss020` → `boss010`, `m020`→`m010`,
   * `d_map020_*` → `d_map010_*`, …). Crucially this keeps the *source stage's
   * complete resource set* (its `j3d`/`timg`/etc.), which a stage's rooms and
   * actors depend on — mixing one stage's content with another's resources
   * produces dangling references the game crashes on.
   *
   * A content-merge (source content into the slot's own archive) is only used as
   * a fallback, for cases where re-indexing fails.
   */
  private async retargetIfNeeded(
    arcBytes: Uint8Array,
    targetArcId: string,
    targetIndex: number,
    arcName: string,
  ): Promise<{ bytes: Uint8Array; retargeted: boolean }> {
    if (!Number.isFinite(targetIndex)) {
      return { bytes: arcBytes, retargeted: false };
    }

    try {
      const parsed = await this.fsaLib.parseStage(arcBytes);
      if (parsed.Index === targetIndex) {
        return { bytes: arcBytes, retargeted: false };
      }

      // Preferred path: re-index the source archive itself, preserving all of
      // its resources while renaming everything to the target slot.
      this.logger.info(
        `ISO export: re-indexing arc "${arcName}" from map ${parsed.Index} → ${targetIndex}.`,
      );
      const retargeted = await this.fsaLib.retargetStageIndex(arcBytes, targetIndex);
      if (retargeted) {
        return { bytes: retargeted, retargeted: true };
      }
      this.logger.warn(
        `ISO export: re-indexing "${arcName}" failed; trying a content merge into the slot's own archive.`,
      );

      // Fallback: merge the source content into the slot's own archive.
      const targetOriginal = await this.readExtractedArc(targetArcId);
      if (targetOriginal) {
        const merged = await this.fsaLib.mergeStageContent(targetOriginal, arcBytes);
        if (merged) {
          return { bytes: merged, retargeted: true };
        }
      }

      this.logger.warn(`ISO export: could not prepare "${arcName}"; using it as-is.`);
      return { bytes: arcBytes, retargeted: false };
    } catch (error) {
      this.logger.warn(`ISO export: preparation failed for "${arcName}"`, error);
      return { bytes: arcBytes, retargeted: false };
    }
  }

  /** Reads a stage archive (`bossNNN.arc`) from the extracted game by name. */
  private async readExtractedArc(targetArcId: string): Promise<Uint8Array | null> {
    try {
      const path = await this.opfs.findFileByName(`${targetArcId}.arc`);
      if (!path) {
        return null;
      }
      return await this.opfs.readExtractedFile(path);
    } catch (error) {
      this.logger.warn(`ISO export: failed to read extracted "${targetArcId}.arc"`, error);
      return null;
    }
  }

  /** Hashes the pristine archive from the extracted game (fallback for old stores). */
  private async hashExtractedArc(targetArcId: string): Promise<string | undefined> {
    const bytes = await this.readExtractedArc(targetArcId);
    return bytes ? await sha256Hex(bytes) : undefined;
  }

  /** Reads and parses the FST of the source ISO. */
  private async readFst(iso: File): Promise<{
    fstOffset: number;
    fstSize: number;
    fstRaw: Uint8Array;
    entries: RawEntry[];
    stringTable: Uint8Array;
  }> {
    const header = new DataView(await iso.slice(FST_OFFSET_POS, FST_SIZE_POS + 4).arrayBuffer());
    const fstOffset = header.getUint32(0, false);
    const fstSize = header.getUint32(4, false);
    if (fstOffset <= 0 || fstSize <= 0) {
      throw new Error('Invalid source ISO: FST offset/size could not be resolved.');
    }

    const fstBuffer = await iso.slice(fstOffset, fstOffset + fstSize).arrayBuffer();
    const fstRaw = new Uint8Array(fstBuffer);
    const view = new DataView(fstBuffer);
    const rootCount = view.getUint32(8, false);
    if (rootCount === 0 || rootCount * FST_ENTRY_SIZE > fstSize) {
      throw new Error('Invalid source ISO: FST entry table is corrupt.');
    }

    const entries: RawEntry[] = [];
    for (let i = 0; i < rootCount; i++) {
      const base = i * FST_ENTRY_SIZE;
      entries.push({
        isDirectory: view.getUint8(base) === 0x01,
        nameOffset:
          (view.getUint8(base + 1) << 16) |
          (view.getUint8(base + 2) << 8) |
          view.getUint8(base + 3),
        offset: view.getUint32(base + 4, false),
        size: view.getUint32(base + 8, false),
      });
    }

    // The string table follows the entry table within the FST.
    const stringTable = fstRaw.subarray(rootCount * FST_ENTRY_SIZE);
    return { fstOffset, fstSize, fstRaw, entries, stringTable };
  }

  /** Walks the entry tree, returning every file with its full path + name. */
  private resolveFiles(
    entries: RawEntry[],
    stringTable: Uint8Array,
  ): { entry: RawEntry; entryIndex: number; path: string; name: string }[] {
    const files: { entry: RawEntry; entryIndex: number; path: string; name: string }[] = [];

    const walk = (start: number, end: number, prefix: string): void => {
      let i = start;
      while (i < end) {
        const entry = entries[i];
        const name = this.readString(stringTable, entry.nameOffset);
        if (entry.isDirectory) {
          const childEnd = Math.min(Math.max(entry.size, i + 1), end);
          walk(i + 1, childEnd, prefix ? `${prefix}/${name}` : name);
          i = childEnd;
        } else {
          files.push({ entry, entryIndex: i, path: prefix ? `${prefix}/${name}` : name, name });
          i++;
        }
      }
    };

    walk(1, entries.length, '');
    return files;
  }

  /** Reads a null-terminated UTF-8 string from the FST string table. */
  private readString(bytes: Uint8Array, offset: number): string {
    let end = offset;
    while (end < bytes.length && bytes[end] !== 0x00) {
      end++;
    }
    return new TextDecoder().decode(bytes.subarray(offset, end)) || 'unnamed';
  }
}

/** Rounds a byte length up to the next multiple of {@link FILE_ALIGNMENT}. */
function alignUp(value: number, alignment: number): number {
  const remainder = value % alignment;
  return remainder === 0 ? value : value + (alignment - remainder);
}

/** Narrows a `Uint8Array` to a `BlobPart` for `FileSystemWritableFileStream`. */
function toBlobPart(bytes: Uint8Array): BlobPart {
  return bytes as unknown as BlobPart;
}

/** Adapts the File System Access API's writable stream to {@link IsoWriter}. */
export class FileStreamIsoWriter implements IsoWriter {
  constructor(private readonly stream: FileSystemWritableFileStream) {}

  async size(size: number): Promise<void> {
    // Grow the file to the target length; a no-op if it is already at least
    // that long. Bytes are then written in order over this pre-sized file.
    await this.stream.truncate(size);
  }

  async write(position: number, data: BlobPart): Promise<void> {
    await this.stream.write({ type: 'write', position, data });
  }

  async truncate(size: number): Promise<void> {
    await this.stream.truncate(size);
  }

  async close(): Promise<void> {
    await this.stream.close();
  }

  async abort(): Promise<void> {
    await this.stream.abort().catch(() => undefined);
  }
}

/**
 * An {@link IsoWriter} that collects every chunk in memory and yields a `Blob`.
 * Used as the universal fallback when the File System Access API (and thus
 * `showSaveFilePicker`) is unavailable — e.g. Firefox/Safari. The resulting blob
 * is downloaded through a temporary `<a download>` link, which triggers the
 * browser's standard save dialog.
 */
export class BlobIsoWriter implements IsoWriter {
  private readonly parts: BlobPart[] = [];
  private closed = false;

  async size(): Promise<void> {
    // Nothing to pre-allocate — the blob is sized by the chunks written, which
    // the builder emits contiguously in order.
  }

  async write(_position: number, data: BlobPart): Promise<void> {
    this.parts.push(data);
  }

  async truncate(): Promise<void> {
    // Nothing to do — chunks are written contiguously, so the size is exact.
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async abort(): Promise<void> {
    this.parts.length = 0;
  }

  /** Builds the final blob from the collected chunks (in write order). */
  toBlob(type = 'application/octet-stream'): Blob {
    if (!this.closed) {
      throw new Error('BlobIsoWriter: close() must be called before toBlob().');
    }
    return new Blob(this.parts, { type });
  }
}
