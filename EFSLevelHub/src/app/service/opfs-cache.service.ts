import { Injectable, inject } from '@angular/core';
import { StorageEstimate } from '../entity/iso.entity';
import { LoggingService } from './logging.service';

/**
 * OpfsCacheService
 * ----------------
 * Manages persistent browser storage using the Origin Private File System (OPFS).
 *
 * All extracted GameCube disc assets are written under a single `/extracted_game`
 * folder. Files are streamed to disk via `createWritable()` so we never have to
 * hold an entire (potentially multi-gigabyte) payload in memory.
 */
@Injectable({ providedIn: 'root' })
export class OpfsCacheService {
  private readonly logger = inject(LoggingService);

  /** Root folder name inside the OPFS origin directory. */
  private static readonly ROOT_FOLDER = 'extracted_game';

  /**
   * Requests durable storage so the browser does not silently evict cached game
   * assets under storage pressure.
   *
   * @returns `true` when the origin is (or already was) marked persistent.
   */
  async ensurePersistence(): Promise<boolean> {
    if (!navigator.storage?.persist) {
      this.logger.warn('OPFS: StorageManager.persist is unavailable — using evictable storage.');
      return false;
    }
    if (await navigator.storage.persisted()) {
      this.logger.info('OPFS: storage already persistent.');
      return true;
    }
    const granted = await navigator.storage.persist();
    this.logger.info(`OPFS: persist() → ${granted}`);
    return granted;
  }

  /**
   * Writes a file into OPFS, creating any missing parent directories.
   *
   * @param path        Path relative to `/extracted_game`, e.g. `sys/main.dol`.
   * @param streamOrBlob Either a `Blob` (sliced directly from the ISO `File`) or a
   *                    `ReadableStream` of bytes to stream to disk.
   */
  async writeExtractedFile(
    path: string,
    streamOrBlob: Blob | ReadableStream<Uint8Array>,
  ): Promise<void> {
    const segments = this.normalizePath(path);
    if (segments.length === 0) {
      return;
    }

    const root = await navigator.storage.getDirectory();
    const gameRoot = await root.getDirectoryHandle(OpfsCacheService.ROOT_FOLDER, { create: true });

    // Resolve (and create) every directory leading up to the file name.
    let dirHandle = gameRoot;
    for (let i = 0; i < segments.length - 1; i++) {
      dirHandle = await dirHandle.getDirectoryHandle(segments[i], {
        create: true,
      });
    }

    const fileName = segments[segments.length - 1];
    const fileHandle = await dirHandle.getFileHandle(fileName, {
      create: true,
    });

    const writable = await fileHandle.createWritable();

    try {
      if (streamOrBlob instanceof Blob) {
        // Blob.slice handles (from the source ISO) stream through without
        // buffering the whole payload into a single ArrayBuffer.
        await streamOrBlob.stream().pipeTo(writable);
      } else {
        await streamOrBlob.pipeTo(writable);
      }
      this.logger.info(`OPFS: wrote ${path}`);
    } catch (error) {
      this.logger.error(`OPFS: failed writing ${path}`, error);
      await writable.abort().catch(() => undefined);
      throw error;
    }
  }

  /**
   * Reports how much storage the origin is using versus the available quota.
   *
   * @returns `{ usedMB, totalMB }` rounded to two decimal places.
   */
  async getStorageEstimate(): Promise<StorageEstimate> {
    if (!navigator.storage?.estimate) {
      this.logger.warn('OPFS: StorageManager.estimate is unavailable.');
      return { usedMB: 0, totalMB: 0 };
    }

    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    this.logger.info(
      `OPFS: storage estimate — used ${this.toMB(usage)} MB / quota ${this.toMB(quota)} MB`,
    );
    return {
      usedMB: this.toMB(usage),
      totalMB: this.toMB(quota),
    };
  }

  /** Removes the `/extracted_game` folder and all of its contents. */
  async clearExtractedGame(): Promise<void> {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(OpfsCacheService.ROOT_FOLDER, {
      recursive: true,
    });
    this.logger.info('OPFS: cleared /extracted_game');
  }

  /**
   * Returns whether the `/extracted_game` folder exists in OPFS. Useful on app
   * startup to detect previously cached content surviving a page reload.
   */
  async hasExtractedGame(): Promise<boolean> {
    const root = await navigator.storage.getDirectory();
    try {
      await root.getDirectoryHandle(OpfsCacheService.ROOT_FOLDER);
      return true;
    } catch {
      return false;
    }
  }

  /** Counts every file currently stored under `/extracted_game`. */
  async countExtractedFiles(): Promise<number> {
    const root = await navigator.storage.getDirectory();
    let gameRoot: FileSystemDirectoryHandle;
    try {
      gameRoot = await root.getDirectoryHandle(OpfsCacheService.ROOT_FOLDER);
    } catch {
      return 0;
    }

    let count = 0;
    const walk = async (dir: FileSystemDirectoryHandle): Promise<void> => {
      for await (const handle of (dir as any).values()) {
        if (handle.kind === 'file') {
          count++;
        } else {
          await walk(handle as FileSystemDirectoryHandle);
        }
      }
    };
    await walk(gameRoot);

    this.logger.info(`OPFS: found ${count} cached file(s) under /extracted_game`);
    return count;
  }

  /** Returns the `/extracted_game` directory handle, creating it if missing. */
  async getGameRootDirectory(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(OpfsCacheService.ROOT_FOLDER, {
      create: true,
    });
  }

  /**
   * Reads a previously extracted file from OPFS as a byte array.
   *
   * @param path Path relative to `/extracted_game`, e.g. `GC4Sword_pal/Boss/boss010.arc`.
   */
  async readExtractedFile(path: string): Promise<Uint8Array> {
    const segments = this.normalizePath(path);
    if (segments.length === 0) {
      throw new Error('Cannot read an empty path.');
    }

    const root = await navigator.storage.getDirectory();
    let dirHandle = await root.getDirectoryHandle(OpfsCacheService.ROOT_FOLDER);

    for (let i = 0; i < segments.length - 1; i++) {
      dirHandle = await dirHandle.getDirectoryHandle(segments[i]);
    }

    const fileHandle = await dirHandle.getFileHandle(segments[segments.length - 1]);
    const file = await fileHandle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  /** Checks whether a specific extracted file exists in OPFS. */
  async extractedFileExists(path: string): Promise<boolean> {
    try {
      await this.readExtractedFile(path);
      return true;
    } catch {
      return false;
    }
  }

  /** Normalizes a path into non-empty, traversal-safe segments. */
  private normalizePath(path: string): string[] {
    return path
      .replace(/\\/g, '/')
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  }

  private toMB(bytes: number): number {
    return Math.round((bytes / (1024 * 1024)) * 100) / 100;
  }
}
