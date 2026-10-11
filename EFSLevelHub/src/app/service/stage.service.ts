import { Injectable, inject, signal } from '@angular/core';
import { EditorService } from './editor.service';
import { FSALibService } from './fsalib.service';
import { LoggingService } from './logging.service';

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

/** A minimal stage definition file persisted under `/editor/stage/<uuid>.json`. */
export interface StageFile {
  id: string;
  name: string;
}

/**
 * StageService
 * ------------
 * Owns the stage domain. On ISO import it creates one stage definition file per
 * default stage (`/editor/stage/<uuid>.json`) using a fixed, hard-coded arc
 * order, and records the stage ids in `userdata.json`. Stage GUIDs are
 * sequential and stable (`00000000-0000-0000-0000-000000000001`, `…0002`, …).
 *
 * A stage's map preview PNG is generated lazily, only when the stage is opened.
 */
@Injectable({ providedIn: 'root' })
export class StageService {
  private readonly editor = inject(EditorService);
  private readonly fsaLib = inject(FSALibService);
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

  /**
   * Creates a stage definition file for every default stage (once) and records
   * their ids in `userdata.json`.
   *
   * @param onProgress Optional callback reporting `(done, total, name)`.
   * @returns The created/looked-up stage references with their arc file names,
   *          in the fixed order (first {@link DEFAULT_WORLD_STAGE_COUNT} are the
   *          default-world stages).
   */
  async registerDefaultStages(
    onProgress?: (done: number, total: number, name: string) => void,
  ): Promise<{ id: string; arcFileName: string }[]> {
    const definitions = await this.fsaLib.loadStages();
    const definitionsByLower = new Map(
      Object.entries(definitions).map(([key, value]) => [key.toLowerCase(), value]),
    );

    const refs: { id: string; arcFileName: string }[] = [];
    const total = DEFAULT_STAGE_ARC_ORDER.length;

    for (let i = 0; i < total; i++) {
      const id = DEFAULT_STAGE_ARC_ORDER[i];
      const uuid = defaultStageUuid(i + 1);
      const definition = definitionsByLower.get(id);
      const name = definition?.Name ?? id;
      onProgress?.(i, total, name);

      const file: StageFile = { id: uuid, name };
      await this.editor.writeEditorFile(
        stageFilePath(uuid),
        new TextEncoder().encode(JSON.stringify(file, null, 2)),
      );

      refs.push({ id: uuid, arcFileName: `${id}.arc` });
    }

    // Persist the stage id list in userdata.
    await this.editor.set(
      STAGES_KEY,
      refs.map((r) => ({ id: r.id })),
    );
    this.stageList.set(refs.map((r, i) => ({ id: r.id, name: '' })));
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
}
