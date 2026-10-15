import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  signal,
  viewChild,
} from '@angular/core';
import { ImageBuffer, TILE_SIZE } from '../../service/render/gba-tile-renderer';
import { StageRenderer, TILESET_COLUMNS, TILESET_COUNT } from '../../service/render/stage-renderer';

/**
 * TilePaletteComponent
 * --------------------
 * Renders the stage's tileset as a pickable palette (16×64 tiles of 16px) onto a
 * `<canvas>`. Clicking a tile selects it locally (to show its id) and emits
 * {@link tilePicked} — the host may ignore that event to keep the palette
 * reference-only (no brush change).
 *
 * Extracted from {@link RoomCanvasComponent} so the palette can live in the room
 * page's Toolbox "Advanced" section rather than under the room canvas.
 *
 * @example
 * <app-tile-palette [renderer]="renderer()" [gba]="gba()" [tile]="brushTile()" (tilePicked)="brushTile.set($event)" />
 */
@Component({
  selector: 'app-tile-palette',
  templateUrl: './tile-palette.component.html',
  host: { class: 'block w-full' },
})
export class TilePaletteComponent implements AfterViewInit {
  private _renderer: StageRenderer | null = null;
  /** The stage renderer used to draw the tileset. */
  @Input()
  get renderer(): StageRenderer | null {
    return this._renderer;
  }
  set renderer(value: StageRenderer | null) {
    this._renderer = value;
    queueMicrotask(() => void this.render());
  }

  private _gba = false;
  /** When true the GBA tileset is drawn. */
  @Input()
  get gba(): boolean {
    return this._gba;
  }
  set gba(value: boolean) {
    this._gba = value;
    queueMicrotask(() => void this.render());
  }

  private _themeIndex = -1;
  /**
   * Currently selected tileset theme index. The tileset graphics change with
   * it, so the palette re-renders whenever this input changes.
   */
  @Input()
  get themeIndex(): number {
    return this._themeIndex;
  }
  set themeIndex(value: number) {
    if (value === this._themeIndex) {
      return;
    }
    this._themeIndex = value;
    queueMicrotask(() => void this.render());
  }

  /** Currently selected tile value (for the label). */
  @Input() tile = 0;

  /**
   * Tile id most recently clicked in this palette. Shown in the label so the
   * user can read the id even when the host ignores {@link tilePicked} (i.e.
   * the palette is reference-only and does not set the brush).
   */
  readonly pickedTile = signal<number | null>(null);

  /** Tile id to label: the local click wins, else the host-provided `tile`. */
  labelTile(): number {
    return this.pickedTile() ?? this.tile;
  }

  /** Emits the tile value when the user picks a tile. */
  @Output() tilePicked = new EventEmitter<number>();

  /** The tileset palette canvas. */
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('tileset');

  ngAfterViewInit(): void {
    void this.render();
  }

  /** Renders the whole tileset grid into the palette canvas. */
  private async render(): Promise<void> {
    const canvas = this.canvasRef()?.nativeElement;
    const renderer = this.renderer;
    if (!canvas || !renderer) {
      return;
    }
    await renderer.prepareTileset();

    const buffer = new ImageBuffer(canvas.width, canvas.height);
    // Neutral mid-grey backdrop so the tiles (which use transparent palette
    // index 0) read clearly against it.
    buffer.fill(96, 96, 108, 255);
    renderer.drawTileset(buffer, this.gba);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(buffer.pixels), buffer.width, buffer.height),
      0,
      0,
    );
  }

  /** Picks the tile under the pointer from the tileset palette. */
  onCanvasClick(event: MouseEvent): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const canvasX = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const canvasY = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const col = Math.floor(canvasX / TILE_SIZE);
    const row = Math.floor(canvasY / TILE_SIZE);
    if (col < 0 || col >= TILESET_COLUMNS || row < 0) {
      return;
    }
    const tileIndex = row * TILESET_COLUMNS + col;
    if (tileIndex < 0 || tileIndex >= TILESET_COUNT) {
      return;
    }
    // Remember the click locally so the label shows the id even when the host
    // ignores the event (reference-only palette).
    this.pickedTile.set(tileIndex);
    this.tilePicked.emit(tileIndex);
  }
}
