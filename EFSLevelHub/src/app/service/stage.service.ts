import { Injectable, computed, inject, signal } from '@angular/core';
import { StageData } from '../entity/stage.entity';
import { EditorService } from './editor.service';
import { OpfsCacheService } from './opfs-cache.service';
import { FSALibService } from './fsalib.service';
import { LoggingService } from './logging.service';

/** Minimum number of characters required for a stage name. */
export const MIN_STAGE_NAME_LENGTH = 3;

/** Key under which stages are stored in the editor's `userdata.json`. */
const STAGES_KEY = 'stages';

/** Root folder (inside `/editor`) holding default-stage assets. */
const CACHE_ROOT = 'cache';

/** Author credited for the default stages. */
export const DEFAULT_STAGE_AUTHOR = 'Nintendo';

/** Folder under `GC4swords/` that holds the stage archives. */
const BOSS_FOLDER = 'GC4swords/Boss';

/** Matches a default stage archive, e.g. `boss010.arc` (excludes language variants). */
const STAGE_ARCHIVE_PATTERN = /^boss(\d{3})\.arc$/i;

/**
 * The all-zero GUID. Default-stage assets are cached under this folder, and the
 * n-th default stage is assigned the sequential GUID `${BASE}${nn}`.
 */
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';

/** Builds the sequential full GUID for the n-th default stage (1-based). */
export function defaultStageUuid(index: number): string {
  return `00000000-0000-0000-0000-0000000000${index.toString().padStart(2, '0')}`;
}

/** Builds the relative `/editor` path of a default stage's preview image. */
export function stagePreviewPath(id: string): string {
  return `${CACHE_ROOT}/${ZERO_GUID}/map_${id}.png`;
}

/**
 * StageService
 * ------------
 * Owns the stage domain. On ISO import it enumerates the game's default stages
 * (the `bossNNN.arc` maps), hashes the source archive and registers them in
 * `userdata.json` (once). A stage's own map preview PNG is generated lazily,
 * only when the stage is actually opened — the stage list itself shows the
 * shared world map image as a placeholder.
 *
 * Default stages are locked (cannot be changed) and get sequential zero-based
 * GUIDs (`00000000-0000-0000-0000-000000000001`, `...0002`, …).
 */
@Injectable({ providedIn: 'root' })
export class StageService {
  private readonly editor = inject(EditorService);
  private readonly opfs = inject(OpfsCacheService);
  private readonly fsaLib = inject(FSALibService);
  private readonly logger = inject(LoggingService);

  /** User/default stages loaded from the editor store. */
  private readonly stageList = signal<StageData[]>([]);
  /** Whether the stages have been loaded from the editor store yet. */
  private readonly loaded = signal(false);

  /** All known stages. */
  readonly stages = this.stageList.asReadonly();

  /** `true` once {@link load} has completed. */
  readonly isLoaded = this.loaded.asReadonly();

  /** Number of stages that cannot be edited. */
  readonly lockedCount = computed(() => this.stageList().filter((s) => s.locked).length);

  /** Loads persisted stages from the editor's user-data document. */
  async load(): Promise<void> {
    const stored = await this.editor.get<StageData[]>(STAGES_KEY, []);
    this.stageList.set(Array.isArray(stored) ? stored : []);
    this.loaded.set(true);
    this.logger.info(`StageService: loaded ${this.stageList().length} stage(s).`);
  }

  /**
   * Registers the game's default stages (metadata only) if not present yet.
   *
   * @param onProgress Optional callback reporting `(done, total, name)`.
   */
  async registerDefaultStages(
    onProgress?: (done: number, total: number, name: string) => void,
  ): Promise<void> {
    await this.load();

    const definitions = await this.fsaLib.loadStages();
    const archiveIds = await this.listDefaultStageArchives();
    const existing = new Set(this.stageList().map((s) => s.id));
    const pending = archiveIds.filter((id) => definitions[id] && !existing.has(id));

    this.logger.info(
      `StageService: ${archiveIds.length} default archive(s), ${pending.length} to register.`,
    );
    if (pending.length === 0) {
      return;
    }

    const created: StageData[] = [];
    let index = this.stageList().length + 1;

    for (let i = 0; i < pending.length; i++) {
      const id = pending[i];
      const name = definitions[id].Name;
      onProgress?.(i, pending.length, name);

      const bytes = await this.opfs.readExtractedFile(`${BOSS_FOLDER}/${id}.arc`);
      const hash = await this.sha256(bytes);

      created.push({
        id,
        uuid: defaultStageUuid(index),
        name,
        author: DEFAULT_STAGE_AUTHOR,
        mapImage: stagePreviewPath(id),
        hash,
        locked: true,
      });
      index++;
    }

    const next = [...this.stageList(), ...created];
    await this.editor.set(STAGES_KEY, next);
    this.stageList.set(next);
    onProgress?.(pending.length, pending.length, '');
    this.logger.info(`StageService: registered ${created.length} default stage(s).`);
  }

  /**
   * Renders a stage's map preview PNG if it has not been generated yet.
   *
   * Called lazily when a stage is opened, so previews are only produced on
   * demand rather than for every stage up front.
   *
   * @param id Stage archive id, e.g. `boss010`.
   * @returns The preview's relative `/editor` path, or null on failure.
   */
  async ensurePreview(id: string): Promise<string | null> {
    const stage = this.getById(id);
    if (!stage) {
      return null;
    }
    if (await this.editor.hasEditorFile(stage.mapImage)) {
      return stage.mapImage;
    }

    try {
      const bytes = await this.opfs.readExtractedFile(`${BOSS_FOLDER}/${id}.arc`);
      const dataUrl = await this.fsaLib.renderStageMap(bytes);
      await this.editor.writeEditorFile(stage.mapImage, this.dataUrlToBytes(dataUrl));
      this.logger.info(`StageService: generated preview for "${id}".`);
      return stage.mapImage;
    } catch (error) {
      this.logger.error(`StageService: failed to generate preview for "${id}"`, error);
      return null;
    }
  }

  /** Loads a stage by id. */
  getById(id: string): StageData | undefined {
    return this.stageList().find((s) => s.id === id);
  }

  /** Lists the ids of the default stage archives present in OPFS (`bossNNN`). */
  private async listDefaultStageArchives(): Promise<string[]> {
    const names = await this.opfs.listFilesIn(`${BOSS_FOLDER}`);
    const ids = names
      .map((name) => STAGE_ARCHIVE_PATTERN.exec(name)?.[0]?.replace(/\.arc$/i, ''))
      .filter((id): id is string => !!id);
    return ids.sort((a, b) => a.localeCompare(b));
  }

  /** Computes the SHA-256 hex digest of the given bytes. */
  private async sha256(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /** Decodes a `data:...;base64,` URL into raw bytes. */
  private dataUrlToBytes(dataUrl: string): Uint8Array {
    const base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
