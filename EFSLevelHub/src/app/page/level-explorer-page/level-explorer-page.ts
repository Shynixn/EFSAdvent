import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonComponent } from '../../component/button/button.component';
import { LevelCardComponent } from '../../component/level-card/level-card.component';
import { SortDropdownComponent } from '../../component/sort-dropdown/sort-dropdown.component';
import { DEFAULT_SORT, SortState, sortItems } from '../../component/sort-dropdown/sort.util';
import { LEVEL_FALLBACK_PREVIEW, LevelIndexEntry, LevelKind } from '../../entity/level-index.entity';
import { EditorService, WORLDMAP_FILE } from '../../service/editor.service';
import { LevelIndexService } from '../../service/level-index.service';
import { LoggingService } from '../../service/logging.service';

/** Which entries the explorer shows. */
type KindFilter = LevelKind | 'all';

/**
 * LevelExplorerPage
 * -----------------
 * Browsable catalog of **published** stages and worlds.
 *
 * It mirrors My Stages / My Worlds: the same header, sort dropdown, card grid
 * and search patterns. The difference is where the data comes from — the static
 * `/level/searchindex.json` produced at build time (see
 * `scripts/build-level-search-index.mjs`) instead of the user's local store.
 *
 * Cards only need the index entry itself (name/author/kind/date/stage count), so
 * listing costs a single small file fetch; a manifest is fetched only when an
 * entry is opened.
 */
@Component({
  selector: 'app-level-explorer-page',
  imports: [ButtonComponent, LevelCardComponent, SortDropdownComponent],
  templateUrl: './level-explorer-page.html',
  styleUrl: './level-explorer-page.css',
})
export class LevelExplorerPage implements OnInit {
  private readonly levelIndex = inject(LevelIndexService);
  private readonly editor = inject(EditorService);
  private readonly logger = inject(LoggingService);
  private readonly router = inject(Router);

  /** Search box contents. */
  readonly search = signal('');
  /** Sort selection (same dropdown as My Stages / My Worlds). */
  readonly sort = signal<SortState>(DEFAULT_SORT);
  /** Kind filter (all / stages / worlds). */
  readonly kindFilter = signal<KindFilter>('all');

  /** Index load state, exposed for the template. */
  readonly loading = this.levelIndex.loading;
  readonly error = this.levelIndex.error;
  readonly generated = this.levelIndex.generated;

  /** Total published entries (independent of the current filter/query). */
  readonly total = computed(() => this.levelIndex.entries().length);
  /** Published stage count. */
  readonly stageCount = computed(() => this.levelIndex.stages().length);
  /** Published world count. */
  readonly worldCount = computed(() => this.levelIndex.worlds().length);

  /** Entries matching the query + kind filter, in the selected order. */
  readonly results = computed(() =>
    sortItems(this.levelIndex.search(this.search(), this.kindFilter()), this.sort()),
  );

  /** Whether anything matched (drives the empty state). */
  readonly hasResults = computed(() => this.results().length > 0);

  /**
   * Shared preview image for every card: the editor's world map
   * (`/editor/cache/image/worldmap.png`), exactly like My Stages / My Worlds.
   * Falls back to the site's placeholder before the game files are imported.
   */
  readonly previewUrl = signal(LEVEL_FALLBACK_PREVIEW);

  /** Entry currently being packaged/downloaded, or null. */
  readonly downloading = signal<string | null>(null);
  /** One-line feedback (download failure), shown above the grid. */
  readonly downloadError = signal('');

  ngOnInit(): void {
    void this.levelIndex.load();
    void this.loadPreview();
  }

  /** Resolves the world-map preview from OPFS (non-fatal). */
  private async loadPreview(): Promise<void> {
    try {
      const bytes = await this.editor.readEditorFile(WORLDMAP_FILE);
      if (bytes) {
        this.previewUrl.set(URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'image/png' })));
      }
    } catch (error) {
      this.logger.warn('LevelExplorer: world map preview unavailable', error);
    }
  }

  /** Updates the query from the search input. */
  onSearchInput(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  /** Sets the kind filter (all / stages / worlds). */
  setKind(kind: KindFilter): void {
    this.kindFilter.set(kind);
  }

  /** Preview image for an entry (the shared world map). */
  imageFor(_entry: LevelIndexEntry): string {
    return this.previewUrl();
  }

  /**
   * Downloads an entry as a `.fsastage` / `.fsaworld` package.
   *
   * The package is assembled in the browser from the published files under
   * `/level/<guid>/` and saved with a temporary link, so it lands in the user's
   * normal download folder and can be re-imported from My Stages / My Worlds.
   */
  async download(entry: LevelIndexEntry): Promise<void> {
    if (this.downloading()) {
      return;
    }
    this.downloadError.set('');
    this.downloading.set(entry.id);
    try {
      const result = await this.levelIndex.packageFor(entry);
      const url = URL.createObjectURL(
        new Blob([result.bytes as unknown as BlobPart], { type: 'application/zip' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = result.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoke shortly after, so the download has time to start.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed.';
      this.downloadError.set(message);
      this.logger.error(`LevelExplorer: download failed for "${entry.name}"`, error);
    } finally {
      this.downloading.set(null);
    }
  }

  /** Navigates to the local editors. */
  goToLocal(kind: 'stages' | 'worlds'): void {
    void this.router.navigate([kind === 'stages' ? '/my-stages' : '/my-worlds']);
  }
}

