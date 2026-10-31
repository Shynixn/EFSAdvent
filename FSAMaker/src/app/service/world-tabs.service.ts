import { Injectable, computed, inject, signal } from '@angular/core';
import { WorldService } from './world.service';
import { LoggingService } from './logging.service';

/** An open world "tab" in the editor shell. */
export interface WorldTab {
  id: string;
  name: string;
}

/**
 * WorldTabsService
 * ----------------
 * Tracks which worlds the user has opened as tabs. Tabs appear under the "My
 * Worlds" navigation entry and can be navigated to and closed individually.
 */
@Injectable({ providedIn: 'root' })
export class WorldTabsService {
  private readonly worldService = inject(WorldService);
  private readonly logger = inject(LoggingService);

  /** Ids of the currently open worlds, in tab order. */
  private readonly openIds = signal<string[]>([]);

  /** Open world tabs, resolved to their names, in order. */
  readonly tabs = computed<WorldTab[]>(() =>
    this.openIds().map((id) => ({
      id,
      name: this.worldService.getById(id)?.name ?? id,
    })),
  );

  /** Opens a world (idempotent) if it exists. */
  open(id: string): void {
    if (!this.worldService.getById(id)) {
      this.logger.warn(`WorldTabs: cannot open unknown world "${id}".`);
      return;
    }
    this.openIds.update((ids) => (ids.includes(id) ? ids : [...ids, id]));
    this.logger.info(`WorldTabs: opened world "${id}".`);
  }

  /** Closes a world tab. */
  close(id: string): void {
    this.openIds.update((ids) => ids.filter((openId) => openId !== id));
    this.logger.info(`WorldTabs: closed world "${id}".`);
  }

  /** Whether a world is currently open. */
  isOpen(id: string): boolean {
    return this.openIds().includes(id);
  }
}
