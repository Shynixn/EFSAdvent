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
import { WorldService } from '../../service/world.service';
import { WorldTabsService } from '../../service/world-tabs.service';
import { EditorService, WORLDMAP_FILE } from '../../service/editor.service';
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
  imports: [ButtonComponent],
  templateUrl: './world-page.html',
  styleUrl: './world-page.css',
})
export class WorldPage implements OnInit, OnDestroy {
  private readonly worldService = inject(WorldService);
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
   * Hard-coded markers for now — positions are percentages of the map image,
   * so they track the image as it scales.
   */
  readonly points: MapPoint[] = [
    { id: 'p1', x: 80, y: 43, label: 'Stage 1' },
    { id: 'p2', x: 65, y: 47, label: 'Stage 2' },
    { id: 'p3', x: 55, y: 50, label: 'Stage 3' },
    { id: 'p4', x: 70, y: 95, label: 'Stage 4' },
    { id: 'p5', x: 80, y: 85, label: 'Stage 5' },
    { id: 'p6', x: 83, y: 75, label: 'Stage 6' },
    { id: 'p7', x: 40, y: 35, label: 'Stage 7' },
    { id: 'p8', x: 48, y: 22, label: 'Stage 8' },
    { id: 'p9', x: 60, y: 20, label: 'Stage 9' },
    { id: 'p10', x: 60, y: 90, label: 'Stage 10' },
    { id: 'p11', x: 65, y: 80, label: 'Stage 11' },
    { id: 'p12', x: 50, y: 60, label: 'Stage 12' },
    { id: 'p13', x: 17, y: 50, label: 'Stage 13' },
    { id: 'p14', x: 20, y: 43, label: 'Stage 14' },
    { id: 'p15', x: 23, y: 60, label: 'Stage 15' },
    { id: 'p16', x: 20, y: 90, label: 'Stage 16' },
    { id: 'p17', x: 13, y: 80, label: 'Stage 17' },
    { id: 'p18', x: 25, y: 75, label: 'Stage 18' },
    { id: 'p19', x: 45, y: 90, label: 'Stage 19' },
    { id: 'p20', x: 45, y: 75, label: 'Stage 20' },
    { id: 'p21', x: 37, y: 60, label: 'Stage 21' },
    { id: 'p22', x: 10, y: 27, label: 'Stage 22' },
    { id: 'p23', x: 20, y: 20, label: 'Stage 23' },
    { id: 'p24', x: 30, y: 13, label: 'Stage 24' },
  ];

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
    this.observeArea();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  /** Handles a marker click (no-op for now). */
  onPointClick(point: MapPoint): void {
    this.logger.info(`WorldPage: clicked point "${point.id}" (${point.x}%, ${point.y}%)`);
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
