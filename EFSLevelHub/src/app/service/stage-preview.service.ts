import { Injectable, inject } from '@angular/core';
import { EditorService } from './editor.service';
import { FSALibService } from './fsalib.service';
import { LoggingService } from './logging.service';
import { StageData } from '../entity/fsalib.entity';
import { ImageBuffer } from './render/gba-tile-renderer';
import { RenderOptions, VISIBLE_ROOM_HEIGHT, VISIBLE_ROOM_WIDTH } from './render/stage-renderer';

/** Builds the relative `/editor` path of a stage's room preview PNG. */
export function stageRoomPreviewPath(stageId: string, roomIndex: number): string {
  return `cache/image/${stageId}/room_${roomIndex}.png`;
}

/** Builds the relative `/editor` path of a stage's concatenated thumbnail PNG. */
export function stageThumbnailPath(stageId: string): string {
  return `cache/image/${stageId}/thumbnail.png`;
}

/** Builds the relative `/editor` path of a cached tileset preview PNG. */
export function tilesetPreviewPath(tilesetIndex: number): string {
  return `cache/image/tileset_${tilesetIndex}.png`;
}

/** Progress reported while generating a stage's preview images. */
export interface PreviewProgress {
  /** Number of rooms rendered so far. */
  done: number;
  /** Total rooms to render. */
  total: number;
  /** Human-readable status message. */
  message: string;
}

/**
 * StagePreviewService
 * -------------------
 * Renders and caches a stage's per-room preview images and a concatenated
 * thumbnail, all under `/editor/cache/image/<stageId>/`.
 *
 * Rendering happens on the main thread (the pixel work is CPU-bound and
 * synchronous). Generation is lazy and idempotent: when every room preview plus
 * the thumbnail already exist, nothing is regenerated. Room previews drop the
 * bottom band the game hides (the TV crop); the thumbnail lays the rooms out in
 * the map's row-major grid.
 */
@Injectable({ providedIn: 'root' })
export class StagePreviewService {
  private readonly editor = inject(EditorService);
  private readonly fsaLib = inject(FSALibService);
  private readonly logger = inject(LoggingService);

  /**
   * Ensures the stage's preview images exist, generating any that are missing.
   *
   * @param stageId    Stage id (the cache folder name).
   * @param stage      Parsed stage graph.
   * @param arcBytes   Raw stage archive bytes (for resource lookups).
   * @param onProgress Optional progress callback.
   * @param force      Regenerate even when cached (e.g. after a theme change).
   * @returns `true` when images were generated, `false` when already present.
   */
  async ensurePreviews(
    stageId: string,
    stage: StageData,
    arcBytes: Uint8Array,
    onProgress?: (progress: PreviewProgress) => void,
    force = false,
  ): Promise<boolean> {
    const layout = stage.Map;
    const cols = layout.XDimension;
    const rows = layout.YDimension;

    // Collect the non-empty rooms in row-major order (their grid positions).
    const cells: { roomIndex: number; x: number; y: number }[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const roomIndex = layout.Rooms[x + y * cols];
        if (roomIndex == null || roomIndex === layout.EmptyRoomValue) {
          continue;
        }
        cells.push({ roomIndex, x, y });
      }
    }

    // Skip entirely when everything (rooms + thumbnail) already exists.
    if (
      !force &&
      (await this.allPreviewsExist(
        stageId,
        cells.map((c) => c.roomIndex),
      ))
    ) {
      this.logger.info(`StagePreview: previews for "${stageId}" already cached.`);
      return false;
    }

    const renderer = await this.fsaLib.createStageRenderer(stage, arcBytes);

    // Thumbnail canvas: one visible room per cell.
    const thumbnail = new ImageBuffer(cols * VISIBLE_ROOM_WIDTH, rows * VISIBLE_ROOM_HEIGHT);
    thumbnail.fill(0, 0, 0, 0);

    const room = new ImageBuffer(VISIBLE_ROOM_WIDTH, VISIBLE_ROOM_HEIGHT);

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      onProgress?.({
        done: i,
        total: cells.length,
        message: `Rendering room ${cell.roomIndex} (${i + 1}/${cells.length})…`,
      });

      // Render into a VISIBLE_ROOM_HEIGHT-tall buffer: the renderer's writes to
      // the cropped-away rows are simply skipped, dropping the game's hidden
      // bottom band.
      room.fill(0, 0, 0, 255);
      await renderer.draw(room, cell.roomIndex, 0, RenderOptions.Layers);

      await this.editor.writeEditorFile(
        stageRoomPreviewPath(stageId, cell.roomIndex),
        this.pngBytes(room),
      );

      thumbnail.blendFrom(room, cell.x * VISIBLE_ROOM_WIDTH, cell.y * VISIBLE_ROOM_HEIGHT);
    }

    onProgress?.({ done: cells.length, total: cells.length, message: 'Writing thumbnail…' });

    // Trim the transparent margins: the map grid is sparse (few occupied cells
    // in a large layout), so crop the thumbnail to the occupied bounding box.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cell of cells) {
      minX = Math.min(minX, cell.x);
      minY = Math.min(minY, cell.y);
      maxX = Math.max(maxX, cell.x);
      maxY = Math.max(maxY, cell.y);
    }
    const trimmed =
      cells.length > 0
        ? thumbnail.cropRect(
            minX * VISIBLE_ROOM_WIDTH,
            minY * VISIBLE_ROOM_HEIGHT,
            (maxX - minX + 1) * VISIBLE_ROOM_WIDTH,
            (maxY - minY + 1) * VISIBLE_ROOM_HEIGHT,
          )
        : thumbnail;

    await this.editor.writeEditorFile(stageThumbnailPath(stageId), this.pngBytes(trimmed));

    this.logger.info(
      `StagePreview: generated ${cells.length} room preview(s) + thumbnail for "${stageId}".`,
    );
    return true;
  }

  /** Reads a cached thumbnail as a blob URL, or null when it does not exist. */
  async readThumbnailUrl(stageId: string): Promise<string | null> {
    return this.readImageUrl(stageThumbnailPath(stageId));
  }

  /**
   * Generates and caches a preview PNG for every tileset, once.
   *
   * Tileset graphics and palettes all live in `data.arc` (a stage archive never
   * carries them), so this only needs the game files and runs right after ISO
   * import. Existing previews are skipped, so re-running is cheap. Failures are
   * non-fatal and logged.
   *
   * @param tilesetIndices Indices to render (defaults to the full 0–27 range).
   * @param onProgress     Optional progress callback (done, total).
   * @returns The number of previews generated.
   */
  async ensureTilesetPreviews(
    tilesetIndices: number[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<number> {
    const empty = new Uint8Array(0);
    let generated = 0;

    for (let i = 0; i < tilesetIndices.length; i++) {
      const index = tilesetIndices[i];
      onProgress?.(i, tilesetIndices.length);

      if (await this.editor.hasEditorFile(tilesetPreviewPath(index))) {
        continue;
      }

      try {
        const dataUrl = await this.fsaLib.renderTilesetPreview(index, empty);
        if (!dataUrl) {
          continue;
        }
        await this.editor.writeEditorFile(tilesetPreviewPath(index), this.dataUrlToBytes(dataUrl));
        generated++;
      } catch (error) {
        this.logger.warn(`StagePreview: failed to render tileset ${index} preview`, error);
      }
    }

    onProgress?.(tilesetIndices.length, tilesetIndices.length);
    this.logger.info(`StagePreview: cached ${generated} tileset preview(s).`);
    return generated;
  }

  /** Reads a cached tileset preview as a blob URL, or null when missing. */
  async readTilesetPreviewUrl(tilesetIndex: number): Promise<string | null> {
    return this.readImageUrl(tilesetPreviewPath(tilesetIndex));
  }
  /** Reads a cached room preview as a blob URL, or null when it does not exist. */
  async readRoomPreviewUrl(stageId: string, roomIndex: number): Promise<string | null> {
    return this.readImageUrl(stageRoomPreviewPath(stageId, roomIndex));
  }

  /** Reads a cached PNG under `/editor` as a blob URL, or null when missing. */
  private async readImageUrl(relativePath: string): Promise<string | null> {
    const bytes = await this.editor.readEditorFile(relativePath);
    if (!bytes) {
      return null;
    }
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'image/png' });
    return URL.createObjectURL(blob);
  }

  /** Whether every room preview and the thumbnail already exist. */
  private async allPreviewsExist(stageId: string, roomIndices: number[]): Promise<boolean> {
    for (const roomIndex of roomIndices) {
      if (!(await this.editor.hasEditorFile(stageRoomPreviewPath(stageId, roomIndex)))) {
        return false;
      }
    }
    return this.editor.hasEditorFile(stageThumbnailPath(stageId));
  }

  /** Encodes an image buffer as raw PNG bytes (strips the data-URL prefix). */
  private pngBytes(image: ImageBuffer): Uint8Array {
    return this.dataUrlToBytes(this.fsaLib.encodePng(image));
  }

  /** Decodes a `data:image/png;base64,…` URL into raw bytes. */
  private dataUrlToBytes(dataUrl: string): Uint8Array {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
