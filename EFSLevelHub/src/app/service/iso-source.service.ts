import { Injectable, inject } from '@angular/core';
import { LoggingService } from './logging.service';

/** Root OPFS folder that holds the persisted source ISO image. */
const ISO_ROOT = 'iso_source';
/** File name of the persisted source ISO inside {@link ISO_ROOT}. */
const ISO_FILE = 'source.iso';

/**
 * IsoSourceService
 * ----------------
 * Persists a copy of the originally-imported GameCube disc image in OPFS so the
 * editor can later rebuild/patch and export a new ISO without asking the user to
 * re-select the file.
 *
 * The ISO is stored as a single file under `/iso_source/source.iso`, outside the
 * `/extracted_game` folder so clearing the extracted cache does not remove it
 * unless explicitly requested.
 */
@Injectable({ providedIn: 'root' })
export class IsoSourceService {
  private readonly logger = inject(LoggingService);

  /** Persists the given ISO file to OPFS (overwriting any previous copy). */
  async save(file: File | Blob): Promise<void> {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(ISO_ROOT, { create: true });
    const handle = await dir.getFileHandle(ISO_FILE, { create: true });
    const writable = await handle.createWritable();
    try {
      await file.stream().pipeTo(writable);
      this.logger.info(`ISO source: saved ${ISO_ROOT}/${ISO_FILE} (${file.size} bytes).`);
    } catch (error) {
      await writable.abort().catch(() => undefined);
      this.logger.error('ISO source: failed to save the source image', error);
      throw error;
    }
  }

  /** Whether a source ISO copy is available. */
  async exists(): Promise<boolean> {
    try {
      const handle = await this.getFileHandle();
      return handle !== null;
    } catch {
      return false;
    }
  }

  /**
   * Returns the persisted source ISO as a `File`, suitable for `.slice()` based
   * streaming without loading the whole image into memory.
   */
  async getFile(): Promise<File | null> {
    const handle = await this.getFileHandle();
    return handle ? handle.getFile() : null;
  }

  /** Removes the persisted source ISO, if present. */
  async clear(): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(ISO_ROOT);
      await dir.removeEntry(ISO_FILE);
      this.logger.info('ISO source: cleared.');
    } catch {
      // Nothing to clear.
    }
  }

  /** Resolves the source ISO file handle, or null when missing. */
  private async getFileHandle(): Promise<FileSystemFileHandle | null> {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(ISO_ROOT);
      return await dir.getFileHandle(ISO_FILE);
    } catch {
      return null;
    }
  }
}
