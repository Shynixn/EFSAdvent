import { Injectable, computed, signal } from '@angular/core';
import { DirtyLayer } from './stage-editor.service';

/** Key identifying a room layer within the currently open room. */
function layerKey(roomIndex: number, layerIndex: number): string {
  return `${roomIndex}:${layerIndex}`;
}

/**
 * StageRoomService
 * ----------------
 * Tracks which room (if any) is currently open in the stage page's embedded
 * room editor.
 *
 * The room editor is *not* a route: it is shown instead of the map grid within
 * the stage page. Making it route-driven would recreate the whole page on every
 * open/close (a visible full-screen flash), so the selection lives here as plain
 * shared state instead. The side nav reads/writes it directly, so clicking a
 * nested room still opens the editor without any navigation.
 *
 * State is keyed by stage id so switching between open stage tabs preserves
 * each stage's open room independently. Only the *active* stage's value is
 * consumed by the UI.
 */
@Injectable({ providedIn: 'root' })
export class StageRoomService {
  /** Currently open room index per stage id. */
  private readonly rooms = signal<Record<string, number>>({});

  /** The stage id whose selection is currently relevant (set by the stage page). */
  private readonly activeStage = signal('');

  /** The stage id whose room selection is currently on screen. */
  readonly activeStageId = this.activeStage.asReadonly();

  /** Whether the open room editor has unsaved edits (mirrored from it). */
  private readonly roomDirty = signal(false);

  /** Whether the currently open room has unsaved edits. */
  readonly dirty = this.roomDirty.asReadonly();

  /** Room layers edited since the last save (keyed `roomIndex:layerIndex`). */
  private readonly dirtyLayerMap = signal<Record<string, DirtyLayer>>({});

  /** Edited room layers that should be written when saving. */
  readonly dirtyLayers = computed<DirtyLayer[]>(() =>
    Object.values(this.dirtyLayerMap()).sort(
      (a, b) => a.roomIndex - b.roomIndex || a.layerIndex - b.layerIndex,
    ),
  );

  /** Records that a room layer was edited (so save writes it back). */
  markLayerDirty(roomIndex: number, layerIndex: number): void {
    this.dirtyLayerMap.update((layers) => ({
      ...layers,
      [layerKey(roomIndex, layerIndex)]: { roomIndex, layerIndex },
    }));
  }

  /** Clears all pending layer edits (after a successful save). */
  clearDirtyLayers(): void {
    this.dirtyLayerMap.set({});
    this.dirtyActorRooms.set(new Set());
  }

  /** Room indices whose actor list changed since the last save. */
  private readonly dirtyActorRooms = signal<Set<number>>(new Set());

  /** Room indices whose actors should be written when saving. */
  readonly dirtyActorRoomIndices = computed<number[]>(() =>
    [...this.dirtyActorRooms()].sort((a, b) => a - b),
  );

  /** Records that a room's actor list was edited (so save writes it back). */
  markActorsDirty(roomIndex: number): void {
    this.dirtyActorRooms.update((set) => {
      const next = new Set(set);
      next.add(roomIndex);
      return next;
    });
  }

  /** Updates the room editor's dirty flag (called by the editor). */
  setDirty(dirty: boolean): void {
    this.roomDirty.set(dirty);
  }

  /** Room open in the active stage, or null when the map grid should show. */
  readonly activeRoom = computed<number | null>(() => {
    const stageId = this.activeStage();
    if (!stageId) {
      return null;
    }
    const room = this.rooms()[stageId];
    return room == null ? null : room;
  });

  /**
   * Whether a room is open in the active stage.
   *
   * Room 0 (the start room) is valid, so this exists because a truthiness check
   * on {@link activeRoom} would incorrectly treat room `0` as "no room".
   */
  readonly hasActiveRoom = computed(() => this.activeRoom() !== null);

  /** Sets which stage's room selection is currently displayed. */
  setActiveStage(stageId: string): void {
    this.activeStage.set(stageId);
  }

  /** Opens a room in the given stage's editor. */
  open(stageId: string, roomIndex: number): void {
    this.rooms.update((rooms) => ({ ...rooms, [stageId]: roomIndex }));
  }

  /** Closes the room editor for the given stage. */
  close(stageId: string): void {
    this.roomDirty.set(false);
    this.dirtyLayerMap.set({});
    this.rooms.update((rooms) => {
      if (!(stageId in rooms)) {
        return rooms;
      }
      const next = { ...rooms };
      delete next[stageId];
      return next;
    });
  }

  /** Whether a room is currently open for the given stage. */
  isOpen(stageId: string, roomIndex?: number): boolean {
    const room = this.rooms()[stageId];
    return room != null && (roomIndex == null || room === roomIndex);
  }
}
