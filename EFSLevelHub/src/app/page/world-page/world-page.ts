import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '../../component/button/button.component';
import { StagePickerComponent } from '../../component/stage-picker/stage-picker.component';
import { ModalComponent } from '../../component/modal/modal.component';
import { WorldService } from '../../service/world.service';
import { StageService, StageFile, DEFAULT_STAGE_ARC_ORDER } from '../../service/stage.service';
import { WorldTabsService } from '../../service/world-tabs.service';
import { EditorService, WORLDMAP_FILE } from '../../service/editor.service';
import {
  IsoBuilderService,
  BlobIsoWriter,
  FileStreamIsoWriter,
  IsoWriter,
} from '../../service/iso-builder.service';
import { IsoSourceService } from '../../service/iso-source.service';
import { LoggingService } from '../../service/logging.service';

/**
 * A clickable marker drawn on the world map.
 *
 * Coordinates are percentages of the map image (0–100), so the markers stay
 * anchored to the same spot when the image is resized.
 */
export interface MapPoint {
  id: string;
  /** Horizontal position as a percentage of the image width (0–100). */
  x: number;
  /** Vertical position as a percentage of the image height (0–100). */
  y: number;
  /** Optional label shown on hover / future tooltips. */
  label?: string;
  /** Id of the stage currently assigned to this marker. */
  stageId: string;
  /** Zero-based slot in the world's `stages` array this marker edits. */
  slot: number;
}

/**
 * WorldPage
 * ---------
 * A sub-page of "My Worlds" showing a single world's map image, framing the
 * full map in the centre. Opening it registers a tab under the My Worlds nav;
 * the close button removes the tab and returns to the worlds list.
 */
@Component({
  selector: 'app-world-page',
  imports: [ButtonComponent, StagePickerComponent, ModalComponent],
  templateUrl: './world-page.html',
  styleUrl: './world-page.css',
})
export class WorldPage implements OnInit, OnDestroy {
  private readonly worldService = inject(WorldService);
  private readonly stageService = inject(StageService);
  private readonly isoBuilder = inject(IsoBuilderService);
  private readonly isoSource = inject(IsoSourceService);
  private readonly tabs = inject(WorldTabsService);
  private readonly editor = inject(EditorService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly logger = inject(LoggingService);

  /** The flex area the map is fitted into; observed for resizing. */
  private readonly mapArea = viewChild<ElementRef<HTMLDivElement>>('mapArea');
  private resizeObserver: ResizeObserver | null = null;

  /** Id of the world being viewed. */
  readonly worldId = signal('');
  /** World name for the header. */
  readonly worldName = signal('World');
  /** Blob URL of the shared world map image. */
  readonly worldmapUrl = signal<string | null>(null);

  /** Natural aspect ratio (`width / height`) of the loaded map image. */
  private readonly imageAspect = signal<number | null>(null);
  /** Size of the container the map is fitted into, in CSS pixels. */
  private readonly areaSize = signal<{ width: number; height: number }>({ width: 0, height: 0 });

  /**
   * Pixel geometry of the map's displayed (contain-fitted) box within the area.
   * Markers are positioned against this box so they stay anchored to the image
   * at any size and aspect ratio.
   */
  readonly mapBox = computed(() => {
    const { width, height } = this.areaSize();
    const aspect = this.imageAspect();
    if (!aspect || width === 0 || height === 0) {
      return null;
    }
    // Contain fit: scale to the smaller of width/height constraints.
    const fittedWidth = Math.min(width, height * aspect);
    const fittedHeight = fittedWidth / aspect;
    return { width: fittedWidth, height: fittedHeight };
  });

  /**
   * Fixed marker coordinates (percentages of the map image), in stage order.
   * The label is filled in from the world's stages (name + number).
   */
  private readonly coordinates: { x: number; y: number }[] = [
    { x: 80, y: 43 },
    { x: 65, y: 47 },
    { x: 55, y: 50 },
    { x: 70, y: 95 },
    { x: 80, y: 85 },
    { x: 83, y: 75 },
    { x: 40, y: 35 },
    { x: 48, y: 22 },
    { x: 60, y: 20 },
    { x: 60, y: 90 },
    { x: 65, y: 80 },
    { x: 50, y: 60 },
    { x: 17, y: 50 },
    { x: 20, y: 43 },
    { x: 23, y: 60 },
    { x: 20, y: 90 },
    { x: 13, y: 80 },
    { x: 25, y: 75 },
    { x: 45, y: 90 },
    { x: 45, y: 75 },
    { x: 37, y: 60 },
    { x: 10, y: 27 },
    { x: 20, y: 20 },
    { x: 30, y: 13 },
  ];

  /** Markers rendered on the map (label = stage name + number). */
  readonly points = signal<MapPoint[]>([]);

  /** All known stages, offered by the stage picker. */
  readonly allStages = signal<StageFile[]>([]);

  /** Whether the stage picker modal is open. */
  readonly pickerOpen = signal(false);

  /** The marker currently being re-pointed (null when the picker is closed). */
  readonly activePoint = signal<MapPoint | null>(null);

  /** Whether the export-to-ISO progress modal is open. */
  readonly exportOpen = signal(false);
  /** Export progress percentage (0–100). */
  readonly exportPercent = signal(0);
  /** Export progress status message. */
  readonly exportMessage = signal('');
  /** Whether the export finished successfully. */
  readonly exportDone = signal(false);
  /** Export error message, if any. */
  readonly exportError = signal('');
  /** Whether a source ISO is available for export. */
  readonly canExport = signal(false);

  /** Whether a `.fsaworld` export is in flight. */
  readonly exportingWorld = signal(false);

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
      void this.buildPoints(world.stages.map((s) => s.id));
    });

    void this.loadWorldmap();
    void this.isoSource.exists().then((has) => this.canExport.set(has));
    this.observeArea();
  }

  /**
   * Builds the map markers by pairing the fixed coordinates with the stage
   * names (in order), labelling each with the stage name and its number.
   */
  private async buildPoints(stageIds: string[]): Promise<void> {
    await this.stageService.load();
    const stages = this.stageService.stages();
    this.allStages.set(stages);
    const namesById = new Map<string, string>(stages.map((s: StageFile) => [s.id, s.name]));

    const points: MapPoint[] = this.coordinates.map((coord, i) => {
      const stageId = stageIds[i] ?? '';
      const name = namesById.get(stageId) || 'Stage';
      return {
        id: stageId || `p${i + 1}`,
        x: coord.x,
        y: coord.y,
        label: `${name} (${i + 1})`,
        stageId,
        slot: i,
      };
    });

    this.points.set(points);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  /** Opens the stage picker for the clicked marker. */
  onPointClick(point: MapPoint): void {
    this.activePoint.set(point);
    this.pickerOpen.set(true);
    this.logger.info(`WorldPage: editing slot ${point.slot} ("${point.id}").`);
  }

  /** Closes the stage picker without changing the marker. */
  closePicker(): void {
    this.pickerOpen.set(false);
    this.activePoint.set(null);
  }

  /**
   * Re-points the active marker at the chosen stage, persists the change to the
   * world file and refreshes the marker's label.
   */
  async onStagePicked(stageId: string): Promise<void> {
    const point = this.activePoint();
    const worldId = this.worldId();
    if (!point || !worldId) {
      this.closePicker();
      return;
    }

    // Re-point the slot at the chosen stage. The slot's target arc name is
    // fixed by its position (slot 0 → boss010.arc, …), independent of which
    // stage the slot now references, so keep it in sync here.
    const arcId = DEFAULT_STAGE_ARC_ORDER[point.slot];
    const updated = await this.worldService.setWorldStage(worldId, point.slot, {
      id: stageId,
      arcFileName: arcId ? `${arcId}.arc` : '',
    });
    if (updated) {
      void this.buildPoints(updated.stages.map((s) => s.id));
    }
    this.closePicker();
  }

  /**
   * Builds a patched ISO from the world's stages and prompts the user to save
   * it, showing progress in a modal.
   *
   * Uses the File System Access API's save picker when available (Chrome/Edge);
   * otherwise falls back to a standard blob download, which any browser handles
   * through its own save dialog.
   */
  async exportToIso(): Promise<void> {
    const worldId = this.worldId();

    const suggestedName = `${(this.worldName() || 'world').replace(/[^\w.-]+/g, '_')}.iso`;

    // Prefer the native save picker so we can stream straight to disk.
    const picker = (window as unknown as { showSaveFilePicker?: SaveFilePickerFn })
      .showSaveFilePicker;
    let writer: IsoWriter;
    if (picker) {
      let handle: FileSystemFileHandle;
      try {
        handle = await picker({
          suggestedName,
          types: [
            { description: 'GameCube ISO', accept: { 'application/octet-stream': ['.iso'] } },
          ],
        });
      } catch {
        // User cancelled the save dialog — do nothing.
        return;
      }
      writer = new FileStreamIsoWriter(await handle.createWritable());
    } else {
      // Firefox/Safari: build in memory and download when finished.
      writer = new BlobIsoWriter();
    }

    const blobWriter = writer instanceof BlobIsoWriter ? writer : null;

    this.exportError.set('');
    this.exportDone.set(false);
    this.exportPercent.set(0);
    this.exportMessage.set('Preparing export…');
    this.exportOpen.set(true);

    try {
      const result = await this.isoBuilder.exportWorld(worldId, writer, (progress) => {
        this.exportPercent.set(progress.percent);
        this.exportMessage.set(progress.message);
      });

      if (blobWriter) {
        this.exportMessage.set('Preparing download…');
        this.downloadBlob(blobWriter.toBlob(), suggestedName);
      }

      this.exportPercent.set(100);
      this.exportDone.set(true);
      const retargetedNote =
        result.retargetedArcs > 0
          ? ` ${result.retargetedArcs} re-indexed into a different slot — verify those stages in-game.`
          : '';
      this.exportMessage.set(
        `Done — ${result.replacedArcs} stage arc(s) replaced.${retargetedNote} ${
          blobWriter ? 'Downloaded' : 'Saved'
        } ${this.formatBytes(result.outputSize)}.`,
      );
    } catch (error) {
      this.exportError.set(error instanceof Error ? error.message : 'Export failed.');
      this.logger.error('WorldPage: ISO export failed', error);
    }
  }

  /**
   * Downloads the world as a `.fsaworld` package.
   *
   * The package bundles the world manifest plus, for every filled slot,
   * `stages/<index>.json` and `stages/<index>.arc`. No save is needed first:
   * stage definitions and archives are read from the persisted store, and a
   * world's slots are written as soon as they are changed.
   */
  async exportWorldFile(): Promise<void> {
    const worldId = this.worldId();
    if (!worldId || this.exportingWorld()) {
      return;
    }
    this.exportingWorld.set(true);
    try {
      const result = await this.worldService.exportWorldPackage(worldId);
      if (!result) {
        this.logger.warn(`WorldPage: nothing to export for world "${worldId}".`);
        return;
      }
      this.downloadBlob(
        new Blob([result.bytes as unknown as BlobPart], { type: 'application/zip' }),
        result.fileName,
      );
    } catch (error) {
      this.logger.error('WorldPage: world file export failed', error);
    } finally {
      this.exportingWorld.set(false);
    }
  }

  /** Triggers a browser download of the given blob via a temporary link. */
  private downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoke shortly after, so the download has time to start.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** Dismisses the export modal. */
  closeExport(): void {
    this.exportOpen.set(false);
  }

  /** Formats a byte count for display. */
  formatBytes(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** Captures the image's natural aspect ratio once it has loaded. */
  onImageLoad(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      this.imageAspect.set(img.naturalWidth / img.naturalHeight);
    }
  }

  /** Tracks the fit area's size so the map box can be recomputed on resize. */
  private observeArea(): void {
    const el = this.mapArea()?.nativeElement;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        this.areaSize.set({ width, height });
      }
    });
    this.resizeObserver.observe(el);
    this.areaSize.set({ width: el.clientWidth, height: el.clientHeight });
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

/** Minimal typing for `window.showSaveFilePicker`. */
type SaveFilePickerFn = (options?: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;
