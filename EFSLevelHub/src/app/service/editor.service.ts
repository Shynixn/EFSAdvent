import { Injectable, inject } from '@angular/core';
import { LoggingService } from './logging.service';

/** Root folder (inside the OPFS origin directory) that holds editor-generated files. */
const EDITOR_ROOT = 'editor';

/** File name of the persisted editor user-data document. */
const USERDATA_FILE = 'userdata.json';

/** Path (relative to `/editor`) of the shared world map image. */
export const WORLDMAP_FILE = 'cache/image/worldmap.png';

/** Current schema version of the persisted user-data document. */
const USERDATA_VERSION = 1;

/**
 * Root document persisted to `/editor/userdata.json`.
 *
 * This is a generic, untyped bag: it holds every piece of editor user data.
 * Domain services (e.g. the world service) are responsible for the meaning of
 * the individual fields.
 */
export interface UserData {
  version: number;
  [key: string]: unknown;
}

/**
 * EditorService
 * -------------
 * Generic persistence layer for editor data. Reads and writes arbitrary files
 * under the OPFS `/editor` folder and exposes a JSON document (`userdata.json`)
 * that any feature can store its state in.
 *
 * It intentionally knows nothing about specific domains (worlds, stages, …) —
 * those live in dedicated services built on top of this one.
 */
@Injectable({ providedIn: 'root' })
export class EditorService {
  private readonly logger = inject(LoggingService);

  private userData: UserData | null = null;

  /**
   * Loads `/editor/userdata.json` (once) and returns it. Missing or malformed
   * files yield a fresh, empty document.
   */
  async loadUserData(): Promise<UserData> {
    if (this.userData) {
      return this.userData;
    }

    let data: UserData = { version: USERDATA_VERSION };
    try {
      const bytes = await this.readEditorFile(USERDATA_FILE);
      if (bytes && bytes.byteLength > 0) {
        data = JSON.parse(new TextDecoder().decode(bytes)) as UserData;
        data.version ??= USERDATA_VERSION;
        this.logger.info('Editor: loaded userdata.json.');
      } else {
        this.logger.info('Editor: no userdata.json found — starting empty.');
      }
    } catch (error) {
      this.logger.error('Editor: failed to load userdata.json — starting empty', error);
    }

    this.userData = data;
    return data;
  }

  /** Persists the given user-data document to `/editor/userdata.json`. */
  async saveUserData(data: UserData): Promise<void> {
    this.userData = data;
    const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
    await this.writeEditorFile(USERDATA_FILE, bytes);
    this.logger.info('Editor: saved userdata.json.');
  }

  /**
   * Reads a key from the user-data document, parsing it as type `T`.
   *
   * @param key          Top-level key to read.
   * @param fallback     Value returned when the key is missing.
   */
  async get<T>(key: string, fallback: T): Promise<T> {
    const data = await this.loadUserData();
    return (data[key] as T) ?? fallback;
  }

  /** Writes a key into the user-data document and persists it. */
  async set<T>(key: string, value: T): Promise<void> {
    const data = await this.loadUserData();
    data[key] = value;
    await this.saveUserData(data);
  }

  /**
   * Writes a file under `/editor/`, creating parent directories as needed.
   *
   * @param relativePath Path relative to `/editor`, e.g. `cache/image/worldmap.png`.
   * @param bytes        Raw file contents.
   */
  async writeEditorFile(
    relativePath: string,
    bytes: Uint8Array | Blob | ReadableStream<Uint8Array>,
  ): Promise<void> {
    const segments = this.normalize(relativePath);
    if (segments.length === 0) {
      return;
    }

    const root = await navigator.storage.getDirectory();
    let dir = await root.getDirectoryHandle(EDITOR_ROOT, { create: true });
    for (let i = 0; i < segments.length - 1; i++) {
      dir = await dir.getDirectoryHandle(segments[i], { create: true });
    }

    const fileHandle = await dir.getFileHandle(segments[segments.length - 1], { create: true });
    const writable = await fileHandle.createWritable();
    try {
      if (bytes instanceof Uint8Array) {
        await writable.write(bytes as unknown as BufferSource);
        // `write()` buffers; the stream must be closed to commit to disk.
        // (`pipeTo` below closes the destination itself.)
        await writable.close();
      } else if (bytes instanceof Blob) {
        await bytes.stream().pipeTo(writable);
      } else {
        await bytes.pipeTo(writable);
      }
      this.logger.info(`Editor: wrote /${EDITOR_ROOT}/${relativePath}`);
    } catch (error) {
      await writable.abort().catch(() => undefined);
      this.logger.error(`Editor: failed writing /${EDITOR_ROOT}/${relativePath}`, error);
      throw error;
    }
  }

  /** Reads a file from `/editor/`, or null when it does not exist. */
  async readEditorFile(relativePath: string): Promise<Uint8Array | null> {
    const segments = this.normalize(relativePath);
    if (segments.length === 0) {
      return null;
    }

    try {
      const root = await navigator.storage.getDirectory();
      let dir = await root.getDirectoryHandle(EDITOR_ROOT);
      for (let i = 0; i < segments.length - 1; i++) {
        dir = await dir.getDirectoryHandle(segments[i]);
      }
      const fileHandle = await dir.getFileHandle(segments[segments.length - 1]);
      const file = await fileHandle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      return null;
    }
  }

  /** Whether the world map image (`/{@link WORLDMAP_FILE}`) already exists. */
  async hasWorldmap(): Promise<boolean> {
    return this.hasEditorFile(WORLDMAP_FILE);
  }

  /**
   * Whether a file exists under `/editor`.
   *
   * Uses `getFileHandle` (no byte read) so existence checks are cheap.
   *
   * @param relativePath Path relative to `/editor`, e.g. `cache/.../map_boss010.png`.
   */
  async hasEditorFile(relativePath: string): Promise<boolean> {
    const segments = this.normalize(relativePath);
    if (segments.length === 0) {
      return false;
    }

    try {
      const root = await navigator.storage.getDirectory();
      let dir = await root.getDirectoryHandle(EDITOR_ROOT);
      for (let i = 0; i < segments.length - 1; i++) {
        dir = await dir.getDirectoryHandle(segments[i]);
      }
      await dir.getFileHandle(segments[segments.length - 1]);
      return true;
    } catch {
      return false;
    }
  }

  /** Normalizes a path into non-empty, traversal-safe segments. */
  private normalize(path: string): string[] {
    return path
      .replace(/\\/g, '/')
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  }
}
