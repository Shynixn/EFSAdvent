import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import {
  RoomCanvasComponent,
  RoomGroundChange,
  RoomTileChange,
} from '../room-canvas/room-canvas.component';
import { DIMENSION, isCroppedLayer, roomCanvasTilesH } from '../room-canvas/room-canvas.layout';
import { RoomData } from '../../entity/fsalib.entity';
import { StageRenderer } from '../../service/render/stage-renderer';
import { GroundLayer } from '../../entity/ground.entity';
import {
  SmartObjectPlacement,
  findSmartObjectDefinition,
  flattenPlacements,
  placementToActor,
  smartObjectBounds,
  warpLinks,
} from '../../entity/smartobject.entity';
import type { ActivationLink } from '../../entity/smartobject/activation.entity';

/** How many base layers a room has (0-7). */
export const BASE_LAYER_COUNT = 8;

/** Colours used for warp link lines, cycled by warp type. */
const WARP_COLORS = [
  '#38bdf8',
  '#a78bfa',
  '#f472b6',
  '#fb923c',
  '#facc15',
  '#4ade80',
  '#22d3ee',
  '#f87171',
];

/**
 * RoomLayersComponent
 * -------------------
 * The room editor's stacked layer view. Instead of showing a single base layer
 * at a time, it renders **every base layer (0-7)** as its own always-open
 * section, one after another, so the whole room can be reviewed at a glance.
 *
 * Each section embeds a {@link RoomCanvasComponent} bound to that base layer,
 * and **every** section is fully editable (brush, eraser, hand, context menu,
 * drag & drop). Each section only shows its own layer's actor markers.
 *
 * A single absolutely-positioned overlay canvas sits on top of the whole stack
 * and draws **warp links** — a line from each `WARP` actor to its teleport
 * destination. The destination carries its own base layer, so a link frequently
 * crosses sections; because the overlay spans the whole stack, such a link is
 * drawn as one continuous line.
 *
 * @example
 * <app-room-layers
 *   [room]="room()"
 *   [index]="roomIndex()"
 *   [renderer]="renderer()"
 *   [smartObjects]="smartObjects()"
 *   (tileChanged)="onTileChanged($event)"
 * />
 */
@Component({
  selector: 'app-room-layers',
  imports: [RoomCanvasComponent],
  templateUrl: './room-layers.component.html',
  host: { class: 'block' },
})
export class RoomLayersComponent implements AfterViewInit, OnDestroy {
  /** The room to edit. */
  @Input() room: RoomData | null = null;
  /** Room index within the stage (needed to draw it). */
  @Input() index = -1;
  /** The stage renderer used to draw every layer. */
  @Input() renderer: StageRenderer | null = null;

  /** When true the GBA tileset/layers are drawn (layer level 1). */
  @Input() gba = false;
  /** Whether each section composites its paired top layer over the base layer. */
  @Input() topLayer = true;
  /** Whether painting targets the top layer instead of the base layer. */
  @Input() paintTop = false;
  /** Tile value painted by the brush. */
  @Input() tile = 0;
  /** Active tool (`brush` paints, `eraser` clears, `hand` moves objects). */
  @Input() tool: 'brush' | 'hand' | 'eraser' = 'hand';

  private _smartObjects: SmartObjectPlacement[] = [];
  /** Smart objects placed in this room (rendered + hit-tested per section). */
  @Input()
  get smartObjects(): SmartObjectPlacement[] {
    return this._smartObjects;
  }
  set smartObjects(value: SmartObjectPlacement[]) {
    this._smartObjects = value ?? [];
    queueMicrotask(() => this.drawWarpOverlay());
  }

  /** Actor placements that mark pre-existing (legacy) actors — red-bordered. */
  @Input() legacyActors: SmartObjectPlacement[] = [];

  private _groundLayers: GroundLayer[] = [];
  /** Ground layers painted in this room (drawn under each base layer's tiles). */
  @Input()
  get groundLayers(): GroundLayer[] {
    return this._groundLayers;
  }
  set groundLayers(value: GroundLayer[]) {
    this._groundLayers = value ?? [];
  }

  /** Ground tile painted by the brush (0 when no ground selected). */
  @Input() groundTile = 0;
  /** Whether the brush paints ground. */
  @Input() groundMode = false;

  /** Emits each tile edit as it is painted. */
  @Output() tileChanged = new EventEmitter<RoomTileChange>();
  /** Emits each ground edit as it is painted. */
  @Output() groundChanged = new EventEmitter<RoomGroundChange>();
  /** Emits when a decoration (smart object) is dropped onto the canvas. */
  @Output() decorationPlaced = new EventEmitter<SmartObjectPlacement>();
  /** Emits when a placed decoration is moved (re-stamped at a new anchor). */
  @Output() decorationMoved = new EventEmitter<{
    from: SmartObjectPlacement;
    to: SmartObjectPlacement;
  }>();
  /** Emits when a placed decoration is deleted from the context menu. */
  @Output() decorationDeleted = new EventEmitter<SmartObjectPlacement>();
  /** Emits when a placed decoration is rotated to the next variant. */
  @Output() decorationRotated = new EventEmitter<{
    from: SmartObjectPlacement;
    to: SmartObjectPlacement;
  }>();

  /** Emits when a placement's recorded data changes without moving it. */
  @Output() placementUpdated = new EventEmitter<{
    from: SmartObjectPlacement;
    to: SmartObjectPlacement;
  }>();

  /** Persisted activation links for this room (drawn on every layer canvas). */
  @Input() activationLinks: readonly ActivationLink[] = [];

  /** Emits when the user links an activation source to a target. */
  @Output() activationLinked = new EventEmitter<{
    source: SmartObjectPlacement;
    target: SmartObjectPlacement;
  }>();

  /** Emits the placement whose activation links should be removed. */
  @Output() activationUnlinked = new EventEmitter<SmartObjectPlacement>();

  /** Emits when a **legacy** actor is deleted from the context menu. */
  @Output() legacyDeleted = new EventEmitter<SmartObjectPlacement>();

  /** Emits when a **legacy** actor is moved with the hand tool. */
  @Output() legacyMoved = new EventEmitter<{
    from: SmartObjectPlacement;
    to: SmartObjectPlacement;
  }>();

  /** The overlay `<canvas>` for the cross-layer warp lines. */
  private readonly warpCanvas = viewChild<ElementRef<HTMLCanvasElement>>('warpOverlay');
  /** The stack container the overlay spans (its offset parent). */
  private readonly stackRef = viewChild<ElementRef<HTMLElement>>('stack');
  /** All embedded per-layer canvases, in template order (base layer 0-7). */
  private readonly canvases = viewChildren(RoomCanvasComponent);

  /** Base layer indices (0-7) rendered as always-open sections. */
  readonly baseLayers = Array.from({ length: BASE_LAYER_COUNT }, (_, index) => index);

  /** Keeps the warp overlay sized/aligned with the (responsive) stack. */
  private resizeObserver: ResizeObserver | null = null;
  /** Repaints the warp lines on window resize/scroll while the view is up. */
  private readonly onViewportChange = (): void => this.drawWarpOverlay();

  /**
   * The door a connect drag started from, or null. A connect drag is owned by
   * the door's own canvas but **drawn here**: the line may have to leave that
   * canvas entirely to reach a door in another layer's section.
   */
  private connectSource: SmartObjectPlacement | null = null;
  /** Pointer position (viewport CSS px) while a connect drag is running. */
  private connectPointer: { x: number; y: number } | null = null;
  /** Door under the pointer during a connect drag (any layer), if any. */
  private connectTarget: SmartObjectPlacement | null = null;
  /** Repaints the cross-layer connect line (bound window-wide while dragging). */
  private readonly onConnectPointerMove = (event: PointerEvent): void => {
    if (!this.connectSource) {
      return;
    }
    this.connectPointer = { x: event.clientX, y: event.clientY };
    this.connectTarget = this.doorAt(event.clientX, event.clientY);
    this.drawConnectOverlay();
  };
  /** Re-routes the line when the stack scrolls/resizes mid-drag. */
  private readonly onConnectLayoutChange = (): void => this.drawConnectOverlay();

  ngAfterViewInit(): void {
    queueMicrotask(() => {
      this.sizeOverlay();
      this.drawWarpOverlay();
      this.registerDoorResolvers();
    });
    const stack = this.stackRef()?.nativeElement;
    if (stack && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.sizeOverlay();
        this.drawWarpOverlay();
        this.drawConnectOverlay();
      });
      this.resizeObserver.observe(stack);
    }
    window.addEventListener('resize', this.onViewportChange);
    window.addEventListener('scroll', this.onViewportChange, true);
  }

  /** Re-renders every layer canvas plus the warp overlay (e.g. after a theme change). */
  redrawAll(): void {
    for (const canvas of this.canvases()) {
      void canvas.redraw();
    }
    queueMicrotask(() => {
      this.sizeOverlay();
      this.drawWarpOverlay();
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this.onViewportChange);
    window.removeEventListener('scroll', this.onViewportChange, true);
    this.stopConnectTracking();
    for (const canvas of this.canvases()) {
      canvas.resolveDoor = null;
    }
  }

  /** Matches the overlay's backing store to the stack's CSS size. */
  private sizeOverlay(): void {
    const canvas = this.warpCanvas()?.nativeElement;
    const stack = this.stackRef()?.nativeElement;
    if (!canvas || !stack) {
      return;
    }
    const rect = stack.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
  }

  /**
   * Registers this stack's cross-layer door resolver on every room canvas, so a
   * connect drag that is released over ANOTHER layer's canvas still finds the
   * door under the pointer (the source canvas only knows its own layer).
   */
  private registerDoorResolvers(): void {
    for (const canvas of this.canvases()) {
      canvas.resolveDoor = (clientX, clientY) => this.doorAt(clientX, clientY);
    }
  }

  /**
   * Finds the door under a page-wide pointer position, across **all** layers.
   *
   * Every room canvas is asked in turn; the first one containing the pointer is
   * the layer section the user is over, and it resolves the door on its own
   * base layer. This is what makes connecting cross layers.
   */
  private doorAt(clientX: number, clientY: number): SmartObjectPlacement | null {
    for (const canvas of this.canvases()) {
      const door = canvas.doorAtViewport(clientX, clientY);
      if (door) {
        return door;
      }
    }
    return null;
  }

  /** Whether a connect drag is in progress (drawn on the stack overlay). */
  readonly connecting = signal(false);

  /**
   * Called by a room canvas when its connect drag starts (`true`) or ends
   * (`false`).
   *
   * The drag itself lives in the canvas, but the line is drawn on this stack's
   * overlay from the SOURCE door's section to the pointer — so it can cross into
   * other layer sections instead of being trapped inside one canvas.
   */
  onConnectDragChanged(active: boolean): void {
    if (active) {
      this.connectSource = this.findConnectingSource();
      this.connectPointer = null;
      this.connectTarget = null;
      this.connecting.set(this.connectSource !== null);
      if (!this.connectSource) {
        return;
      }
      window.addEventListener('pointermove', this.onConnectPointerMove);
      window.addEventListener('scroll', this.onConnectLayoutChange, true);
      window.addEventListener('resize', this.onConnectLayoutChange);
      this.drawConnectOverlay();
      return;
    }
    this.stopConnectTracking();
  }

  /** Stops the cross-layer connect overlay and clears it. */
  private stopConnectTracking(): void {
    window.removeEventListener('pointermove', this.onConnectPointerMove);
    window.removeEventListener('scroll', this.onConnectLayoutChange, true);
    window.removeEventListener('resize', this.onConnectLayoutChange);
    this.connectSource = null;
    this.connectPointer = null;
    this.connectTarget = null;
    this.connecting.set(false);
    this.drawConnectOverlay();
  }

  /**
   * The door whose canvas just started a connect drag.
   *
   * The canvas emits the change after setting its own `connectingFrom`, so the
   * source is simply the first canvas reporting one.
   */
  private findConnectingSource(): SmartObjectPlacement | null {
    for (const canvas of this.canvases()) {
      const source = canvas.connectingFrom();
      if (source) {
        return source;
      }
    }
    return null;
  }

  /**
   * Paints the cross-layer connect line over the stack's overlay: from the
   * source door's centre (in its own section) to the pointer, with a green
   * outline around a hovered target door — wherever that door lives.
   *
   * The overlay is shared with the warp links, so the links are redrawn first
   * and the connect line painted on top.
   */
  private drawConnectOverlay(): void {
    this.drawWarpOverlay();
    const canvas = this.warpCanvas()?.nativeElement;
    const ctx = canvas?.getContext('2d');
    const source = this.connectSource;
    const pointer = this.connectPointer;
    const stack = this.stackRef()?.nativeElement;
    if (!canvas || !ctx || !source || !pointer || !stack) {
      return;
    }
    const stackRect = stack.getBoundingClientRect();
    if (stackRect.width === 0 || stackRect.height === 0) {
      return;
    }
    const scaleX = canvas.width / stackRect.width;
    const scaleY = canvas.height / stackRect.height;

    // Source door's centre, resolved in its own layer section.
    const sourceDefinition = findSmartObjectDefinition(source.id);
    if (!sourceDefinition) {
      return;
    }
    const sourceBounds = smartObjectBounds(sourceDefinition, source.variantIndex ?? 0);
    const sourceLayer = source.baseLayerId ?? 0;
    const from = this.tileCentre(
      sourceLayer,
      source.anchorRow + Math.floor(sourceBounds.rows / 2),
      source.anchorCol + Math.floor(sourceBounds.cols / 2),
    );
    if (!from) {
      return;
    }

    // End point: snap to a hovered target door's centre, else follow the pointer.
    let to = {
      x: (pointer.x - stackRect.left) * scaleX,
      y: (pointer.y - stackRect.top) * scaleY,
    };
    const target = this.connectTarget;
    if (target && target !== source) {
      const targetDefinition = findSmartObjectDefinition(target.id);
      if (targetDefinition) {
        const bounds = smartObjectBounds(targetDefinition, target.variantIndex ?? 0);
        const centre = this.tileCentre(
          target.baseLayerId ?? 0,
          target.anchorRow + Math.floor(bounds.rows / 2),
          target.anchorCol + Math.floor(bounds.cols / 2),
        );
        if (centre) {
          to = centre;
          this.strokeOverlayBox(ctx, target, bounds.cols, bounds.rows, '#22c55e');
        }
      }
    }

    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();

    // Marker at the source end.
    ctx.beginPath();
    ctx.arc(from.x, from.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
  }

  /** Outlines a placement's footprint on the stack overlay (green target box). */
  private strokeOverlayBox(
    ctx: CanvasRenderingContext2D,
    placement: SmartObjectPlacement,
    cols: number,
    rows: number,
    color: string,
  ): void {
    const layer = placement.baseLayerId ?? 0;
    const topLeft = this.tileCentre(layer, placement.anchorRow, placement.anchorCol);
    const tile = this.tileSize(layer);
    if (!topLeft || !tile) {
      return;
    }
    // `tileCentre` returns the tile's CENTRE, so shift back by half a tile.
    const x = topLeft.x - tile.w / 2;
    const y = topLeft.y - tile.h / 2;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(x + 0.5, y + 0.5, cols * tile.w - 1, rows * tile.h - 1);
    ctx.restore();
  }

  /** Size of one tile on a layer's canvas, in overlay backing-store pixels. */
  private tileSize(layer: number): { w: number; h: number } | null {
    const canvas = this.warpCanvas()?.nativeElement;
    const stack = this.stackRef()?.nativeElement;
    const element = this.canvases()[layer]?.canvasElement();
    if (!canvas || !stack || !element) {
      return null;
    }
    const stackRect = stack.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    if (stackRect.width === 0 || rect.width === 0) {
      return null;
    }
    return {
      w: (rect.width / DIMENSION) * (canvas.width / stackRect.width),
      h:
        (rect.height / roomCanvasTilesH(isCroppedLayer(layer))) *
        (canvas.height / stackRect.height),
    };
  }

  /** Centre of a tile of a layer's section, in overlay backing-store pixels. */
  private tileCentre(layer: number, row: number, col: number): { x: number; y: number } | null {
    const canvas = this.warpCanvas()?.nativeElement;
    const stack = this.stackRef()?.nativeElement;
    const element = this.canvases()[layer]?.canvasElement();
    if (!canvas || !stack || !element) {
      return null;
    }
    const stackRect = stack.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    if (stackRect.width === 0 || stackRect.height === 0 || rect.width === 0) {
      return null;
    }
    const scaleX = canvas.width / stackRect.width;
    const scaleY = canvas.height / stackRect.height;
    const tileW = rect.width / DIMENSION;
    const tileH = rect.height / roomCanvasTilesH(isCroppedLayer(layer));
    return {
      x: (rect.left - stackRect.left + (col + 0.5) * tileW) * scaleX,
      y: (rect.top - stackRect.top + (row + 0.5) * tileH) * scaleY,
    };
  }

  /** Ground tiles for a given base layer (or null when none is painted). */
  groundFor(baseLayerId: number): number[] | null {
    const layer = this._groundLayers.find((entry) => entry.baseLayerId === baseLayerId);
    return layer ? layer.bottomLayerTiles : null;
  }

  /**
   * Whether a base layer's canvas is cropped to the TV view (24 of 32 rows).
   *
   * Only the **Main Layer** (0) is cropped like the game; the **Dark World**
   * (1) and the **Gameboy layers** (2-7) render the full 32×32 grid.
   */
  isCropped(base: number): boolean {
    return isCroppedLayer(base);
  }

  /**
   * Human-readable name of a base layer: layer 0 is the **Main Layer**, layer 1
   * is the **Dark World**, and 2-7 are the **Gameboy Layer 1-6** (counted from 1).
   */
  layerName(index: number): string {
    if (index === 0) {
      return 'Main Layer';
    }
    if (index === 1) {
      return 'Dark World';
    }
    return `Gameboy Layer ${index - 1}`;
  }

  /**
   * Redraws the cross-layer warp overlay: one line per `WARP` actor, running
   * from the warp's tile to its destination tile (which may be in another base
   * layer's section).
   */
  drawWarpOverlay(): void {
    const canvas = this.warpCanvas()?.nativeElement;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const container = canvas.parentElement;
    if (!container) {
      return;
    }
    const containerRect = container.getBoundingClientRect();
    if (containerRect.width === 0 || containerRect.height === 0) {
      return;
    }
    const scaleX = canvas.width / containerRect.width;
    const scaleY = canvas.height / containerRect.height;

    /** Centre of a tile within a section's canvas, in overlay pixels. */
    const centreOf = (layer: number, row: number, col: number): { x: number; y: number } | null => {
      const element = this.canvases()[layer]?.canvasElement();
      if (!element) {
        return null;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return null;
      }
      // The canvas is cropped for the Main Layer (24 rows) and full for every
      // other layer (32 rows), so the tile height must come from the layer.
      const tileW = rect.width / DIMENSION;
      const tileH = rect.height / roomCanvasTilesH(isCroppedLayer(layer));
      const x = rect.left - containerRect.left + (col + 0.5) * tileW;
      const y = rect.top - containerRect.top + (row + 0.5) * tileH;
      return { x: x * scaleX, y: y * scaleY };
    };

    for (const link of warpLinks(this.actorRecords())) {
      const from = centreOf(link.fromLayer, link.fromRow, link.fromCol);
      const to = centreOf(link.toLayer, link.toRow, link.toCol);
      if (!from || !to) {
        continue;
      }
      const color = WARP_COLORS[Math.abs(link.type) % WARP_COLORS.length];
      this.drawWarpLink(ctx, from, to, color, link.fromLayer !== link.toLayer);
    }
  }

  /** The actor records for this room, derived from its actor-baked placements. */
  private actorRecords(): { Id: string; Layer: number; X: number; Y: number; Variable: number }[] {
    const actors: { Id: string; Layer: number; X: number; Y: number; Variable: number }[] = [];
    for (const placement of flattenPlacements(this._smartObjects)) {
      if (findSmartObjectDefinition(placement.id)?.baking !== 'actor') {
        continue;
      }
      actors.push(placementToActor(placement));
    }
    return actors;
  }

  /** Strokes a single warp link (dashed when it crosses base layers). */
  private drawWarpLink(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    color: string,
    crossLayer: boolean,
  ): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(crossLayer ? [6, 4] : []);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    // Markers at both ends so the endpoints stay readable over busy tiles.
    for (const point of [from, to]) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.restore();
  }
}
