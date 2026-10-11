import { Component, OnInit, inject, signal } from '@angular/core';
import { ModalComponent } from '../../component/modal/modal.component';
import { WorldData } from '../../entity/editor.entity';
import { DEFAULT_WORLD, MIN_WORLD_NAME_LENGTH, WorldService } from '../../service/world.service';
import { EditorService, WORLDMAP_FILE } from '../../service/editor.service';
import { LoggingService } from '../../service/logging.service';

/**
 * MyWorldsPage
 * ------------
 * Lists the user's worlds. Always shows the immutable "Default World" card
 * first (red outline), followed by user-created worlds and a trailing "add"
 * card that opens a modal to create a new world.
 */
@Component({
  selector: 'app-my-worlds-page',
  imports: [ModalComponent],
  templateUrl: './my-worlds-page.html',
  styleUrl: './my-worlds-page.css',
})
export class MyWorldsPage implements OnInit {
  private readonly worldService = inject(WorldService);
  private readonly editor = inject(EditorService);
  private readonly logger = inject(LoggingService);

  /** Minimum characters enforced by the name input. */
  readonly minNameLength = MIN_WORLD_NAME_LENGTH;

  /** Every world to render (default world first). */
  readonly worlds = this.worldService.worlds;

  /** Whether the "create world" modal is open. */
  readonly isModalOpen = signal(false);
  /** Current value of the new-world name input. */
  readonly newWorldName = signal('');
  /** Validation error for the current input, if any. */
  readonly nameError = signal('');
  /** Whether a create request is in flight. */
  readonly isSaving = signal(false);

  /** Blob URL of the shared world map image, resolved from OPFS. */
  readonly worldmapUrl = signal<string | null>(null);

  ngOnInit(): void {
    void this.worldService.load();
    void this.loadWorldmap();
  }

  /** Opens the create-world modal with a clean state. */
  openCreate(): void {
    this.newWorldName.set('');
    this.nameError.set('');
    this.isModalOpen.set(true);
  }

  /** Closes the create-world modal. */
  closeCreate(): void {
    this.isModalOpen.set(false);
  }

  /** Updates the name input and clears any stale validation error. */
  onNameInput(event: Event): void {
    this.newWorldName.set((event.target as HTMLInputElement).value);
    this.nameError.set('');
  }

  /** Validates and creates the new world, then closes the modal. */
  async confirmCreate(): Promise<void> {
    const error = this.worldService.validateName(this.newWorldName());
    if (error) {
      this.nameError.set(error);
      return;
    }

    this.isSaving.set(true);
    try {
      const world = await this.worldService.createWorld(this.newWorldName());
      this.logger.info(`MyWorlds: created world "${world.name}".`);
      this.closeCreate();
    } catch (err) {
      this.nameError.set(err instanceof Error ? err.message : 'Failed to create world.');
    } finally {
      this.isSaving.set(false);
    }
  }

  /** Whether the given world is the immutable default world. */
  isDefault(world: WorldData): boolean {
    return world.id === DEFAULT_WORLD.id;
  }

  /**
   * Loads the world map image from OPFS and exposes it as a blob URL so it
   * can be used as an `<img src>`. Missing file is non-fatal.
   */
  private async loadWorldmap(): Promise<void> {
    try {
      const bytes = await this.editor.readEditorFile(WORLDMAP_FILE);
      if (!bytes) {
        this.logger.warn('MyWorlds: world map image not found yet.');
        return;
      }
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'image/png' });
      this.worldmapUrl.set(URL.createObjectURL(blob));
      this.logger.info('MyWorlds: loaded world map image from editor store.');
    } catch (error) {
      this.logger.error('MyWorlds: failed to load world map image', error);
    }
  }
}
