import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { UnsavedChangesService } from '../service/unsaved-changes.service';
import { StageEditorService } from '../service/stage-editor.service';

/** Minimal contract a component implements to be guarded when navigating away. */
export interface PendingChangesHost {
  /**
   * Asks the component to resolve its unsaved edits before navigation.
   *
   * @returns `true` to continue navigating, `false` to stay on the page.
   */
  confirmLeave(): Promise<boolean>;
}

/**
 * Guards navigation away from an editor route that holds unsaved changes.
 *
 * Every way out of an editor page goes through the router — side-nav stage/room
 * tabs, clicking another room in the map grid, the "My Stages" / "My Worlds"
 * links, browser back — so a single canDeactivate guard covers them all.
 *
 * When the host component implements {@link PendingChangesHost} its
 * `confirmLeave()` decides (it can offer to save first). Otherwise a generic
 * confirmation is shown for any stage that is currently dirty.
 */
export const pendingChangesGuard: CanDeactivateFn<PendingChangesHost> = async (component) => {
  if (component && typeof component.confirmLeave === 'function') {
    return component.confirmLeave();
  }

  // Fallback for components without the hook: warn when anything is dirty.
  const stageEditor = inject(StageEditorService);
  const unsaved = inject(UnsavedChangesService);
  const dirtyId = stageEditor.dirtyStageIds()[0];
  if (!dirtyId) {
    return true;
  }
  return unsaved.confirmDiscard(dirtyId, 'leave this page');
};
