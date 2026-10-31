import { Injectable, signal } from '@angular/core';

/**
 * A copied room, remembering which stage it came from so it can be pasted into
 * a different stage.
 */
export interface RoomClipboardEntry {
  /** Stage the room was copied from. */
  stageId: string;
  /** Room index inside that stage. */
  roomIndex: number;
}

/**
 * RoomClipboardService
 * --------------------
 * In-memory clipboard for the map grid's Copy/Paste actions.
 *
 * Rooms are not copied as bytes: the entry only records *where* the room lives,
 * and the paste re-reads it from that stage's archive. This keeps the clipboard
 * tiny and — importantly — allows pasting into a **different** stage, since the
 * source archive is resolved by id at paste time.
 *
 * The clipboard is intentionally not persisted: a stale reference after a
 * reload would point at a room the user no longer has open.
 */
@Injectable({ providedIn: 'root' })
export class RoomClipboardService {
  private readonly entry = signal<RoomClipboardEntry | null>(null);

  /** The copied room, or null when nothing has been copied. */
  readonly copiedRoom = this.entry.asReadonly();

  /** Records a copied room. */
  copy(stageId: string, roomIndex: number): void {
    this.entry.set({ stageId, roomIndex });
  }

  /** Clears the clipboard. */
  clear(): void {
    this.entry.set(null);
  }

  /**
   * Whether the clipboard holds a room other than the given one — used to hide
   * the Paste action when it would copy a room onto itself.
   */
  canPasteInto(stageId: string, cellRoom: number | null): boolean {
    const copied = this.entry();
    if (!copied) {
      return false;
    }
    return !(copied.stageId === stageId && copied.roomIndex === cellRoom);
  }
}
