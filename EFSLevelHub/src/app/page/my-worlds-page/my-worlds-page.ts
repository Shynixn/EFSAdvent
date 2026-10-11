import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CardComponent } from '../../component/card/card.component';
import { WorldData } from '../../entity/editor.entity';
import { WorldService, ZERO_GUID } from '../../service/world.service';
import { WorldTabsService } from '../../service/world-tabs.service';
import { EditorService, WORLDMAP_FILE } from '../../service/editor.service';
import { LoggingService } from '../../service/logging.service';

/**
 * MyWorldsPage
 * ------------
 * Lists the worlds stored under `/editor/world`. Opening a world registers a
 * tab and navigates to its page.
 */
@Component({
  selector: 'app-my-worlds-page',
  imports: [CardComponent],
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

  ngOnInit(): void {
    void this.worldService.load();
    void this.loadWorldmap();
  }

  /** Whether the given world is the immutable default world. */
  isDefault(world: WorldData): boolean {
    return world.id === ZERO_GUID;
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
