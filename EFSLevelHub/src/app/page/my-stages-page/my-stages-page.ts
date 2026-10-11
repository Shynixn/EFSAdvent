import { Component, OnInit, inject, signal } from '@angular/core';
import { CardComponent } from '../../component/card/card.component';
import { StageService } from '../../service/stage.service';
import { EditorService, WORLDMAP_FILE } from '../../service/editor.service';
import { LoggingService } from '../../service/logging.service';

/**
 * MyStagesPage
 * ------------
 * Lists the stages registered in the editor. Default (game) stages are shown as
 * locked cards. Until a stage's own map preview is generated (which happens
 * lazily when a stage is opened), each card shows the shared world map image.
 */
@Component({
  selector: 'app-my-stages-page',
  imports: [CardComponent],
  templateUrl: './my-stages-page.html',
  styleUrl: './my-stages-page.css',
})
export class MyStagesPage implements OnInit {
  private readonly stageService = inject(StageService);
  private readonly editor = inject(EditorService);
  private readonly logger = inject(LoggingService);

  /** All registered stages. */
  readonly stages = this.stageService.stages;

  /** Blob URL of the shared world map image (used as a placeholder preview). */
  readonly worldmapUrl = signal<string | null>(null);

  ngOnInit(): void {
    void this.init();
  }

  /** Loads stages and resolves the shared world map image. */
  private async init(): Promise<void> {
    await this.stageService.load();
    await this.loadWorldmap();
  }

  /** Loads `/editor/cache/image/worldmap.png` from OPFS as a blob URL. */
  private async loadWorldmap(): Promise<void> {
    try {
      const bytes = await this.editor.readEditorFile(WORLDMAP_FILE);
      if (!bytes) {
        this.logger.warn('MyStages: world map image not found yet.');
        return;
      }
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'image/png' });
      this.worldmapUrl.set(URL.createObjectURL(blob));
    } catch (error) {
      this.logger.error('MyStages: failed to load world map image', error);
    }
  }
}
