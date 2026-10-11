import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { GameStateService } from '../service/game-state.service';

/**
 * Redirects to the Settings page when the game's disc assets have not been
 * imported yet, preventing direct URL access to locked routes.
 */
export const requiresGameFilesGuard: CanActivateFn = async () => {
  const gameState = inject(GameStateService);
  const router = inject(Router);

  if (gameState.isReady()) {
    return true;
  }

  const ready = await gameState.refresh();
  return ready ? true : router.createUrlTree(['/settings']);
};
