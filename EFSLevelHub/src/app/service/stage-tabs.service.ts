import { Injectable, computed, inject, signal } from '@angular/core';
import { StageService } from './stage.service';
import { LoggingService } from './logging.service';

/** An open stage "tab" in the editor shell. */
export interface StageTab {
  id: string;
  name: string;
}

/**
 * StageTabsService
 * ----------------
 * Tracks which stages the user has opened as tabs. Tabs appear under the "My
 * Stages" navigation entry and can be navigated to and closed individually.
 *
 * Mirrors {@link WorldTabsService} for the stage domain.
 */
@Injectable({ providedIn: 'root' })
export class StageTabsService {
  private readonly stageService = inject(StageService);
  private readonly logger = inject(LoggingService);

  /** Ids of the currently open stages, in tab order. */
  private readonly openIds = signal<string[]>([]);

  /** Open stage tabs, resolved to their names, in order. */
  readonly tabs = computed<StageTab[]>(() =>
    this.openIds().map((id) => ({
      id,
      name: this.stageService.getById(id)?.name ?? id,
    })),
  );

  /** Opens a stage (idempotent) if it exists. */
  open(id: string): void {
    if (!this.stageService.getById(id)) {
      this.logger.warn(`StageTabs: cannot open unknown stage "${id}".`);
      return;
    }
    this.openIds.update((ids) => (ids.includes(id) ? ids : [...ids, id]));
    this.logger.info(`StageTabs: opened stage "${id}".`);
  }

  /** Closes a stage tab. */
  close(id: string): void {
    this.openIds.update((ids) => ids.filter((openId) => openId !== id));
    this.logger.info(`StageTabs: closed stage "${id}".`);
  }

  /** Whether a stage is currently open. */
  isOpen(id: string): boolean {
    return this.openIds().includes(id);
  }
}
