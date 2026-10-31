import { Injectable, computed, inject, signal } from '@angular/core';
import { Index as FlexIndex } from 'flexsearch';
import {
  LEVEL_ROOT,
  LevelIndexEntry,
  LevelKind,
  LevelSearchIndex,
  SEARCH_INDEX_FILE,
  levelFolderUrl,
} from '../entity/level-index.entity';
import { createZip } from './zip.util';
import { LoggingService } from './logging.service';

/** Minimum characters before the FlexSearch index is queried. */
const MIN_QUERY_LENGTH = 2;

/**
 * LevelIndexService
 * -----------------
 * Loads the **published** level index (`/level/searchindex.json`, produced at
 * build time by `scripts/build-level-search-index.mjs`) and exposes the entries
 * for the Level Explorer page.
 *
 * The file carries both the flat `entries` list and a pre-built FlexSearch
 * index per field (`name`, `author`), so the browser only has to `import()` the
 * chunks — no indexing work on page load. A query therefore does not need to
 * download any manifest.
 */
@Injectable({ providedIn: 'root' })
export class LevelIndexService {
  private readonly logger = inject(LoggingService);

  /** Every published entry (stages and worlds). */
  readonly entries = signal<LevelIndexEntry[]>([]);
  /** Whether the index has been loaded (successfully or not). */
  readonly loaded = signal(false);
  /** Whether the index is currently being fetched. */
  readonly loading = signal(false);
  /** Human-readable load error, if any. */
  readonly error = signal('');
  /** Timestamp the index was generated (from the file). */
  readonly generated = signal<string | null>(null);

  /** Name index (prefix matching), or null until loaded. */
  private nameIndex: FlexIndex | null = null;
  /** Author index (prefix matching), or null until loaded. */
  private authorIndex: FlexIndex | null = null;

  /** Published stages only. */
  readonly stages = computed(() => this.entries().filter((entry) => entry.kind === 'stage'));

  /** Published worlds only. */
  readonly worlds = computed(() => this.entries().filter((entry) => entry.kind === 'world'));

  /**
   * Fetches and imports the search index once.
   *
   * A missing/absent file is not an error state the page must handle specially:
   * it simply yields an empty list (the explorer shows an empty-state message).
   */
  async load(): Promise<void> {
    if (this.loaded() || this.loading()) {
      return;
    }
    this.loading.set(true);
    this.error.set('');
    try {
      const url = `${LEVEL_ROOT}/${SEARCH_INDEX_FILE}`;
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) {
        // No published content yet — not an error worth shouting about.
        this.logger.info(`LevelIndex: ${url} not available (${response.status}).`);
        this.entries.set([]);
        this.loaded.set(true);
        return;
      }
      const index = (await response.json()) as LevelSearchIndex;
      const entries = Array.isArray(index.entries) ? index.entries : [];
      this.entries.set(entries);
      this.generated.set(index.generated ?? null);

      this.nameIndex = this.importField(index?.index?.['name']);
      this.authorIndex = this.importField(index?.index?.['author']);
      this.logger.info(`LevelIndex: loaded ${entries.length} published entr(ies) from ${url}.`);
    } catch (error) {
      this.error.set('Could not load the published levels.');
      this.logger.error('LevelIndex: failed to load the search index', error);
    } finally {
      this.loaded.set(true);
      this.loading.set(false);
    }
  }

  /**
   * Imports one field's serialized chunks (`[key, data]` pairs) into an index.
   * Returns null when the chunks are missing/unusable, so the page can fall back
   * to a plain substring match.
   */
  private importField(chunks: unknown): FlexIndex | null {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return null;
    }
    try {
      const index = new FlexIndex({ tokenize: 'forward', resolution: 6, cache: false });
      for (const chunk of chunks) {
        const [key, data] = chunk as [string, string];
        index.import(key, data);
      }
      return index;
    } catch (error) {
      this.logger.warn('LevelIndex: failed to import a search field', error);
      return null;
    }
  }

  /**
   * Searches published entries by name and author.
   *
   * An empty query returns everything. Short queries (< {@link MIN_QUERY_LENGTH})
   * cannot use the tokenized index, so they use a plain case-insensitive
   * substring test instead — that keeps typing feel immediate.
   *
   * @param query   Search text.
   * @param kind    Restrict to stages or worlds (`all` by default).
   * @param sort    Sort order for the results (`name` or `newest`).
   */
  search(
    query: string,
    kind: LevelKind | 'all' = 'all',
    sort: 'name' | 'newest' = 'name',
  ): LevelIndexEntry[] {
    const all = this.entries();
    const byId = new Map(all.map((entry) => [entry.id, entry]));
    const term = query.trim();

    let results: LevelIndexEntry[];
    if (!term) {
      results = all;
    } else if (term.length < MIN_QUERY_LENGTH || !this.nameIndex || !this.authorIndex) {
      const lowered = term.toLowerCase();
      results = all.filter(
        (entry) =>
          entry.name.toLowerCase().includes(lowered) ||
          entry.author.toLowerCase().includes(lowered),
      );
    } else {
      const ids = new Set<string>([
        ...this.nameIndex.search(term).map(String),
        ...this.authorIndex.search(term).map(String),
      ]);
      results = [...ids]
        .map((id) => byId.get(id))
        .filter((entry): entry is LevelIndexEntry => !!entry);
      // Preserve a sensible order for equally-matching entries.
      results = results.filter(
        (entry) =>
          entry.name.toLowerCase().includes(term.toLowerCase()) ||
          entry.author.toLowerCase().includes(term.toLowerCase()),
      );
    }

    if (kind !== 'all') {
      results = results.filter((entry) => entry.kind === kind);
    }

    return this.sortEntries(results, sort);
  }

  /** Sorts entries by name (default) or newest first. */
  sortEntries(entries: LevelIndexEntry[], sort: 'name' | 'newest' = 'name'): LevelIndexEntry[] {
    const copy = [...entries];
    if (sort === 'newest') {
      copy.sort((a, b) => (b.creationDate ?? '').localeCompare(a.creationDate ?? ''));
    } else {
      copy.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    }
    return copy;
  }

  /**
   * Downloads a published entry as a **stage package** (`.fsastage`) or **world
   * package** (`.fsaworld`) — the same ZIP shapes My Stages / My Worlds import,
   * so the downloaded file can be re-imported directly.
   *
   * The files are fetched from the entry's folder in `/level/<guid>/`:
   *  - stage: `stage.arc`  → `stage.arc`
   *  - world: `stages/<n>.json` + `stages/<n>.arc` → `stages/<n>.json` / `.arc`
   *
   * @param entry Entry to download.
   * @returns The package bytes and suggested file name.
   * @throws When the entry's folder is incomplete (e.g. a world slot without
   *         its archive) — the caller reports this to the user.
   */
  async packageFor(entry: LevelIndexEntry): Promise<{ bytes: Uint8Array; fileName: string }> {
    const folder = levelFolderUrl(entry.id);
    const entries: { path: string; data: Uint8Array }[] = [];

    if (entry.kind === 'world') {
      const stageIds = entry.stages ?? [];
      for (let index = 0; index < stageIds.length; index++) {
        // Empty slots (`""`) are skipped, exactly like the world exporter.
        if (!stageIds[index]) {
          continue;
        }
        const [definition, archive] = await Promise.all([
          this.fetchBytes(`${folder}/stages/${index}.json`),
          this.fetchBytes(`${folder}/stages/${index}.arc`),
        ]);
        if (!definition || !archive) {
          throw new Error(`Missing files for stage slot ${index} of "${entry.name}".`);
        }
        entries.push({ path: `stages/${index}.json`, data: definition });
        entries.push({ path: `stages/${index}.arc`, data: archive });
      }
      if (entries.length === 0) {
        throw new Error(`World "${entry.name}" has no downloadable stages.`);
      }
    } else {
      const archive = await this.fetchBytes(`${folder}/stage.arc`);
      if (!archive) {
        throw new Error(`Stage "${entry.name}" has no archive.`);
      }
      entries.push({ path: 'stage.arc', data: archive });
    }

    // The manifest is the entry itself — `entries` (the list) is a superset.
    const manifest = new TextEncoder().encode(
      JSON.stringify({ id: entry.id, name: entry.name, author: entry.author }, null, 2),
    );
    entries.unshift({ path: 'manifest.json', data: manifest });

    const bytes = createZip(entries);
    const base = (entry.name || entry.id).trim().replace(/[^\w.-]+/g, '_') || entry.id;
    const extension = entry.kind === 'world' ? 'fsaworld' : 'fsastage';
    this.logger.info(
      `LevelIndex: packaged ${entry.kind} "${entry.name}" as ${base}.${extension} ` +
        `(${entries.length - 1} file(s), ${bytes.byteLength} byte(s)).`,
    );
    return { bytes, fileName: `${base}.${extension}` };
  }

  /** Fetches a URL as bytes, or null when it is missing/unreadable. */
  private async fetchBytes(url: string): Promise<Uint8Array | null> {
    try {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) {
        this.logger.warn(`LevelIndex: ${url} not available (${response.status}).`);
        return null;
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      this.logger.warn(`LevelIndex: failed to read ${url}`, error);
      return null;
    }
  }
}
