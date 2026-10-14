import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  effect,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { TilePaletteComponent } from '../tile-palette/tile-palette.component';
import { StageRenderer } from '../../service/render/stage-renderer';
import {
  SMART_OBJECT_DEFINITIONS,
  SmartObjectDefinition,
  smartObjectBounds,
  renderSmartObjectPreview,
} from '../../entity/smart-object.entity';
import { SmartObjectDragService } from '../../service/smart-object-drag.service';

/**
 * ToolboxColumnComponent
 * ----------------------
 * The room page's right "Toolbox" column. It hosts an **Advanced** collapsible
 * section (manual tile drawing + the {@link TilePaletteComponent}) and a
 * **Decorations** section listing the draggable smart objects with mini previews.
 *
 * The host owns the brush/tool state; this component renders the rail and
 * reports interactions (`tilePicked`, `advancedOpenChange`).
 *
 * @example
 * <app-toolbox-column
 *   [renderer]="renderer()"
 *   [gba]="gba()"
 *   [brushTile]="brushTile()"
 *   (advancedOpenChange)="advancedOpen.set($event)"
 *   (tilePicked)="brushTile.set($event)"
 * />
 */
@Component({
  selector: 'app-toolbox-column',
  imports: [TilePaletteComponent],
  templateUrl: './toolbox-column.component.html',
  host: { class: 'block h-full w-full' },
})
export class ToolboxColumnComponent implements AfterViewInit {
  /** Stage renderer used to draw the tile palette and decoration previews. */
  private _renderer: StageRenderer | null = null;
  @Input()
  get renderer(): StageRenderer | null {
    return this._renderer;
  }
  set renderer(value: StageRenderer | null) {
    this._renderer = value;
    queueMicrotask(() => void this.drawPreviews());
  }

  /** Whether the GBA tileset is used for the palette/previews. */
  private _gba = false;
  @Input()
  get gba(): boolean {
    return this._gba;
  }
  set gba(value: boolean) {
    this._gba = value;
    queueMicrotask(() => void this.drawPreviews());
  }

  /** Currently selected brush tile (shown in the Advanced section). */
  @Input() brushTile = 0;

  /** Emits the Advanced section's open state whenever it changes. */
  @Output() advancedOpenChange = new EventEmitter<boolean>();
  /** Emits the tile value when the user picks a tile from the palette. */
  @Output() tilePicked = new EventEmitter<number>();

  private readonly dragService = inject(SmartObjectDragService);

  /** Whether the Advanced (manual drawing) section is expanded. */
  readonly advancedOpen = signal(false);

  /** Available decoration (smart-object) definitions, shown in the toolbox. */
  readonly decorations: SmartObjectDefinition[] = SMART_OBJECT_DEFINITIONS;

  /** The per-decoration mini preview canvases. */
  private readonly previewCanvases =
    viewChildren<ElementRef<HTMLCanvasElement>>('decoPreview');

  constructor() {
    // Redraw the mini previews once the canvases are available.
    effect(() => {
      this.previewCanvases();
      queueMicrotask(() => void this.drawPreviews());
    });
  }

  ngAfterViewInit(): void {
    void this.drawPreviews();
  }

  /** Renders each decoration's mini preview into its canvas (once loaded). */
  private async drawPreviews(): Promise<void> {
    const renderer = this._renderer;
    if (!renderer) {
      return;
    }
    await renderer.prepareTileset();
    const canvases = this.previewCanvases();
    for (let i = 0; i < this.decorations.length && i < canvases.length; i++) {
      const definition = this.decorations[i];
      const canvas = canvases[i].nativeElement;
      const bounds = smartObjectBounds(definition);
      canvas.width = bounds.cols * 16;
      canvas.height = bounds.rows * 16;
      const buffer = renderSmartObjectPreview(definition, (target, px, py, tileId) =>
        renderer.drawTilesetTile(target, px, py, tileId, this._gba),
      );
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        continue;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(buffer.pixels), buffer.width, buffer.height),
        0,
        0,
      );
    }
  }

  /** Toggles the Advanced section. */
  toggleAdvanced(): void {
    const open = !this.advancedOpen();
    this.advancedOpen.set(open);
    this.advancedOpenChange.emit(open);
  }

  /** Starts a native drag carrying the decoration id. */
  onDecorationDragStart(event: DragEvent, definition: SmartObjectDefinition): void {
    event.dataTransfer?.setData('application/x-smart-object', definition.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
      // Hide the default drag image (the toolbox card) so it does not obscure the
      // transparent preview we draw on the canvas.
      const blank = document.createElement('canvas');
      blank.width = 1;
      blank.height = 1;
      event.dataTransfer.setDragImage(blank, 0, 0);
    }
    // dragover cannot read the data payload, so expose it via the shared service
    // for the canvas preview.
    this.dragService.start(definition);
  }

  /** Clears the shared drag state when the drag ends. */
  onDecorationDragEnd(): void {
    this.dragService.clear();
  }
}
