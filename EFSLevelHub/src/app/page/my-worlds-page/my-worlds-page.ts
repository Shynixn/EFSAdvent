import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CardComponent } from '../../component/card/card.component';
import { ModalComponent } from '../../component/modal/modal.component';
import { ButtonComponent } from '../../component/button/button.component';
import { WorldData } from '../../entity/editor.entity';
import { WorldService, MIN_WORLD_NAME_LENGTH } from '../../service/world.service';
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
  imports: [CardComponent, ModalComponent, ButtonComponent, FormsModule],
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
    const world = await this.worldService.createWorld(this.newName(), this.newAuthor());
    if (!world) {
      this.createError.set(`Enter a name of at least ${MIN_WORLD_NAME_LENGTH} characters.`);
      return;
    }
    this.closeCreate();
    this.openWorld(world);
  }

  /** Opens a world in a new tab and navigates to its page. */
  openWorld(world: WorldData): void {
    this.tabs.open(world.id);
    void this.router.navigate(['/my-worlds', world.id]);
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
