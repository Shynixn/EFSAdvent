import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '../../component/button/button.component';
import { WorldService } from '../../service/world.service';
import { WorldTabsService } from '../../service/world-tabs.service';
import { EditorService, WORLDMAP_FILE } from '../../service/editor.service';
import { LoggingService } from '../../service/logging.service';

/**
 * WorldPage
 * ---------
 * A sub-page of "My Worlds" showing a single world's map image, framing the
 * full map in the centre. Opening it registers a tab under the My Worlds nav;
 * the close button removes the tab and returns to the worlds list.
 */
@Component({
  selector: 'app-world-page',
  imports: [ButtonComponent],
  templateUrl: './world-page.html',
  styleUrl: './world-page.css',
})
export class WorldPage implements OnInit {
  private readonly worldService = inject(WorldService);
  private readonly tabs = inject(WorldTabsService);
  private readonly editor = inject(EditorService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly logger = inject(LoggingService);

  /** Id of the world being viewed. */
  readonly worldId = signal('');
  /** World name for the header. */
  readonly worldName = signal('World');
  /** Blob URL of the shared world map image. */
  readonly worldmapUrl = signal<string | null>(null);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('worldId') ?? '';
    this.worldId.set(id);

    void this.worldService.load().then(() => {
      const world = this.worldService.getById(id);
      if (!world) {
        this.logger.warn(`WorldPage: unknown world "${id}" — returning to My Worlds.`);
        void this.router.navigate(['/my-worlds']);
        return;
      }
      this.worldName.set(world.name);
      this.tabs.open(id);
    });

    void this.loadWorldmap();
  }

  /** Closes this world tab and returns to the worlds list. */
  close(): void {
    this.tabs.close(this.worldId());
    void this.router.navigate(['/my-worlds']);
  }

  /** Loads the shared world map image from OPFS as a blob URL (non-fatal). */
  private async loadWorldmap(): Promise<void> {
    try {
      const bytes = await this.editor.readEditorFile(WORLDMAP_FILE);
      if (!bytes) {
        this.logger.warn('WorldPage: world map image not found yet.');
        return;
      }
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'image/png' });
      this.worldmapUrl.set(URL.createObjectURL(blob));
    } catch (error) {
      this.logger.error('WorldPage: failed to load world map image', error);
    }
  }
}
