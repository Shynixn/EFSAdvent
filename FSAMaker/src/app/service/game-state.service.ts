import { Injectable, inject, signal } from '@angular/core';
import { OpfsCacheService } from './opfs-cache.service';
import { LoggingService } from './logging.service';

/** Marker file that proves a valid FSA ISO has been extracted into OPFS. */
export const ISO_MARKER_FILE = 'boss010.arc';

/**
 * GameStateService
 * ----------------
 * Tracks whether the game's disc assets are available in OPFS. The app treats
 * the extracted `boss010.arc` as the canonical "ISO imported" signal, because
 * every FSA disc revision ships that file somewhere in its FST.
 *
 * State is exposed as a signal so the shell/layout and routing guard can react
 * to it without zone.js.
 */
@Injectable({ providedIn: 'root' })
export class GameStateService {
  private readonly opfs = inject(OpfsCacheService);
  private readonly logger = inject(LoggingService);

  /** `true` once the marker file has been located in OPFS. */
  private readonly readyState = signal(false);
  /** `true` while the initial OPFS scan is running. */
  private readonly checkingState = signal(false);

  /** Path (relative to `/extracted_game`) of the detected marker file. */
  private readonly markerPathState = signal<string | null>(null);

  /** Read-only view of {@link readyState}. */
  readonly isReady = this.readyState.asReadonly();
  /** Read-only view of {@link checkingState}. */
  readonly isChecking = this.checkingState.asReadonly();
  /** Read-only view of {@link markerPathState}. */
  readonly markerPath = this.markerPathState.asReadonly();

  /**
   * Scans OPFS to determine whether the FSA ISO has been imported.
   *
   * @returns `true` when the marker file exists.
   */
  async refresh(): Promise<boolean> {
    this.checkingState.set(true);
    try {
      const path = await this.opfs.findFileByName(ISO_MARKER_FILE);
      this.markerPathState.set(path);
      this.readyState.set(path !== null);
      this.logger.info(`GameState: ISO ${path ? 'detected' : 'not found'} (${path ?? '—'})`);
      return path !== null;
    } catch (error) {
      this.logger.error('GameState: failed to scan OPFS for the ISO marker', error);
      this.markerPathState.set(null);
      this.readyState.set(false);
      return false;
    } finally {
      this.checkingState.set(false);
    }
  }
}
