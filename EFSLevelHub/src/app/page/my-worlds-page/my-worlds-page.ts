import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CardComponent } from '../../component/card/card.component';
import { ModalComponent } from '../../component/modal/modal.component';
import { ButtonComponent } from '../../component/button/button.component';
import { SortDropdownComponent } from '../../component/sort-dropdown/sort-dropdown.component';
import { DEFAULT_SORT, SortState, sortItems } from '../../component/sort-dropdown/sort.util';
import { WorldData } from '../../entity/editor.entity';
import { WorldService, MIN_WORLD_NAME_LENGTH, ZERO_GUID } from '../../service/world.service';
import { WorldTabsService } from '../../service/world-tabs.service';
import { EditorService, WORLDMAP_FILE } from '../../service/editor.service';
import { LoggingService } from '../../service/logging.service';

/**
 * MyWorldsPage
 * ------------
 * Lists the worlds stored under `/editor/world`. Opening a world registers a
 * tab and navigates to its page. A leading "+" card creates a new world.
 */
@Component({
  selector: 'app-my-worlds-page',
  imports: [CardComponent, ModalComponent, ButtonComponent, SortDropdownComponent, FormsModule],
  templateUrl: './my-worlds-page.html',
  styleUrl: './my-worlds-page.css',
})
export class MyWorldsPage implements OnInit {
  private readonly worldService = inject(WorldService);
  private readonly tabs = inject(WorldTabsService);
  private readonly editor = inject(EditorService);
  private readonly router = inject(Router);
  private readonly logger = inject(LoggingService);

  /** Every world to render. */
  readonly worlds = this.worldService.worlds;

  /** Current sort selection. */
  readonly sort = signal<SortState>(DEFAULT_SORT);

  /** Worlds in the selected sort order. */
  readonly sortedWorlds = computed(() => sortItems(this.worlds(), this.sort()));

  /** Blob URL of the shared world map image, resolved from OPFS. */
  readonly worldmapUrl = signal<string | null>(null);

  /** Whether the "create world" modal is open. */
  readonly createOpen = signal(false);
  /** New world name entered by the user. */
  readonly newName = signal('');
  /** New world author entered by the user. */
  readonly newAuthor = signal('');
  /** Validation / creation error message. */
  readonly createError = signal('');

  /**
   * Open card context menu: the world it targets plus its position in viewport
   * (client) pixels. `null` when closed.
   */
  readonly worldMenu = signal<{ world: WorldData; x: number; y: number } | null>(null);

  /** World awaiting delete confirmation, or `null` when the dialog is closed. */
  readonly deleteTarget = signal<WorldData | null>(null);
  /** Delete error message, if any. */
  readonly deleteError = signal('');
  /** Whether a delete operation is in flight. */
  readonly deleting = signal(false);

  /** Minimum characters required for a world name (for the hint text). */
  readonly minNameLength = MIN_WORLD_NAME_LENGTH;

  ngOnInit(): void {
    void this.worldService.load();
    void this.loadWorldmap();
  }

  /** Opens the "create world" modal with a clean form. */
  openCreate(): void {
    this.newName.set('');
    this.newAuthor.set('');
    this.createError.set('');
    this.createOpen.set(true);
  }

  /** Closes the "create world" modal. */
  closeCreate(): void {
    this.createOpen.set(false);
  }

  /** Creates a world from the form values and opens it. */
  async createWorld(): Promise<void> {
    if (!this.newName().trim() || !this.newAuthor().trim()) {
      this.createError.set('Name and author are required.');
      return;
    }

    const world = await this.worldService.createWorld(this.newName(), this.newAuthor());
    if (!world) {
      this.createError.set(
        `Enter a name of at least ${MIN_WORLD_NAME_LENGTH} characters and an author.`,
      );
      return;
    }
    this.closeCreate();
    this.openWorld(world);
  }

  /** Opens a world in a new tab and navigates to its page. */
  openWorld(world: WorldData): void {
    this.closeWorldMenu();
    this.tabs.open(world.id);
    void this.router.navigate(['/my-worlds', world.id]);
  }

  /**
   * Opens the card context menu at the pointer position.
   *
   * The position is stored in CLIENT pixels and the menu is rendered `fixed`, so
   * it appears under the cursor regardless of page scroll.
   */
  onWorldContextMenu(event: MouseEvent, world: WorldData): void {
    event.preventDefault();
    event.stopPropagation();
    this.worldMenu.set({ world, x: event.clientX, y: event.clientY });
  }

  /** Closes the card context menu. */
  closeWorldMenu(): void {
    this.worldMenu.set(null);
  }

  /** Whether a world is the built-in default world (it cannot be deleted). */
  isDefaultWorld(world: WorldData): boolean {
    return world.id === ZERO_GUID;
  }

  /** Opens the delete-confirmation dialog for a world (closing the menu first). */
  openDelete(world: WorldData): void {
    this.closeWorldMenu();
    this.deleteError.set('');
    this.deleteTarget.set(world);
  }

  /** Closes the delete-confirmation dialog. */
  closeDelete(): void {
    this.deleteTarget.set(null);
  }

  /**
   * Deletes the world awaiting confirmation.
   *
   * Its open tab is closed first so no page keeps showing a world whose file no
   * longer exists. The default world is refused by {@link WorldService}.
   */
  async confirmDelete(): Promise<void> {
    const world = this.deleteTarget();
    if (!world || this.deleting()) {
      return;
    }
    this.deleting.set(true);
    this.deleteError.set('');
    try {
      const removed = await this.worldService.deleteWorld(world.id);
      if (!removed) {
        this.deleteError.set('The default world cannot be deleted.');
        return;
      }
      this.tabs.close(world.id);
      this.closeDelete();
    } catch (error) {
      this.logger.error('MyWorlds: failed to delete world', error);
      this.deleteError.set('Could not delete the world.');
    } finally {
      this.deleting.set(false);
    }
  }

  /** Loads the shared world map image from OPFS as a blob URL (non-fatal). */
  private async loadWorldmap(): Promise<void> {
    try {
      const bytes = await this.editor.readEditorFile(WORLDMAP_FILE);
      if (!bytes) {
        this.logger.warn('MyWorlds: world map image not found yet.');
        return;
      }
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'image/png' });
      this.worldmapUrl.set(URL.createObjectURL(blob));
    } catch (error) {
      this.logger.error('MyWorlds: failed to load world map image', error);
    }
  }
}
