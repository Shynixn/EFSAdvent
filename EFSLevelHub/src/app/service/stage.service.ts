import { Injectable, inject, signal } from '@angular/core';
import { EditorService } from './editor.service';
import { FSALibService } from './fsalib.service';
import { LoggingService } from './logging.service';
import { OpfsCacheService } from './opfs-cache.service';
import { sha256Hex } from './hash.util';

/** Key under which stage ids are stored in the editor's `userdata.json`. */
const STAGES_KEY = 'stages';

/**
 * Ordered list of default stage archive names, exactly as they appear in the
 * game's `stages.json`. Order is fixed and hard-coded so stage GUIDs are stable
 * across imports.
 *
 * The first {@link DEFAULT_WORLD_STAGE_COUNT} entries are the non-development
 * stages (worlds 1–8, four slots each, minus the development slots) that make
 * up the default world. The remainder are development / test / multiplayer
 * stages: they still get stage files and GUIDs, but are not part of the default
 * world.
 */
export const DEFAULT_STAGE_ARC_ORDER: string[] = [
  // World 0
  'boss010',
  'boss011',
  'boss013',
  // World 1
  'boss020',
  'boss021',
  'boss023',
  // World 2
  'boss030',
  'boss031',
  'boss033',
  // World 3
  'boss040',
  'boss041',
  'boss043',
  // World 4
  'boss050',
  'boss051',
  'boss053',
  // World 5
  'boss060',
  'boss061',
  'boss063',
  // World 6
  'boss070',
  'boss071',
  'boss073',
  // World 7
  'boss080',
  'boss081',
  'boss083',
  // Development stages (worlds 0–7)
  'boss012',
  'boss022',
  'boss032',
  'boss042',
  'boss052',
  'boss062',
  'boss072',
  'boss082',
  // Test / dev / ECTS / E3 stages
  'boss000',
  'boss001',
  'boss002',
  'boss004',
  'boss005',
  'boss006',
  'boss007',
  'boss008',
  'boss009',
  // Boss test stages
  'boss090',
  'boss091',
  'boss092',
  'boss093',
  'boss094',
  'boss095',
  'boss096',
  'boss097',
  // Multiplayer minigames
  'boss200',
  'boss201',
  'boss202',
  'boss203',
  'boss204',
  'boss205',
  'boss206',
  'boss207',
  // Intro / ending helpers
  'boss990',
  'boss991',
  'boss992',
];

/** Number of leading {@link DEFAULT_STAGE_ARC_ORDER} entries in the default world. */
export const DEFAULT_WORLD_STAGE_COUNT = 24;

/** Builds the sequential full GUID for the n-th default stage (1-based). */
export function defaultStageUuid(index: number): string {
  return `00000000-0000-0000-0000-0000000000${index.toString().padStart(2, '0')}`;
}

/** Builds the relative `/editor` path of a stage's definition file. */
export function stageFilePath(uuid: string): string {
  return `stage/${uuid}.json`;
}

/** Builds the relative `/editor` path of a stage's archived source (`<uuid>.arc`). */
export function stageArcFilePath(uuid: string): string {
  return `stage/${uuid}.arc`;
}

/** Author attributed to stages that don't declare one (i.e. the game's own). */
export const DEFAULT_STAGE_AUTHOR = 'Nintendo';

/** A minimal stage definition file persisted under `/editor/stage/<uuid>.json`. */
export interface StageFile {
  id: string;
  name: string;
  /** Author shown in the stage picker; falls back to "Nintendo" when absent. */
  author?: string;
  /**
   * SHA-256 (hex) of the archive copied at import time. Used at export to skip
   * stages that have not been modified (`/editor/stage/<uuid>.arc` unchanged).
   */
  originalHash?: string;
  /**
   * Original map index of the source archive (e.g. 10 for `boss010`). Lets the
   * export skip re-indexing/merging when the stage stays in its own slot.
   */
  originalIndex?: number;
}

/**
 * StageService
 * ------------
 * Owns the stage domain. On ISO import it creates one stage definition file per
 * default stage (`/editor/stage/<uuid>.json`) using a fixed, hard-coded arc
 * order, and records the stage ids in `userdata.json`. Stage GUIDs are
 * sequential and stable (`00000000-0000-0000-0000-000000000001`, `…0002`, …).
 *
 * Each stage's source archive is copied next to its JSON as
 * `/editor/stage/<uuid>.arc`, so a stage is fully self-contained. The archive's
 * original name (`boss010.arc`, …) is kept only in the world file — it is not
 * derived from the GUID and is not stored in the stage file.
 *
 * A stage's map preview PNG is generated lazily, only when the stage is opened.
 */
@Injectable({ providedIn: 'root' })
export class StageService {
  private readonly editor = inject(EditorService);
  private readonly fsaLib = inject(FSALibService);
  private readonly opfs = inject(OpfsCacheService);
  private readonly logger = inject(LoggingService);

  /** Stage definitions loaded from the editor store. */
  private readonly stageList = signal<StageFile[]>([]);

  /** All known stages (id + name). */
  readonly stages = this.stageList.asReadonly();

  /** Loads persisted stages from `/editor/userdata.json`. */
  async load(): Promise<void> {
    const refs = await this.editor.get<{ id: string }[]>(STAGES_KEY, []);
    const stages: StageFile[] = [];
    for (const ref of Array.isArray(refs) ? refs : []) {
      const file = await this.readStageFile(ref.id);
      if (file) {
        stages.push(file);
      }
    }
    this.stageList.set(stages);
    this.logger.info(`StageService: loaded ${stages.length} stage(s).`);
  }

  /** Looks up a single stage by id from the already-loaded list. */
  getById(id: string): StageFile | undefined {
    return this.stageList().find((stage) => stage.id === id);
  }

  /** Human-readable author of a stage, applying the default fallback. */
  authorOf(stage: StageFile | undefined): string {
    return stage?.author?.trim() || DEFAULT_STAGE_AUTHOR;
  }

  /**
   * Creates a stage definition file and copies the source archive for every
   * default stage (once), then records their ids in `userdata.json`.
   *
   * For each stage this writes `/editor/stage/<uuid>.json` and
   * `/editor/stage/<uuid>.arc` (the latter copied from the extracted game).
   *
   * @param onProgress Optional callback reporting `(done, total, name)`.
   * @returns The created/looked-up stage references with their (original) arc
   *          file names, in the fixed order (first
   *          {@link DEFAULT_WORLD_STAGE_COUNT} are the default-world stages).
   */
  async registerDefaultStages(
    onProgress?: (done: number, total: number, name: string) => void,
  ): Promise<{ id: string; arcFileName: string }[]> {
    const definitions = await this.fsaLib.loadStages();
    const definitionsByLower = new Map(
      Object.entries(definitions).map(([key, value]) => [key.toLowerCase(), value]),
    );

    const refs: { id: string; arcFileName: string }[] = [];
    const created: StageFile[] = [];
    const total = DEFAULT_STAGE_ARC_ORDER.length;

    for (let i = 0; i < total; i++) {
      const id = DEFAULT_STAGE_ARC_ORDER[i];
      const uuid = defaultStageUuid(i + 1);
      const definition = definitionsByLower.get(id);
      const name = definition?.Name ?? id;
      onProgress?.(i, total, name);

      // Copy the stage's source archive next to its JSON so the stage is
      // self-contained in the editor store (`/editor/stage/<uuid>.arc`).
      const arcBytes = await this.copyStageArc(id, uuid);

      const file: StageFile = {
        id: uuid,
        name,
        author: DEFAULT_STAGE_AUTHOR,
        originalIndex: Number.parseInt(id.replace(/\D/g, ''), 10),
        // Hash the archive as imported, so export can skip unmodified stages.
        originalHash: arcBytes ? await sha256Hex(arcBytes) : undefined,
      };
      await this.editor.writeEditorFile(
        stageFilePath(uuid),
        new TextEncoder().encode(JSON.stringify(file, null, 2)),
      );

      created.push(file);
      refs.push({ id: uuid, arcFileName: `${id}.arc` });
    }

    // Persist the stage id list in userdata.
    await this.editor.set(
      STAGES_KEY,
      refs.map((r) => ({ id: r.id })),
    );
    this.stageList.set(created);
    onProgress?.(total, total, '');
    this.logger.info(`StageService: created ${refs.length} stage file(s).`);
    return refs;
  }

  /** Reads a stage definition file, or null when missing/invalid. */
  private async readStageFile(id: string): Promise<StageFile | null> {
    try {
      const bytes = await this.editor.readEditorFile(stageFilePath(id));
      if (!bytes) {
        return null;
      }
      return JSON.parse(new TextDecoder().decode(bytes)) as StageFile;
    } catch {
      return null;
    }
  }

  /**
   * Copies a stage's source archive (`<arcId>.arc`) from the extracted game
   * into the editor store at `/editor/stage/<uuid>.arc`.
   *
   * The extracted layout isn't fixed, so the archive is located by name
   * anywhere under `/extracted_game`. Failures are non-fatal (the stage JSON
   * and world file are already usable).
   */
  private async copyStageArc(arcId: string, uuid: string): Promise<Uint8Array | null> {
    try {
      const sourcePath = await this.opfs.findFileByName(`${arcId}.arc`);
      if (!sourcePath) {
        this.logger.warn(`StageService: arc "${arcId}.arc" not found in extracted game.`);
        return null;
      }
      const bytes = await this.opfs.readExtractedFile(sourcePath);
      await this.editor.writeEditorFile(stageArcFilePath(uuid), bytes);
      return bytes;
    } catch (error) {
      this.logger.warn(`StageService: failed to copy arc "${arcId}.arc" (non-fatal)`, error);
      return null;
    }
  }
}
