import { Injectable, inject } from '@angular/core';
import { StageEditorService } from './stage-editor.service';
import { LoggingService } from './logging.service';

/**
 * UnsavedChangesService
 * ---------------------
 * Centralises the "you have unsaved changes" prompts shared by the stage and room
 * pages.
 *
 * Two behaviours are supported:
 * - {@link confirmDiscard}: a native `window.confirm` dialog used before an
 *   in-app action that would lose edits (e.g. closing a stage). When the user
 *   accepts, the caller's `save` callback runs first.
 * - {@link preventUnload}: wires the browser's native `beforeunload` prompt so
 *   refreshing/closing the page warns while the active stage is dirty. (Browsers
 *   do not allow a custom "Save" button here, so this only warns.)
 */
@Injectable({ providedIn: 'root' })
export class UnsavedChangesService {
  private readonly stageEditor = inject(StageEditorService);
  private readonly logger = inject(LoggingService);

  /** Whether the given stage currently has unsaved edits. */
  isDirty(stageId: string): boolean {
    return this.stageEditor.isDirty(stageId);
  }

  /**
   * Asks the user to confirm before discarding unsaved changes for `stageId`.
   *
   * @param stageId Stage whose edits may be lost.
   * @param action  Human-readable action (e.g. "close this stage").
   * @param save    Optional save callback, invoked when the user chooses to save.
   * @returns `true` when the action may proceed (either nothing was dirty, or
   *          the user agreed to save/discard), `false` to abort.
   */
  async confirmDiscard(
    stageId: string,
    action: string,
    save?: () => Promise<void>,
  ): Promise<boolean> {
    if (!this.isDirty(stageId)) {
      return true;
    }

    const message =
      `This stage has unsaved changes.\n\n` +
      `Press OK to save them before you ${action}, or Cancel to stay.`;

    if (!window.confirm(message)) {
      // Cancel: abort the action and keep the user on the page.
      return false;
    }

    if (save) {
      await save();
    }
    return true;
  }

  /**
   * Installs a `beforeunload` warning that fires while the given stage is dirty.
   *
   * @param stageId     Stage to watch (read lazily, so it may change over time).
   * @returns A teardown function that removes the listener.
   */
  preventUnload(stageId: () => string): () => void {
    const handler = (event: BeforeUnloadEvent): void => {
      const id = stageId();
      if (id && this.isDirty(id)) {
        // Browsers show their own generic message; a custom string is ignored.
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }
}
