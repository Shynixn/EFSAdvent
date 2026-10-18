import { Injectable, inject, signal } from '@angular/core';
import { EditorService } from './editor.service';
import { FSALibService } from './fsalib.service';
import { LoggingService } from './logging.service';
import { OpfsCacheService } from './opfs-cache.service';
import { sha256Hex } from './hash.util';
import { createZip } from './zip.util';
import { stageRoomPreviewPath, stageThumbnailPath } from './stage-preview.service';
import { RoomSmartObjects } from '../entity/smartobject.entity';

/** Key under which stage ids are stored in the editor's `userdata.json`. */
const STAGES_KEY = 'stages';

/**
 * Upper bound of cached per-room preview files removed with a stage.
 *
 * A room index is a byte in the map layout (0-127 at most; see
 * `MapLayout.MAX_Rooms`), so this covers every cacheable room. Deleting a
 * missing file is a no-op, so the exact count does not matter.
 */
const MAX_PREVIEW_ROOMS = 128;

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

/**
 * Prefix shared by every built-in (game) stage id.
 *
 * Default stages are seeded with the sequential GUIDs built by
 * {@link defaultStageUuid}, so their ids all start with
 * `00000000-0000-0000-0000-`. They represent the original game stages and must
 * never be deleted — only the user's own (imported/created) stages may be.
 */
export const DEFAULT_STAGE_ID_PREFIX = '00000000-0000-0000-0000-';

/** Whether a stage id belongs to a built-in default stage (not deletable). */
export function isDefaultStageId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(DEFAULT_STAGE_ID_PREFIX);
}

/** Builds the relative `/editor` path of a stage's definition file. */
export function stageFilePath(uuid: string): string {
  return `stage/${uuid}.json`;
}

/** Builds the relative `/editor` path of a stage's archived source (`<uuid>.arc`). */
export function stageArcFilePath(uuid: string): string {
  return `stage/${uuid}.arc`;
}

/**
 * Outcome of {@link StageService.importStageZip}.
 *
 * - `imported`: the package became a stage (new, or replacing an existing one).
 * - `exists`:   the package's id is already used locally; nothing was written.
 *               The caller decides whether to replace it or cancel.
 * - `invalid`:  the file is not a usable stage package.
 */
export type StageImportResult =
  | { status: 'imported'; stage: StageFile; replaced: boolean }
  | { status: 'exists'; existing: StageFile; package: Uint8Array }
  | { status: 'invalid' };

/** Author attributed to stages that don't declare one (i.e. the game's own). */
export const DEFAULT_STAGE_AUTHOR = 'Nintendo';

/** Minimum number of characters required for a stage name. */
export const MIN_STAGE_NAME_LENGTH = 3;

/** Default author for newly created/imported stages. */
export const DEFAULT_STAGE_CREATOR_AUTHOR = 'You';

/** Schema version written to every stage definition file. */
export const STAGE_FILE_VERSION = 1;

/**
 * Base date all imported stages count back from. The first default stage
 * (`0001`, Lake Hylia) is the most recent and lands exactly on this day.
 */
export const CREATION_DATE_EPOCH = '2004-03-18';

/** Formats a `Date` as an ISO day (`yyyy-MM-dd`). */
export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Derives the creation date for the `index`-th (1-based) default stage.
 *
 * Index `1` (Lake Hylia) is the most recent and sits exactly on
 * {@link CREATION_DATE_EPOCH}; each following stage is one day older.
 *
 * @param index 1-based position in {@link DEFAULT_STAGE_ARC_ORDER}.
 */
export function creationDateForStageIndex(index: number): string {
  const base = new Date(`${CREATION_DATE_EPOCH}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - (index - 1));
  return formatIsoDate(base);
}

/** A minimal stage definition file persisted under `/editor/stage/<uuid>.json`. */
export interface StageFile {
  id: string;
  name: string;
  /** Author shown in the stage picker; falls back to "Nintendo" when absent. */
  author?: string;
  /** Schema version of the stage file; always {@link STAGE_FILE_VERSION}. */
  version: number;
  /** Creation date as an ISO day (`yyyy-MM-dd`). */
  creationDate?: string;
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
  /**
   * ISO timestamp (`yyyy-MM-ddTHH:mm:ss.sssZ`) of the last time the stage was
   * saved from the editor (i.e. its archive was written back).
   */
  lastSaved?: string;
  /**
   * Smart objects (decorations) placed per room, keyed by room grid position.
   * Populated only by placing a decoration in the room canvas; never derived
   * from existing tiles. Absent for stages that have no smart objects.
   */
  rooms?: RoomSmartObjects[];
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
  async load(): Promise<void> {    const refs = await this.editor.get<{ id: string }[]>(STAGES_KEY, []);
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

  /**
   * Deletes a stage: removes its definition file and archive, drops it from
   * `userdata.json`, drops its cached previews and refreshes the in-memory
   * list.
   *
   * Worlds are NOT modified here — a world slot that referenced this stage is
   * left pointing at a missing id, which the world page already handles. Callers
   * that open the stage should close its tabs first.
   *
   * Built-in default stages (ids starting with
   * {@link DEFAULT_STAGE_ID_PREFIX}) cannot be deleted.
   *
   * @param id Stage id to delete.
   * @returns `true` when the stage was removed.
   */
  async deleteStage(id: string): Promise<boolean> {
    if (isDefaultStageId(id)) {
      this.logger.warn(`StageService: refusing to delete default stage "${id}".`);
      return false;
    }
    if (!this.getById(id)) {
      this.logger.warn(`StageService: cannot delete unknown stage "${id}".`);
      return false;
    }

    await this.editor.deleteEditorFile(stageFilePath(id));
    await this.editor.deleteEditorFile(stageArcFilePath(id));
    // Drop the cached previews for this stage: the thumbnail plus every room
    // PNG (one per room; removing a missing index is a no-op).
    await this.editor.deleteEditorFile(stageThumbnailPath(id));
    for (let room = 0; room < MAX_PREVIEW_ROOMS; room++) {
      await this.editor.deleteEditorFile(stageRoomPreviewPath(id, room));
    }

    const refs = await this.editor.get<{ id: string; arcFileName?: string }[]>(STAGES_KEY, []);
    await this.editor.set(
      STAGES_KEY,
      (Array.isArray(refs) ? refs : []).filter((ref) => ref?.id !== id),
    );

    this.stageList.set(this.stageList().filter((stage) => stage.id !== id));
    this.logger.info(`StageService: deleted stage "${id}".`);
    return true;
  }

  /** Human-readable author of a stage, applying the default fallback. */
  authorOf(stage: StageFile | undefined): string {
    return stage?.author?.trim() || DEFAULT_STAGE_AUTHOR;
  }

  /**
   * Records that a stage's archive was just saved from the editor, persisting
   * the timestamp to the stage definition file and updating the in-memory list.
   *
   * @param id      Stage id.
   * @param savedAt Moment the archive was written.
   */
  async markSaved(id: string, savedAt: Date): Promise<void> {
    const file = await this.readStageFile(id);
    if (!file) {
      this.logger.warn(`StageService: cannot mark unknown stage "${id}" as saved.`);
      return;
    }
    file.lastSaved = savedAt.toISOString();
    await this.writeStageFile(file);

    this.stageList.update((stages) =>
      stages.map((stage) => (stage.id === id ? { ...stage, lastSaved: file.lastSaved } : stage)),
    );
  }

  /**
   * Reads a stage's definition file (`/editor/stage/<uuid>.json`) and returns
   * its parsed contents, or `null` when the file is missing/invalid.
   *
   * Used by the room editor's System column to show the stage content (merged
   * with unsaved edits).
   *
   * @param id Stage id.
   */
  async getStageFile(id: string): Promise<StageFile | null> {
    return this.readStageFile(id);
  }

  /**
   * Reads a stage's definition file (`/editor/stage/<uuid>.json`) and returns
   * its pretty-printed JSON text, or `null` when the file is missing/invalid.
   *
   * Used by the room editor's System column to show the current stage content.
   *
   * @param id Stage id.
   */
  async getStageJson(id: string): Promise<string | null> {
    const file = await this.readStageFile(id);
    if (!file) {
      return null;
    }
    return JSON.stringify(file, null, 2);
  }

  /**
   * Reads the smart objects (decorations) placed in one room from the stage's
   * definition file, or an empty list when none are recorded.
   *
   * @param id       Stage id.
   * @param roomRow  Room row within the stage's grid.
   * @param roomCol  Room column within the stage's grid.
   */
  async getRoomSmartObjects(
    id: string,
    roomRow: number,
    roomCol: number,
  ): Promise<RoomSmartObjects['smartObjects']> {
    const file = await this.readStageFile(id);
    const room = file?.rooms?.find((entry) => entry.row === roomRow && entry.col === roomCol);
    return room?.smartObjects ?? [];
  }

  /**
   * Reads the full recorded room entry (smart objects + ground) for one room
   * from the stage's definition file, or `null` when the room has no record.
   *
   * @param id       Stage id.
   * @param roomRow  Room row within the stage's grid.
   * @param roomCol  Room column within the stage's grid.
   */
  async getRoomRecord(
    id: string,
    roomRow: number,
    roomCol: number,
  ): Promise<RoomSmartObjects | null> {
    const file = await this.readStageFile(id);
    return file?.rooms?.find((entry) => entry.row === roomRow && entry.col === roomCol) ?? null;
  }

  /**
   * Persists a room's smart objects (decorations) and ground layers into the
   * stage's definition file (`/editor/stage/<uuid>.json`), under the room's grid
   * position in the `rooms` array.
   *
   * When the room has no smart objects and no ground, the room entry is removed
   * entirely (so untouched rooms leave no trace in the JSON).
   *
   * @param id              Stage id.
   * @param roomRow         Room row within the stage's grid.
   * @param roomCol         Room column within the stage's grid.
   * @param smartObjects    The room's placements.
   * @param ground          The room's ground layers (optional).
   */
  async saveRoomSmartObjects(
    id: string,
    roomRow: number,
    roomCol: number,
    smartObjects: RoomSmartObjects['smartObjects'],
    ground: RoomSmartObjects['ground'] = [],
  ): Promise<void> {
    const file = await this.readStageFile(id);
    if (!file) {
      this.logger.warn(`StageService: cannot save smart objects for unknown stage "${id}".`);
      return;
    }

    const rooms = (file.rooms ?? []).filter(
      (room) => !(room.row === roomRow && room.col === roomCol),
    );
    if (smartObjects.length > 0 || (ground && ground.length > 0)) {
      const entry: RoomSmartObjects = { row: roomRow, col: roomCol, smartObjects };
      if (ground && ground.length > 0) {
        entry.ground = ground;
      }
      rooms.push(entry);
    }
    file.rooms = rooms.length > 0 ? rooms : undefined;

    await this.writeStageFile(file);
    this.logger.info(
      `StageService: saved ${smartObjects.length} smart object(s) and ` +
        `${ground?.length ?? 0} ground layer(s) for room (${roomRow},${roomCol}).`,
    );
  }

  /**
   * Creates a new, editable stage and persists it.
   *
   * The stage's archive is seeded from the chosen `templateId` (every stage is
   * based on an existing one). All fields are required.
   *
   * @param name       Display name (trimmed; must be at least
   *                   {@link MIN_STAGE_NAME_LENGTH} characters).
   * @param author     Author shown on the card (trimmed; must not be empty).
   * @param templateId Id of the stage to use as a base template (required).
   * @returns The created stage, or `null` when any field is invalid.
   */
  async createStage(name: string, author: string, templateId: string): Promise<StageFile | null> {
    const trimmed = name.trim();
    if (trimmed.length < MIN_STAGE_NAME_LENGTH) {
      this.logger.warn(`StageService: stage name "${name}" is too short.`);
      return null;
    }

    const trimmedAuthor = author.trim();
    if (!trimmedAuthor) {
      this.logger.warn('StageService: stage author is required.');
      return null;
    }

    const template = this.getById(templateId);
    if (!template) {
      this.logger.warn('StageService: a template stage is required.');
      return null;
    }

    const id = crypto.randomUUID();

    const file: StageFile = {
      id,
      name: trimmed,
      author: trimmedAuthor,
      version: STAGE_FILE_VERSION,
      creationDate: formatIsoDate(new Date()),
      originalIndex: template.originalIndex,
    };

    // Seed the archive from the template stage.
    const bytes = await this.editor.readEditorFile(stageArcFilePath(template.id));
    if (bytes) {
      await this.editor.writeEditorFile(stageArcFilePath(id), bytes);
      file.originalHash = await sha256Hex(bytes);
    } else {
      this.logger.warn(`StageService: template "${template.id}" has no archive to copy.`);
    }

    await this.writeStageFile(file);
    await this.addStageRef(id);
    this.stageList.set([...this.stageList(), file]);
    this.logger.info(`StageService: created stage "${file.name}" (${id}).`);
    return file;
  }

  /**
   * Builds a shareable stage package (`.fsastage`).
   *
   * The package is a ZIP containing exactly two entries:
   *  - `stage.arc` — the stage's archive, byte-for-byte as stored by the editor,
   *  - `manifest.json` — the stage's definition file (name, author, original
   *    index, …), i.e. the JSON persisted at `/editor/stage/<uuid>.json`.
   *
   * It is deliberately the same shape {@link importStageZip} accepts, so an
   * exported stage can be re-imported (as a new stage) without any conversion.
   *
   * @param id Stage to export.
   * @returns The ZIP bytes and the suggested file name, or `null` when the
   *          stage or its archive is missing.
   */
  async exportStagePackage(id: string): Promise<{ bytes: Uint8Array; fileName: string } | null> {
    const file = await this.readStageFile(id);
    if (!file) {
      this.logger.warn(`StageService: cannot export unknown stage "${id}".`);
      return null;
    }
    const arc = await this.editor.readEditorFile(stageArcFilePath(id));
    if (!arc) {
      this.logger.warn(`StageService: stage "${id}" has no archive to export.`);
      return null;
    }

    const manifest = new TextEncoder().encode(
      JSON.stringify({ ...file, arcFile: await this.arcFileNameOf(id) }, null, 2),
    );
    const bytes = createZip([
      { path: 'stage.arc', data: arc },
      { path: 'manifest.json', data: manifest },
    ]);
    const base = (file.name || 'stage').trim().replace(/[^\w.-]+/g, '_') || 'stage';
    this.logger.info(
      `StageService: exported stage "${file.name}" (${id}) as ${base}.fsastage ` +
        `(${bytes.byteLength} byte(s)).`,
    );
    return { bytes, fileName: `${base}.fsastage` };
  }

  /**
   * Imports a stage package (`.fsastage`): a ZIP containing `manifest.json` —
   * the stage definition — and `stage.arc`.
   *
   * The stage keeps the **id recorded in the manifest**, so an exported stage
   * keeps its identity. If that id already exists locally the import is
   * REFUSED with `{ status: 'exists' }` (plus the parsed package), so the caller
   * can ask the user whether to replace the existing stage. Nothing is written
   * unless the caller then passes `replace: true` (or supplies a new id).
   *
   * @param zipBytes Raw bytes of the uploaded package.
   * @param options  `replace` overwrites the stage with the manifest's id;
   *                 `newId` forces a fresh id instead ("import as copy").
   */
  async importStageZip(
    zipBytes: Uint8Array,
    options: { replace?: boolean; newId?: boolean } = {},
  ): Promise<StageImportResult> {
    let entries;
    try {
      entries = await this.fsaLib.unzip(zipBytes);
    } catch (error) {
      this.logger.error('StageService: failed to read stage zip', error);
      return { status: 'invalid' };
    }

    const manifestEntry = entries.find((entry) => /(^|\/)manifest\.json$/i.test(entry.path));
    if (!manifestEntry) {
      this.logger.warn('StageService: stage zip has no manifest.json.');
      return { status: 'invalid' };
    }

    // Prefer the canonical `stage.arc`; fall back to the first .arc entry so
    // packages produced by other tools still import.
    const arcEntry =
      entries.find((entry) => /(^|\/)stage\.arc$/i.test(entry.path)) ??
      entries.find((entry) => /\.arc$/i.test(entry.path));
    if (!arcEntry) {
      this.logger.warn('StageService: stage zip has no .arc file.');
      return { status: 'invalid' };
    }

    const manifest = this.parseManifest(manifestEntry.data);
    // Re-use the id recorded in the manifest, so an exported stage keeps its
    // identity across machines and exports.
    const manifestId = manifest?.id?.trim();
    const existing = this.stageList().find((entry) => entry.id === manifestId);
    // An existing id is a conflict the CALLER resolves (replace or cancel).
    // `newId` explicitly asks for a copy under a fresh id.
    if (manifestId && existing && !options.replace && !options.newId) {
      this.logger.info(
        `StageService: stage id "${manifestId}" already exists — asking whether to replace it.`,
      );
      return { status: 'exists', existing, package: zipBytes };
    }
    const id = manifestId && (!existing || options.replace) ? manifestId : crypto.randomUUID();
    if (manifestId && id !== manifestId) {
      this.logger.warn(
        `StageService: stage id "${manifestId}" already exists — importing as a new stage "${id}".`,
      );
    }

    const file: StageFile = {
      id,
      name: manifest?.name?.trim() || 'Imported Stage',
      author: manifest?.author?.trim() || DEFAULT_STAGE_CREATOR_AUTHOR,
      version: STAGE_FILE_VERSION,
      // Replacing keeps the imported creation date; that is the package's data.
      creationDate: manifest?.creationDate || formatIsoDate(new Date()),
      originalIndex: manifest?.originalIndex,
      originalHash: await sha256Hex(arcEntry.data),
      rooms: manifest?.rooms,
    };

    await this.editor.writeEditorFile(stageArcFilePath(id), arcEntry.data);
    await this.writeStageFile(file);
    if (options.replace && existing) {
      // Overwrite in place: keep the stage's position in the list and keep its
      // registered archive name (it describes where the stage belongs).
      this.stageList.set(this.stageList().map((entry) => (entry.id === id ? file : entry)));
      this.logger.info(`StageService: replaced stage "${file.name}" (${id}).`);
      return { status: 'imported', stage: file, replaced: true };
    }
    // Register the archive's original file name (e.g. `boss010.arc`), so a stage
    // that arrived via import can be exported into an ISO like any other.
    await this.addStageRef(
      id,
      manifest?.arcFile || (arcEntry.path.split('/').pop() ?? `${id}.arc`),
    );
    this.stageList.set([...this.stageList(), file]);
    this.logger.info(`StageService: imported stage "${file.name}" (${id}).`);
    return { status: 'imported', stage: file, replaced: false };
  }

  /** Persists a stage definition file. */
  private async writeStageFile(file: StageFile): Promise<void> {
    await this.editor.writeEditorFile(
      stageFilePath(file.id),
      new TextEncoder().encode(JSON.stringify(file, null, 2)),
    );
  }

  /**
   * Re-reads the stage list from disk.
   *
   * Used after something other than this service wrote stage files (e.g. the
   * world package import, which carries each referenced stage's definition and
   * archive and registers the new ids via {@link addStageRef}).
   */
  async reload(): Promise<void> {
    await this.load();
  }

  /**
   * The archive's original file name (e.g. `boss010.arc`) recorded in
   * `userdata.json` for a stage, or undefined when it is unknown (e.g. a stage
   * created locally, whose archive is named after its uuid).
   */
  private async arcFileNameOf(id: string): Promise<string | undefined> {
    const refs = await this.editor.get<{ id: string; arcFileName?: string }[]>(STAGES_KEY, []);
    return (Array.isArray(refs) ? refs : []).find((ref) => ref?.id === id)?.arcFileName;
  }

  /** Appends a newly created/imported stage id to `userdata.json`. */
  async addStageRef(id: string, arcFileName?: string): Promise<void> {
    const refs = await this.editor.get<{ id: string; arcFileName?: string }[]>(STAGES_KEY, []);
    const entry: { id: string; arcFileName?: string } = { id };
    if (arcFileName) {
      entry.arcFileName = arcFileName;
    }
    const nextRefs = [...(Array.isArray(refs) ? refs : []), entry];
    await this.editor.set(STAGES_KEY, nextRefs);
  }

  /** Parses a package's `manifest.json`, tolerating partial/renamed shapes. */
  private parseManifest(bytes: Uint8Array): {
    id?: string;
    name?: string;
    author?: string;
    creationDate?: string;
    originalIndex?: number;
    originalHash?: string;
    arcFile?: string;
    rooms?: RoomSmartObjects[];
  } | null {
    try {
      const raw = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      const text = (key: string): string | undefined =>
        typeof raw[key] === 'string' ? (raw[key] as string) : undefined;
      return {
        id: text('id'),
        name: text('name'),
        author: text('author'),
        creationDate: text('creationDate'),
        originalIndex:
          typeof raw['originalIndex'] === 'number' ? (raw['originalIndex'] as number) : undefined,
        // A re-imported export carries the stage's smart-object records and the
        // hash of the archive it was exported from. The hash is dropped (the
        // imported archive is re-hashed), but the room records are preserved so
        // the imported stage keeps its placements.
        originalHash: text('originalHash'),
        arcFile: text('arcFile'),
        rooms: Array.isArray(raw['rooms']) ? (raw['rooms'] as RoomSmartObjects[]) : undefined,
      };
    } catch {
      this.logger.warn('StageService: manifest.json is not valid JSON.');
      return null;
    }
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
        version: STAGE_FILE_VERSION,
        // Lake Hylia (index 1) is the most recent; each later stage is older.
        creationDate: creationDateForStageIndex(i + 1),
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
      const file = JSON.parse(new TextDecoder().decode(bytes)) as StageFile;
      // Files written before the version field existed default to v1.
      file.version ??= STAGE_FILE_VERSION;
      return file;
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
