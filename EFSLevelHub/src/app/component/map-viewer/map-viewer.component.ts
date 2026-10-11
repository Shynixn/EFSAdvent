import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ArchiveFile, ExtractedImage, FSALibService } from '../../service/fsalib.service';
import { MapLayoutData, StageData } from '../../entity/fsalib.entity';
import { OpfsCacheService } from '../../service/opfs-cache.service';
import { LoggingService } from '../../service/logging.service';
import { ImageBuffer } from '../../service/render/gba-tile-renderer';
import { RenderOptions, ROOM_PIXELS, StageRenderer } from '../../service/render/stage-renderer';

/**
 * MapViewerComponent
 * ------------------
 * Test component that loads a stage archive from OPFS, parses it through the
 * FSALib browser-wasm module (returning the whole `Stage` entity), and renders
 * the resulting map layout as a grid.
 *
 * It also (for testing) decodes every `.bti` texture in the archive to PNG and
 * lists them below the map.
 *
 * Default path: `GC4Sword_pal/Boss/boss010.arc`; override with the `?path=` query.
 */
@Component({
  selector: 'app-map-viewer',
  templateUrl: './map-viewer.component.html',
  styleUrl: './map-viewer.component.css',
})
export class MapViewerComponent implements OnInit {
  private readonly fsaLib = inject(FSALibService);
  private readonly opfs = inject(OpfsCacheService);
  private readonly logger = inject(LoggingService);
  private readonly route = inject(ActivatedRoute);

  /** Default archive to inspect. */
  static readonly DEFAULT_PATH = 'GC4Sword_pal/Boss/boss010.arc';

  /** Archive that holds the game's shared textures. */
  static readonly DATA_ARC_PATH = 'GC4Sword_pal/data.arc';

  /** Archive that holds the overworld map screen. */
  static readonly OVERWORLD_ARC_PATH = 'GC4Sword_pal/map1.arc';

  /** The overworld map texture inside {@link OVERWORLD_ARC_PATH}. */
  static readonly OVERWORLD_TEXTURE = 'TIMG/kk_worldmap_01.bti';

  /** Template-visible copy of {@link DATA_ARC_PATH}. */
  readonly dataArcPath = MapViewerComponent.DATA_ARC_PATH;

  /** Overworld map image (decoded from map1.arc). */
  readonly overworldUrl = signal<string | null>(null);
  readonly overworldSize = signal<{ width: number; height: number } | null>(null);
  readonly isDecodingOverworld = signal(false);
  readonly overworldError = signal('');

  readonly arcPath = signal(MapViewerComponent.DEFAULT_PATH);
  readonly isLoading = signal(false);
  readonly errorMessage = signal('');
  /** The full parsed Stage entity graph returned from wasm. */
  readonly stageData = signal<StageData | null>(null);
  /** Room index the user last clicked (for a simple highlight/readout). */
  readonly selectedRoom = signal<number | null>(null);

  /** Texture entries found in `data.arc` (metadata only — nothing decoded yet). */
  readonly textures = signal<ArchiveFile[]>([]);
  /** Sort order for the texture list. */
  readonly sortBySizeDesc = signal(true);
  /** Path of the texture the user expanded, or null when none is shown. */
  readonly selectedTexturePath = signal<string | null>(null);
  /** The single decoded texture currently being displayed. */
  readonly selectedImage = signal<ExtractedImage | null>(null);
  readonly isListingTextures = signal(false);
  readonly isDecodingImage = signal(false);
  readonly textureError = signal('');

  /** Raw `data.arc` bytes, cached so decoding on click needs no re-read. */
  private dataArcBytes: Uint8Array | null = null;

  /** PNG data URL of the most recently rendered room. */
  readonly roomRenderUrl = signal<string | null>(null);
  readonly isRenderingRoom = signal(false);
  readonly renderError = signal('');

  /** Stage renderer for the loaded archive, built lazily on first room render. */
  private stageRenderer: StageRenderer | null = null;
  /** Raw stage archive bytes, kept so the renderer can re-read resources. */
  private arcBytes: Uint8Array | null = null;

  ngOnInit(): void {
    const fromQuery = this.route.snapshot.queryParamMap.get('path');
    if (fromQuery) {
      this.arcPath.set(fromQuery);
    }
    void this.loadMap();
    void this.loadTextureList();
    void this.loadOverworld();
  }

  /** The primary map layout from the parsed stage, if available. */
  map(): MapLayoutData | null {
    return this.stageData()?.Map ?? null;
  }

  /** Grid width (rooms) of the primary map. */
  mapWidth(): number {
    return this.stageData()?.Map.XDimension ?? 0;
  }

  /** Grid height (rooms) of the primary map. */
  mapHeight(): number {
    return this.stageData()?.Map.YDimension ?? 0;
  }

  /** Loads the archive from OPFS and parses it with FSALib (wasm). */
  async loadMap(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.stageData.set(null);
    this.selectedRoom.set(null);
    this.roomRenderUrl.set(null);
    this.renderError.set('');
    this.stageRenderer = null;
    this.arcBytes = null;

    const path = this.arcPath();
    try {
      this.logger.info(`MapViewer: reading "${path}" from OPFS…`);
      const bytes = await this.opfs.readExtractedFile(path);
      this.arcBytes = bytes;
      this.logger.info(`MapViewer: read ${bytes.byteLength} bytes; parsing via wasm…`);

      const stage = await this.fsaLib.parseStage(bytes);
      this.stageData.set(stage);
      this.logger.info(
        `MapViewer: parsed stage ${stage.Index} ` +
          `(map ${stage.Map.Index}, ${stage.Map.XDimension}x${stage.Map.YDimension}, ` +
          `${stage.Rooms.filter((r) => r).length} room(s))`,
      );
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Failed to load map.');
      this.logger.error(`MapViewer: failed to load "${path}"`, error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /** Called when the user clicks a room cell. */
  selectRoom(roomIndex: number): void {
    if (roomIndex < 0 || roomIndex === this.emptyRoomValue()) {
      return;
    }
    this.selectedRoom.set(roomIndex);
    void this.renderRoom(roomIndex);
  }

  /**
   * Renders a room with the `StageRenderer` port and exposes the result as a PNG.
   *
   * The renderer is built lazily on first use so the (large) tileset/sprite
   * resources are only read when they're actually needed.
   */
  async renderRoom(roomIndex: number, layerLevel = 0): Promise<void> {
    const stage = this.stageData();
    const bytes = this.arcBytes;
    if (!stage || !bytes) {
      this.renderError.set('Stage is not loaded.');
      return;
    }

    this.isRenderingRoom.set(true);
    this.renderError.set('');

    try {
      if (!this.stageRenderer) {
        this.logger.info('MapViewer: building stage renderer…');
        this.stageRenderer = await this.fsaLib.createStageRenderer(stage, bytes);
      }

      const target = new ImageBuffer(ROOM_PIXELS, ROOM_PIXELS);
      target.fill(0, 0, 0, 255);
      await this.stageRenderer.draw(target, roomIndex, layerLevel, RenderOptions.Layers);
      this.roomRenderUrl.set(this.fsaLib.encodePng(target));
      this.logger.info(`MapViewer: rendered room ${roomIndex} (layer ${layerLevel})`);
    } catch (error) {
      this.renderError.set(error instanceof Error ? error.message : 'Failed to render room.');
      this.logger.error(`MapViewer: failed to render room ${roomIndex}`, error);
    } finally {
      this.isRenderingRoom.set(false);
    }
  }

  /**
   * Returns the room index at (x, y) in the row-major `rooms` array, or the
   * empty-room sentinel when out of range.
   */
  roomAt(x: number, y: number): number {
    const layout = this.map();
    if (!layout) {
      return -1;
    }
    return layout.Rooms[x + y * this.mapWidth()] ?? this.emptyRoomValue();
  }

  /** The empty-room sentinel reported by wasm. */
  emptyRoomValue(): number {
    return this.stageData()?.Map.EmptyRoomValue ?? -1;
  }

  /** True if the cell at (x, y) is empty (no room). */
  isEmpty(x: number, y: number): boolean {
    return this.roomAt(x, y) === this.emptyRoomValue();
  }

  /** True if the cell is the map's start room. */
  isStart(x: number, y: number): boolean {
    const layout = this.map();
    return !!layout && x === layout.StartX && y === layout.StartY;
  }

  /** Row index helper for the template (*ngFor over a computed range). */
  range(count: number): number[] {
    return Array.from({ length: count }, (_, i) => i);
  }

  /**
   * Loads `map1.arc` and decodes the overworld map texture.
   *
   * The archive is parsed by FSALib (via the wasm `ReadArchiveFile` export) and
   * the `kk_worldmap_01.bti` texture is decoded with the format-aware pipeline.
   */
  async loadOverworld(): Promise<void> {
    this.isDecodingOverworld.set(true);
    this.overworldError.set('');
    this.overworldUrl.set(null);
    this.overworldSize.set(null);

    try {
      const bytes = await this.opfs.readExtractedFile(MapViewerComponent.OVERWORLD_ARC_PATH);
      this.logger.info(`MapViewer: map1.arc is ${bytes.byteLength} bytes; decoding overworld…`);

      const image = await this.fsaLib.decodeArchiveTexture(
        bytes,
        MapViewerComponent.OVERWORLD_TEXTURE,
      );
      this.overworldUrl.set(this.fsaLib.encodePng(image));
      this.overworldSize.set({ width: image.width, height: image.height });
      this.logger.info(`MapViewer: decoded overworld (${image.width}x${image.height})`);
    } catch (error) {
      this.overworldError.set(
        error instanceof Error ? error.message : 'Failed to decode the overworld map.',
      );
      this.logger.error('MapViewer: failed to decode the overworld map', error);
    } finally {
      this.isDecodingOverworld.set(false);
    }
  }

  /**
   * Loads `data.arc` from OPFS and lists the metadata of every `.bti` texture
   * in it. No texture data is read or decoded here — that happens on click.
   */
  async loadTextureList(): Promise<void> {
    this.isListingTextures.set(true);
    this.textureError.set('');
    this.textures.set([]);
    this.clearTexture();

    try {
      const bytes = await this.opfs.readExtractedFile(MapViewerComponent.DATA_ARC_PATH);
      this.dataArcBytes = bytes;
      this.logger.info(`MapViewer: data.arc is ${bytes.byteLength} bytes; listing archive…`);

      const textures = await this.fsaLib.listTextures(bytes);
      this.textures.set(textures);
      this.logger.info(`MapViewer: found ${textures.length} texture(s)`);
    } catch (error) {
      this.textureError.set(error instanceof Error ? error.message : 'Failed to list textures.');
      this.logger.error('MapViewer: failed to list textures', error);
    } finally {
      this.isListingTextures.set(false);
    }
  }

  /** Textures in the currently selected sort order. */
  sortedTextures(): ArchiveFile[] {
    const list = [...this.textures()];
    return this.sortBySizeDesc()
      ? list.sort((a, b) => b.Size - a.Size)
      : list.sort((a, b) => a.Path.localeCompare(b.Path));
  }

  /** Flips between largest-first and alphabetical ordering. */
  toggleTextureSort(): void {
    this.sortBySizeDesc.update((v) => !v);
  }

  /** Formats a byte count as a compact human-readable string. */
  formatBytes(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KiB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  }

  /**
   * Toggles a texture in the preview. The `.bti` is only read, decoded and
   * encoded to PNG the first time it is shown, then cached on the component.
   */
  async toggleTexture(path: string): Promise<void> {
    if (this.selectedTexturePath() === path) {
      this.clearTexture();
      return;
    }

    if (!this.dataArcBytes) {
      this.textureError.set('data.arc is not loaded.');
      return;
    }

    this.selectedTexturePath.set(path);
    this.selectedImage.set(null);
    this.isDecodingImage.set(true);
    this.textureError.set('');

    try {
      const image = await this.fsaLib.decodeImage(this.dataArcBytes, path);
      // Guard against the user clicking another texture while this one decoded.
      if (this.selectedTexturePath() === path) {
        this.selectedImage.set(image);
      }
      this.logger.info(`MapViewer: decoded "${path}" (${image.width}x${image.height})`);
    } catch (error) {
      this.textureError.set(error instanceof Error ? error.message : 'Failed to decode texture.');
      this.logger.error(`MapViewer: failed to decode "${path}"`, error);
    } finally {
      this.isDecodingImage.set(false);
    }
  }

  /** Hides and releases the current texture preview. */
  clearTexture(): void {
    this.selectedTexturePath.set(null);
    this.selectedImage.set(null);
    this.textureError.set('');
  }
}
