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
  findSmartObjectDefinition,
  smartObjectBounds,
  renderSmartObjectPreview,
} from '../../entity/smartobject.entity';
import { GROUND_DEFINITIONS, GroundDefinition } from '../../entity/ground.entity';
import { SmartObjectDragService } from '../../service/smart-object-drag.service';
import { ImageBuffer } from '../../service/render/gba-tile-renderer';

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

  /**
   * Currently selected tileset theme index. Changing it swaps the tileset used
   * for every preview, so the whole toolbox repaints when this input changes.
   */
  @Input()
  set themeIndex(value: number) {
    if (value === this._themeIndex) {
      return;
    }
    this._themeIndex = value;
    queueMicrotask(() => void this.drawPreviews());
  }
  get themeIndex(): number {
    return this._themeIndex;
  }
  private _themeIndex = -1;

  /** Currently selected brush tile (shown in the Advanced section). */
  @Input() brushTile = 0;

  /** Id of the currently selected ground (none selected when empty). */
  @Input() selectedGroundId = '';

  /** Emits the Advanced section's open state whenever it changes. */
  @Output() advancedOpenChange = new EventEmitter<boolean>();
  /** Emits the tile value when the user picks a tile from the palette. */
  @Output() tilePicked = new EventEmitter<number>();
  /** Emits the ground definition when the user picks a ground. */
  @Output() groundPicked = new EventEmitter<GroundDefinition>();
  /** Emits when the user clears the selected ground (deselect). */
  @Output() groundCleared = new EventEmitter<void>();
  /** Emits when a decoration drag starts (host switches to the hand tool). */
  @Output() decorationDragStarted = new EventEmitter<void>();

  private readonly dragService = inject(SmartObjectDragService);

  /** Whether the Advanced (manual drawing) section is expanded. */
  readonly advancedOpen = signal(false);

  /** Whether the Ground section is expanded. */
  readonly groundOpen = signal(true);

  /** Whether the Doors section is expanded. */
  readonly doorsOpen = signal(true);

  /** Whether the Decorations section is expanded. */
  readonly decorationsOpen = signal(true);

  /** Whether the Enemies section is expanded. */
  readonly enemiesOpen = signal(true);

  /** Available decoration (smart-object) definitions, shown in the toolbox. */
  readonly decorations: SmartObjectDefinition[] = SMART_OBJECT_DEFINITIONS;

  /** Definitions in the "Doors" section. */
  readonly doorDefinitions: SmartObjectDefinition[] = SMART_OBJECT_DEFINITIONS.filter(
    (definition) => definition.section === 'Doors',
  );

  /** Definitions in the "Decorations" section. */
  readonly otherDefinitions: SmartObjectDefinition[] = SMART_OBJECT_DEFINITIONS.filter(
    (definition) => definition.section !== 'Doors',
  );

  /** Placable enemies (actor-baked smart objects), shown in the Enemies section. */
  private _enemies: SmartObjectDefinition[] = [];
  @Input()
  get enemies(): SmartObjectDefinition[] {
    return this._enemies;
  }
  set enemies(value: SmartObjectDefinition[]) {
    this._enemies = value ?? [];
    // The catalog arrives asynchronously; repaint the thumbnails once it does.
    queueMicrotask(() => void this.drawPreviews());
  }

  /** Available ground definitions, shown in the Ground box. */
  readonly grounds: GroundDefinition[] = GROUND_DEFINITIONS;

  /** The per-decoration mini preview canvases. */
  private readonly previewCanvases = viewChildren<ElementRef<HTMLCanvasElement>>('decoPreview');

  /** The per-ground mini preview canvases. */
  private readonly groundCanvases = viewChildren<ElementRef<HTMLCanvasElement>>('groundPreview');

  /** The per-enemy mini preview canvases. */
  private readonly enemyCanvases = viewChildren<ElementRef<HTMLCanvasElement>>('enemyPreview');

  constructor() {
    // Redraw the mini previews once the canvases are available.
    effect(() => {
      this.previewCanvases();
      this.groundCanvases();
      this.enemyCanvases();
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
    // Match each canvas to its definition by id, so collapsing a section (which
    // removes its canvases from the DOM) does not shift the mapping.
    for (const ref of canvases) {
      const id = ref.nativeElement.dataset['decoId'];
      const definition = id ? findSmartObjectDefinition(id) : undefined;
      const canvas = ref.nativeElement;
      if (!definition) {
        continue;
      }
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

    // Ground swatches: a single representative tile per ground.
    const groundCanvases = this.groundCanvases();
    for (let i = 0; i < this.grounds.length && i < groundCanvases.length; i++) {
      const ground = this.grounds[i];
      const canvas = groundCanvases[i].nativeElement;
      canvas.width = 16;
      canvas.height = 16;
      const buffer = new ImageBuffer(16, 16);
      buffer.fill(0, 0, 0, 0);
      renderer.drawTilesetTile(buffer, 0, 0, ground.tile, this._gba);
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

    // Enemy thumbnails: render each actor's default variant into its canvas.
    const enemyCanvases = this.enemyCanvases();
    if (enemyCanvases.length > 0) {
      try {
        await renderer.prepareActors();
      } catch {
        // Sprite sheets may be missing for this stage; skip enemy thumbnails.
      }
      for (const ref of enemyCanvases) {
        const id = ref.nativeElement.dataset['enemyId'];
        const enemy = this.enemies.find((entry) => entry.id === id);
        const canvas = ref.nativeElement;
        if (!enemy) {
          continue;
        }
        const buffer = renderer.renderActorPreview(
          id ?? '',
          enemy.actorVariable ?? 0,
          32,
          32,
          this._gba,
        );
        if (!buffer) {
          continue;
        }
        canvas.width = buffer.width;
        canvas.height = buffer.height;

        // Scale the bitmap to FIT the 64px-thumbnail box (preserving aspect),
        // so small sprites are enlarged and large ones shrunk without warp.
        const scale = Math.min(64 / buffer.width, 64 / buffer.height);
        canvas.style.width = `${Math.round(buffer.width * scale)}px`;
        canvas.style.height = `${Math.round(buffer.height * scale)}px`;

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
  }

  /** Toggles the Advanced section. */
  toggleAdvanced(): void {
    const open = !this.advancedOpen();
    this.advancedOpen.set(open);
    this.advancedOpenChange.emit(open);
  }

  /** Toggles the Ground section. */
  toggleGround(): void {
    this.groundOpen.update((open) => !open);
  }

  /** Toggles the Doors section. */
  toggleDoors(): void {
    this.doorsOpen.update((open) => !open);
  }

  /** Toggles the Decorations section. */
  toggleDecorations(): void {
    this.decorationsOpen.update((open) => !open);
  }

  /** Toggles the Enemies section. */
  toggleEnemies(): void {
    this.enemiesOpen.update((open) => !open);
  }

  /** Selects a ground (or deselects it when the same one is clicked again). */
  selectGround(ground: GroundDefinition): void {
    if (this.selectedGroundId === ground.id) {
      this.groundCleared.emit();
      return;
    }
    this.groundPicked.emit(ground);
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
    // for the canvas preview. Start from the default variant (index 0).
    this.dragService.start(definition, 0);
    // Let the host switch to the hand tool so the decoration can be positioned.
    this.decorationDragStarted.emit();
  }

  /** Clears the shared drag state when the drag ends. */
  onDecorationDragEnd(): void {
    this.dragService.clear();
  }
}
