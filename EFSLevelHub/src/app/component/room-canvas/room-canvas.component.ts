import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  viewChild,
} from '@angular/core';
import { RoomData } from '../../entity/fsalib.entity';
import { ImageBuffer, TILE_SIZE } from '../../service/render/gba-tile-renderer';
import { StageRenderer, TILESET_COLUMNS, TILESET_COUNT } from '../../service/render/stage-renderer';

/** A tile edit produced by painting on the canvas. */
export interface RoomTileChange {
  /** Layer index that was edited (0-7 base, 8-15 top). */
  layerIndex: number;
  /** Tile coordinate that changed. */
  x: number;
  y: number;
  /** New tile value. */
  tile: number;
}

/** Room layer grid dimension (32×32 tiles). */
const DIMENSION = 32;

/**
 * RoomCanvasComponent
 * -------------------
 * Editable room canvas — the main room editor, modelled on EFSAdvent's WinForms
 * room view. It renders a single room layer onto a `<canvas>` and lets the user
 * paint tiles onto the active layer with the left mouse button (click or drag).
 *
 * Rendering uses the shared {@link StageRenderer} (TV or GBA tileset). Painting
 * mutates the room's layer tiles in place and emits each change so the parent
 * can mark the stage dirty / persist it.
 *
 * @example
 * <app-room-canvas
 *   [room]="room()"
 *   [renderer]="renderer()"
 *   [layerIndex]="layer()"
 *   [tile]="brushTile()"
 *   (tileChanged)="onTileChanged($event)"
 * />
 */
@Component({
  selector: 'app-room-canvas',
  templateUrl: './room-canvas.component.html',
})
export class RoomCanvasComponent implements AfterViewInit {
  /** The room to edit. */
  @Input() room: RoomData | null = null;

  private _renderer: StageRenderer | null = null;
  /** The stage renderer (for drawing the layer). Triggers a redraw on change. */
  @Input()
  get renderer(): StageRenderer | null {
    return this._renderer;
  }
  set renderer(value: StageRenderer | null) {
    this._renderer = value;
    queueMicrotask(() => void this.refreshAll());
  }

  private _index = -1;
  /** Room index within the stage (needed to draw it). */
  @Input()
  get index(): number {
    return this._index;
  }
  set index(value: number) {
    this._index = value;
    queueMicrotask(() => void this.redraw());
  }

  private _layerIndex = 0;
  /** Active layer (0-7 base, 8-15 top). */
  @Input()
  get layerIndex(): number {
    return this._layerIndex;
  }
  set layerIndex(value: number) {
    this._layerIndex = value;
    queueMicrotask(() => void this.redraw());
  }

  private _gba = false;
  /** When true the GBA tileset/layers are drawn (layer level 1). */
  @Input()
  get gba(): boolean {
    return this._gba;
  }
  set gba(value: boolean) {
    this._gba = value;
    queueMicrotask(() => void this.refreshAll());
  }

  private _tile = 0;
  /** Tile value painted on left click/drag. */
  @Input()
  get tile(): number {
    return this._tile;
  }
  set tile(value: number) {
    this._tile = value;
  }

  /** Emits each tile edit as it is painted. */
  @Output() tileChanged = new EventEmitter<RoomTileChange>();

  /** Emits the tile value whenever the user picks a tile from the palette. */
  @Output() tilePicked = new EventEmitter<number>();

  /** The canvas element the room is drawn onto. */
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  /** The tileset palette canvas (tile picker). */
  private readonly tilesetRef = viewChild<ElementRef<HTMLCanvasElement>>('tileset');

  /** Whether the left mouse button is held (for drag-painting). */
  private painting = false;

  ngAfterViewInit(): void {
    void this.refreshAll();
  }

  /** Redraws the room and the tileset sequentially (so palettes load first). */
  private async refreshAll(): Promise<void> {
    await this.renderTileset();
    await this.redraw();
  }

  /** Renders the whole tileset grid into the palette canvas. */
  private async renderTileset(): Promise<void> {
    const canvas = this.tilesetRef()?.nativeElement;
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
  onTilesetClick(event: MouseEvent): void {
    const canvas = this.tilesetRef()?.nativeElement;
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
    this.tile = tileIndex;
    this.tilePicked.emit(tileIndex);
  }

  /** Re-renders the current layer onto the canvas. */
  async redraw(): Promise<void> {
    const canvas = this.canvasRef()?.nativeElement;
    const renderer = this.renderer;
    if (!canvas || !renderer) {
      return;
    }

    await renderer.prepareTileset();

    if (this.index < 0) {
      return;
    }

    const width = canvas.width;
    const height = canvas.height;
    const buffer = new ImageBuffer(width, height);
    buffer.fill(0, 0, 0, 255);
    renderer.drawSingleLayer(buffer, this.index, this.layerIndex, this.gba);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const image = new ImageData(new Uint8ClampedArray(buffer.pixels), buffer.width, buffer.height);
    ctx.putImageData(image, 0, 0);
  }

  /** Starts painting; paints the tile under the cursor. */
  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    this.painting = true;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    this.paintAt(event);
  }

  /** Continues painting while dragging. */
  onPointerMove(event: PointerEvent): void {
    if (!this.painting) {
      return;
    }
    this.paintAt(event);
  }

  /** Stops painting. */
  onPointerUp(event: PointerEvent): void {
    this.painting = false;
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  /** Prevents the browser context menu on right click. */
  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  /** Paints the selected tile at the canvas position of the pointer event. */
  private paintAt(event: PointerEvent): void {
    const canvas = this.canvasRef()?.nativeElement;
    const room = this.room;
    if (!canvas || !room) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    // Map the click to canvas pixels (the canvas may be CSS-scaled).
    const canvasX = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const canvasY = ((event.clientY - rect.top) / rect.height) * canvas.height;

    const x = Math.floor(canvasX / TILE_SIZE);
    const y = Math.floor(canvasY / TILE_SIZE);
    if (x < 0 || x >= DIMENSION || y < 0 || y >= DIMENSION) {
      return;
    }

    const layer = room.Layers[this.layerIndex];
    if (!layer) {
      return;
    }
    const offset = y * DIMENSION + x;
    if (layer.Tiles[offset] === this.tile) {
      return;
    }

    // Mutate the layer in place and repaint the affected tile.
    layer.Tiles[offset] = this.tile;
    this.tileChanged.emit({ layerIndex: this.layerIndex, x, y, tile: this.tile });
    void this.redraw();
  }
}
