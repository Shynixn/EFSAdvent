import { Injectable, inject, signal } from '@angular/core';
import { WORLD_FILE_VERSION, WorldData, WorldStageRef } from '../entity/editor.entity';
import { EditorService } from './editor.service';
import { LoggingService } from './logging.service';
import {
  CREATION_DATE_EPOCH,
  DEFAULT_STAGE_ARC_ORDER,
  DEFAULT_WORLD_STAGE_COUNT,
  defaultStageUuid,
  formatIsoDate,
} from './stage.service';

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
}
