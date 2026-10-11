import { Injectable, computed, inject, signal } from '@angular/core';
import { WorldData } from '../entity/editor.entity';
import { EditorService, WORLDMAP_FILE } from './editor.service';
import { LoggingService } from './logging.service';

/** Minimum number of characters required for a world name. */
export const MIN_WORLD_NAME_LENGTH = 3;

/** Author credited for the built-in default world. */
export const DEFAULT_AUTHOR = 'You';

/** Key under which worlds are stored in the editor's `userdata.json`. */
const WORLDS_KEY = 'worlds';

/**
 * The implicit world every editor starts with. It cannot be renamed or
 * deleted, and is always shown first in the My Worlds page.
 */
export const DEFAULT_WORLD: WorldData = {
  id: '__default__',
  uuid: '00000000-0000-0000-0000-000000000000',
  name: 'Default World',
  author: 'Nintendo',
  mapImage: WORLDMAP_FILE,
  stageIds: [],
};

/**
 * WorldService
 * ------------
 * Domain layer over {@link EditorService} for working with worlds. Persists the
 * world list into the editor's generic `userdata.json`, and exposes a reactive
 * list (always prefixed with the immutable {@link DEFAULT_WORLD}), validation
 * and creation helpers used by the My Worlds page.
 */
@Injectable({ providedIn: 'root' })
export class WorldService {
  private readonly editor = inject(EditorService);
  private readonly logger = inject(LoggingService);

  /** User-created worlds (excludes the implicit default world). */
  private readonly userWorlds = signal<WorldData[]>([]);
  /** Whether the worlds have been loaded from the editor store yet. */
  private readonly loaded = signal(false);

  /** Every world, with the immutable default world always first. */
  readonly worlds = computed<WorldData[]>(() => [DEFAULT_WORLD, ...this.userWorlds()]);

  /** `true` once {@link load} has completed. */
  readonly isLoaded = this.loaded.asReadonly();

  /** Loads persisted worlds from the editor's user-data document. */
  async load(): Promise<void> {
    const stored = await this.editor.get<WorldData[]>(WORLDS_KEY, []);
    const worlds = (Array.isArray(stored) ? stored : []).map((world) => ({
      ...world,
      uuid: world.uuid || this.generateUuid(),
    }));
    // Persist back any backfilled ids so they stay stable across sessions.
    if (worlds.some((world, i) => world.uuid !== stored?.[i]?.uuid)) {
      await this.editor.set(WORLDS_KEY, worlds);
    }
    this.userWorlds.set(worlds);
    this.loaded.set(true);
    this.logger.info(`WorldService: loaded ${worlds.length} user world(s).`);
  }

  /**
   * Validates a proposed world name.
   *
   * @returns An error message, or `null` when the name is acceptable.
   */
  validateName(name: string): string | null {
    const trimmed = name.trim();
    if (trimmed.length < MIN_WORLD_NAME_LENGTH) {
      return `Name must be at least ${MIN_WORLD_NAME_LENGTH} characters.`;
    }
    if (this.worlds().some((w) => w.name.toLowerCase() === trimmed.toLowerCase())) {
      return 'A world with that name already exists.';
    }
    return null;
  }

  /**
   * Creates a new world (validating its name) and persists it.
   *
   * @param name Display name for the new world.
   * @throws When the name fails validation.
   */
  async createWorld(name: string, author: string = DEFAULT_AUTHOR): Promise<WorldData> {
    const error = this.validateName(name);
    if (error) {
      throw new Error(error);
    }

    const world: WorldData = {
      id: this.slugify(name),
      uuid: this.generateUuid(),
      name: name.trim(),
      author: author.trim() || DEFAULT_AUTHOR,
      mapImage: WORLDMAP_FILE,
      stageIds: [],
    };

    const next = [...this.userWorlds(), world];
    await this.editor.set(WORLDS_KEY, next);
    this.userWorlds.set(next);

    this.logger.info(`WorldService: created world "${world.name}" (${world.id}).`);
    return world;
  }

  /** Looks up a world by id, including the default world. */
  getById(id: string): WorldData | undefined {
    return this.worlds().find((w) => w.id === id);
  }

  /** Whether the given world is the immutable default world. */
  isDefault(id: string): boolean {
    return id === DEFAULT_WORLD.id;
  }

  /** Turns a display name into a url/file-safe identifier. */
  private slugify(name: string): string {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug || `world-${Date.now()}`;
  }

  /** Generates a fresh unique id for a world. */
  private generateUuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Fallback for environments without crypto.randomUUID.
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  }
}
