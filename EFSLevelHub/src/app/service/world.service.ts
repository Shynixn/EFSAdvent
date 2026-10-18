import { Injectable, inject, signal } from '@angular/core';
import { WORLD_FILE_VERSION, WorldData, WorldStageRef } from '../entity/editor.entity';
import { EditorService } from './editor.service';
import { LoggingService } from './logging.service';
import { StageService } from './stage.service';
import {
  CREATION_DATE_EPOCH,
  DEFAULT_STAGE_ARC_ORDER,
  DEFAULT_WORLD_STAGE_COUNT,
  StageFile,
  STAGE_FILE_VERSION,
  defaultStageUuid,
  formatIsoDate,
  stageArcFilePath,
  stageFilePath,
} from './stage.service';
import { createZip } from './zip.util';

/** Minimum number of characters required for a world name. */
export const MIN_WORLD_NAME_LENGTH = 3;

/** Key under which world ids are stored in the editor's `userdata.json`. */
const WORLDS_KEY = 'worlds';

/** The all-zero GUID used for the built-in default world. */
export const ZERO_GUID = '00000000-0000-0000-0000-000000000000';

/** Name of the built-in default world. */
export const DEFAULT_WORLD_NAME = 'Default World';

/** Builds the relative `/editor` path of a world definition file. */
export function worldFilePath(uuid: string): string {
  return `world/${uuid}.json`;
}

/**
 * A world package's stage files, ready to be re-applied to a conflicted import.
 * Grouped so a "replace existing world?" confirmation does not need the ZIP again.
 */
export interface WorldPackageStages {
  manifest: Uint8Array;
  stages: { index: number; definition: Uint8Array; archive: Uint8Array }[];
}

/**
 * Outcome of {@link WorldService.importWorldPackage}.
 *
 * - `imported`: the package became a world (new, or replacing an existing one).
 * - `exists`:   the world's id is already used locally; nothing was written.
 * - `invalid`:  the file is not a usable world package.
 */
export type WorldImportResult =
  | { status: 'imported'; world: WorldData; importedStageIds: string[]; replaced: boolean }
  | { status: 'exists'; existing: WorldData; package: WorldPackageStages }
  | { status: 'invalid' };

/**
 * WorldService
 * ------------
 * Owns the world domain. Each world is persisted as `/editor/world/<uuid>.json`
 * and its id is recorded in `userdata.json`. The built-in default world uses the
 * all-zero GUID and is seeded on ISO import.
 */
@Injectable({ providedIn: 'root' })
export class WorldService {
  private readonly editor = inject(EditorService);
  private readonly logger = inject(LoggingService);
  private readonly stageService = inject(StageService);

  /** Worlds loaded from disk. */
  private readonly worldList = signal<WorldData[]>([]);

  /** All worlds. */
  readonly worlds = this.worldList.asReadonly();

  /** Loads all worlds referenced by `userdata.json`. */
  async load(): Promise<void> {
    const refs = await this.editor.get<{ id: string }[]>(WORLDS_KEY, []);
    const worlds: WorldData[] = [];
    for (const ref of Array.isArray(refs) ? refs : []) {
      const world = await this.readWorldFile(ref.id);
      if (world) {
        worlds.push(world);
      }
    }
    this.worldList.set(worlds);
    this.logger.info(`WorldService: loaded ${worlds.length} world(s).`);
  }

  /**
   * Writes the built-in default world file (`/editor/world/<zero-guid>.json`)
   * and records its id in `userdata.json`.
   *
   * @param stages The stages (with their arc file names) that belong to it.
   */
  async seedDefaultWorld(stages: WorldStageRef[]): Promise<void> {
    const world: WorldData = {
      id: ZERO_GUID,
      name: DEFAULT_WORLD_NAME,
      author: 'Nintendo',
      stages,
      version: WORLD_FILE_VERSION,
      creationDate: CREATION_DATE_EPOCH,
    };

    await this.writeWorldFile(world);
    await this.editor.set(WORLDS_KEY, [{ id: ZERO_GUID }]);
    this.worldList.set([world]);
    this.logger.info(`WorldService: seeded default world with ${stages.length} stage(s).`);
  }

  /** Looks up a world by id. */
  getById(id: string): WorldData | undefined {
    return this.worldList().find((w) => w.id === id);
  }

  /**
   * Deletes a world: removes its definition file, drops it from `userdata.json`
   * and refreshes the in-memory list.
   *
   * The built-in default world (`{@link ZERO_GUID}`) cannot be deleted.
   *
   * @param id World id to delete.
   * @returns `true` when the world was removed.
   */
  async deleteWorld(id: string): Promise<boolean> {
    if (id === ZERO_GUID) {
      this.logger.warn('WorldService: refusing to delete the default world.');
      return false;
    }

    await this.editor.deleteEditorFile(worldFilePath(id));

    const refs = await this.editor.get<{ id: string }[]>(WORLDS_KEY, []);
    const nextRefs = (Array.isArray(refs) ? refs : []).filter((r) => r.id !== id);
    await this.editor.set(WORLDS_KEY, nextRefs);

    this.worldList.set(this.worldList().filter((w) => w.id !== id));
    this.logger.info(`WorldService: deleted world "${id}".`);
    return true;
  }

  /**
   * Creates a new world seeded with every default stage and persists it.
   *
   * The new world gets the same stage slots as the default world: slot `i`
   * references `defaultStageUuid(i + 1)` and targets `bossNNN.arc` from
   * {@link DEFAULT_STAGE_ARC_ORDER}. Each slot can then be re-pointed at a
   * different stage via the stage picker.
   *
   * @param name   Display name (trimmed; must be at least
   *               {@link MIN_WORLD_NAME_LENGTH} characters).
   * @param author Author shown on the card (trimmed; must not be empty).
   * @returns The created world, or `null` when the name or author is invalid.
   */
  async createWorld(name: string, author: string): Promise<WorldData | null> {
    const trimmed = name.trim();
    if (trimmed.length < MIN_WORLD_NAME_LENGTH) {
      this.logger.warn(`WorldService: world name "${name}" is too short.`);
      return null;
    }

    const trimmedAuthor = author.trim();
    if (!trimmedAuthor) {
      this.logger.warn('WorldService: world author is required.');
      return null;
    }

    const world: WorldData = {
      id: crypto.randomUUID(),
      name: trimmed,
      author: trimmedAuthor,
      stages: this.buildDefaultStageRefs(),
      version: WORLD_FILE_VERSION,
      creationDate: formatIsoDate(new Date()),
    };

    await this.writeWorldFile(world);

    // Record the new id in userdata and refresh the in-memory list.
    const refs = await this.editor.get<{ id: string }[]>(WORLDS_KEY, []);
    const nextRefs = [...(Array.isArray(refs) ? refs : []), { id: world.id }];
    await this.editor.set(WORLDS_KEY, nextRefs);

    this.worldList.set([...this.worldList(), world]);
    this.logger.info(`WorldService: created world "${world.name}" (${world.id}).`);
    return world;
  }

  /**
   * Builds the default stage references (one per slot) for a new world: slot `i`
   * points at `defaultStageUuid(i + 1)` and targets `bossNNN.arc`.
   */
  private buildDefaultStageRefs(): WorldStageRef[] {
    const refs: WorldStageRef[] = [];
    for (let i = 0; i < DEFAULT_WORLD_STAGE_COUNT; i++) {
      const arcId = DEFAULT_STAGE_ARC_ORDER[i];
      refs.push({ id: defaultStageUuid(i + 1), arcFileName: arcId ? `${arcId}.arc` : '' });
    }
    return refs;
  }

  /**
   * Replaces the stage referenced by a world at the given slot index and
   * persists the world file plus the in-memory world list.
   *
   * @param worldId World to update.
   * @param index   Zero-based slot in `world.stages` (matches the map marker).
   * @param stage   New stage reference (`{ id, arcFileName }`); pass `null` to
   *                clear the slot.
   * @returns The updated world, or `undefined` when the world/slot is unknown.
   */
  async setWorldStage(
    worldId: string,
    index: number,
    stage: WorldStageRef | null,
  ): Promise<WorldData | undefined> {
    const world = this.getById(worldId);
    if (!world || index < 0 || index >= world.stages.length) {
      return undefined;
    }

    const stages = world.stages.slice();
    stages[index] = stage ?? { id: '', arcFileName: '' };
    const updated: WorldData = { ...world, stages };

    await this.writeWorldFile(updated);
    this.worldList.set(this.worldList().map((w) => (w.id === worldId ? updated : w)));
    this.logger.info(
      `WorldService: world "${worldId}" slot ${index} → stage "${stage?.id ?? '(cleared)'}".`,
    );
    return updated;
  }

  /** Whether the given id is the built-in default world. */
  isDefault(id: string): boolean {
    return id === ZERO_GUID;
  }

  /** Writes a world definition file. */
  private async writeWorldFile(world: WorldData): Promise<void> {
    await this.editor.writeEditorFile(
      worldFilePath(world.id),
      new TextEncoder().encode(JSON.stringify(world, null, 2)),
    );
  }

  /** Reads a world definition file, or null when missing/invalid. */
  private async readWorldFile(id: string): Promise<WorldData | null> {
    try {
      const bytes = await this.editor.readEditorFile(worldFilePath(id));
      if (!bytes) {
        return null;
      }
      const world = JSON.parse(new TextDecoder().decode(bytes)) as WorldData;
      // Files written before the version field existed default to v1.
      world.version ??= WORLD_FILE_VERSION;
      return world;
    } catch {
      return null;
    }
  }

  // --- Package export / import (.fsaworld) --------------------------------

  /**
   * Builds a shareable world package (`.fsaworld`).
   *
   * The package is a ZIP containing:
   *  - `manifest.json` — the world definition (id, name, author, stage slots),
   *  - `stages/<index>.json` — each referenced stage's definition file, and
   *  - `stages/<index>.arc` — each referenced stage's archive,
   *
   * where `<index>` is the stage's **slot** in the world (0-based), so the slot
   * order is preserved even when the referenced stage ids are non-sequential.
   * Slots that reference a missing stage are skipped (their arc name is kept on
   * the world entry so the slot still works for stages the recipient has).
   *
   * @param worldId World to export.
   * @returns The ZIP bytes and the suggested file name, or `null` when the world
   *          is unknown.
   */
  async exportWorldPackage(
    worldId: string,
  ): Promise<{ bytes: Uint8Array; fileName: string } | null> {
    const world = await this.readWorldFile(worldId);
    if (!world) {
      this.logger.warn(`WorldService: cannot export unknown world "${worldId}".`);
      return null;
    }

    const encoder = new TextEncoder();
    // Explicit entry type: `readEditorFile` returns `Uint8Array<ArrayBufferLike>`,
    // which is not assignable to the literal's inferred `Uint8Array<ArrayBuffer>`.
    const entries: { path: string; data: Uint8Array }[] = [
      { path: 'manifest.json', data: encoder.encode(JSON.stringify(world, null, 2)) },
    ];

    for (let index = 0; index < world.stages.length; index++) {
      const stageId = world.stages[index]?.id;
      if (!stageId) {
        continue;
      }
      const definition = await this.editor.readEditorFile(stageFilePath(stageId));
      const archive = await this.editor.readEditorFile(stageArcFilePath(stageId));
      if (!definition || !archive) {
        this.logger.warn(
          `WorldService: slot ${index} stage "${stageId}" has no ${definition ? 'archive' : 'definition'} — skipped in the package.`,
        );
        continue;
      }
      entries.push({ path: `stages/${index}.json`, data: definition });
      entries.push({ path: `stages/${index}.arc`, data: archive });
    }

    if (entries.length === 1) {
      this.logger.warn(`WorldService: world "${worldId}" has no exportable stages.`);
    }

    const bytes = createZip(entries);
    const base = (world.name || 'world').trim().replace(/[^\w.-]+/g, '_') || 'world';
    this.logger.info(
      `WorldService: exported world "${world.name}" as ${base}.fsaworld ` +
        `(${entries.length - 1} stage file(s), ${bytes.byteLength} byte(s)).`,
    );
    return { bytes, fileName: `${base}.fsaworld` };
  }

  /**
   * Imports a world package (`.fsaworld`).
   *
   * Stages are imported **only when their id is not present locally yet**:
   * each `stages/<index>.json` carries the stage's own id, and an existing stage
   * with that id is left untouched (so a shared world never overwrites local
   * edits). Stage archives are written next to their definitions, so the world
   * can be exported to an ISO or re-exported as a package.
   *
   * If the world's own id already exists locally, nothing is written and the
   * result is `{ status: 'exists' }` (plus the parsed package), so the caller can
   * ask the user whether to replace the existing world or cancel. Pass
   * `{ replace: true }` to overwrite it, or `{ newId: true }` to import a copy
   * under a fresh id.
   *
   * @param worldJson      Raw `manifest.json` bytes.
   * @param stageEntries   The package's stage files, keyed by world slot index.
   * @param knownStageIds  Stage ids already present locally (never overwritten).
   * @param options        `replace` overwrites the world with the manifest's id;
   *                       `newId` forces a fresh world id (import as copy).
   */
  async importWorldPackage(
    worldJson: Uint8Array,
    stageEntries: { index: number; definition: Uint8Array; archive: Uint8Array }[],
    knownStageIds: ReadonlySet<string>,
    options: { replace?: boolean; newId?: boolean } = {},
  ): Promise<WorldImportResult> {
    let manifest: WorldData;
    try {
      manifest = JSON.parse(new TextDecoder().decode(worldJson)) as WorldData;
    } catch {
      this.logger.warn('WorldService: world manifest is not valid JSON.');
      return { status: 'invalid' };
    }
    if (!manifest || !Array.isArray(manifest.stages)) {
      this.logger.warn('WorldService: world manifest has no stage list.');
      return { status: 'invalid' };
    }

    const manifestId = manifest.id?.trim();
    const existing = this.worldList().find((entry) => entry.id === manifestId);
    // An existing id is a conflict the CALLER resolves (replace or cancel).
    if (manifestId && existing && !options.replace && !options.newId) {
      this.logger.info(
        `WorldService: world id "${manifestId}" already exists — asking whether to replace it.`,
      );
      return { status: 'exists', existing, package: { manifest: worldJson, stages: stageEntries } };
    }
    const id = manifestId && (!existing || options.replace) ? manifestId : crypto.randomUUID();

    // Import each stage that is not already present locally.
    const importedStageIds: string[] = [];
    for (const entry of stageEntries) {
      let file: StageFile;
      try {
        file = JSON.parse(new TextDecoder().decode(entry.definition)) as StageFile;
      } catch {
        this.logger.warn(`WorldService: stage slot ${entry.index} has an invalid definition.`);
        continue;
      }
      const stageId = file?.id;
      if (!stageId || knownStageIds.has(stageId) || importedStageIds.includes(stageId)) {
        continue;
      }
      const stage: StageFile = {
        ...file,
        version: file.version ?? STAGE_FILE_VERSION,
        creationDate: file.creationDate ?? formatIsoDate(new Date()),
      };
      await this.editor.writeEditorFile(
        stageFilePath(stageId),
        new TextEncoder().encode(JSON.stringify(stage, null, 2)),
      );
      await this.editor.writeEditorFile(stageArcFilePath(stageId), entry.archive);
      // Register the stage so it shows up on My Stages (and can be re-exported
      // later). Its original archive name comes from the world slot it fills.
      const slotRef = manifest.stages[entry.index];
      await this.stageService.addStageRef(stageId, slotRef?.arcFileName);
      importedStageIds.push(stageId);
    }

    const world: WorldData = {
      ...manifest,
      id,
      name: manifest.name?.trim() || 'Imported World',
      author: manifest.author?.trim() || 'Unknown',
      version: WORLD_FILE_VERSION,
      creationDate: formatIsoDate(new Date()),
      stages: manifest.stages.map((stage) => ({
        id: stage?.id ?? '',
        arcFileName: stage?.arcFileName ?? '',
      })),
    };

    await this.writeWorldFile(world);
    if (options.replace && existing) {
      // Overwrite in place: keep the world's position in the list.
      this.worldList.set(this.worldList().map((entry) => (entry.id === id ? world : entry)));
      this.logger.info(`WorldService: replaced world "${world.name}" (${id}).`);
    } else {
      const refs = await this.editor.get<{ id: string }[]>(WORLDS_KEY, []);
      await this.editor.set(WORLDS_KEY, [...(Array.isArray(refs) ? refs : []), { id: world.id }]);
      this.worldList.set([...this.worldList(), world]);
    }
    // Pick up the newly written stage definitions in the shared stage list.
    await this.stageService.reload();
    this.logger.info(
      `WorldService: imported world "${world.name}" (${world.id}) with ` +
        `${importedStageIds.length} new stage(s).`,
    );
    return { status: 'imported', world, importedStageIds, replaced: !!options.replace && !!existing };
  }
}
