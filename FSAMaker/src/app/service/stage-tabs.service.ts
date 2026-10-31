import { Injectable, computed, inject, signal } from '@angular/core';
import { StageService } from './stage.service';
import { LoggingService } from './logging.service';

/** An open stage "tab" in the editor shell. */
export interface StageTab {
  id: string;
  name: string;
  /** Open rooms nested under this stage, in tab order. */
  rooms: RoomTab[];
}

/** An open room "tab" nested under a stage tab. */
export interface RoomTab {
  /** The room index within the stage. */
  index: number;
  /** Display label, e.g. "Room 12". */
  name: string;
}

/**
 * StageTabsService
 * ----------------
 * Tracks which stages (and, within them, which rooms) the user has opened as
 * tabs. Stage tabs appear under the "My Stages" navigation entry; room tabs are
 * nested under their stage tab. Mirrors {@link WorldTabsService}.
 */
@Injectable({ providedIn: 'root' })
export class StageTabsService {
  private readonly stageService = inject(StageService);
  private readonly logger = inject(LoggingService);

  /** Ids of the currently open stages, in tab order. */
  private readonly openIds = signal<string[]>([]);

  /** Open room indices per stage id. */
  private readonly openRooms = signal<Record<string, number[]>>({});

  /** Open stage tabs (with their nested rooms), resolved to names. */
  readonly tabs = computed<StageTab[]>(() => {
    const rooms = this.openRooms();
    return this.openIds().map((id) => ({
      id,
      name: this.stageService.getById(id)?.name ?? id,
      rooms: (rooms[id] ?? []).map((index) => ({ index, name: `Room ${index}` })),
    }));
  });

  /** Opens a stage (idempotent) if it exists. */
  open(id: string): void {
    if (!this.stageService.getById(id)) {
      this.logger.warn(`StageTabs: cannot open unknown stage "${id}".`);
      return;
    }
    this.openIds.update((ids) => (ids.includes(id) ? ids : [...ids, id]));
    this.logger.info(`StageTabs: opened stage "${id}".`);
  }

  /** Closes a stage tab (and any room tabs nested under it). */
  close(id: string): void {
    this.openIds.update((ids) => ids.filter((openId) => openId !== id));
    this.openRooms.update((rooms) => {
      const next = { ...rooms };
      delete next[id];
      return next;
    });
    this.logger.info(`StageTabs: closed stage "${id}".`);
  }

  /** Whether a stage is currently open. */
  isOpen(id: string): boolean {
    return this.openIds().includes(id);
  }

  /** Opens a room under a stage (opens the stage itself first, idempotent). */
  openRoom(stageId: string, roomIndex: number): void {
    this.open(stageId);
    this.openRooms.update((rooms) => {
      const current = rooms[stageId] ?? [];
      if (current.includes(roomIndex)) {
        return rooms;
      }
      return { ...rooms, [stageId]: [...current, roomIndex] };
    });
    this.logger.info(`StageTabs: opened room ${roomIndex} of stage "${stageId}".`);
  }

  /** Closes a room tab under a stage. */
  closeRoom(stageId: string, roomIndex: number): void {
    this.openRooms.update((rooms) => {
      const current = rooms[stageId];
      if (!current) {
        return rooms;
      }
      return { ...rooms, [stageId]: current.filter((index) => index !== roomIndex) };
    });
    this.logger.info(`StageTabs: closed room ${roomIndex} of stage "${stageId}".`);
  }
}
