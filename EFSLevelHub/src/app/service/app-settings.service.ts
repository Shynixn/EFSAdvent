import { Injectable, signal } from '@angular/core';

/** `localStorage` key holding the persisted JSON settings object. */
const STORAGE_KEY = 'efslevelhub.settings';

/**
 * Persisted application settings.
 *
 * Kept intentionally small: everything is stored as one JSON object under a
 * single `localStorage` key so adding a setting never requires a migration.
 */
interface AppSettings {
  /** When true, developer/debug information is shown in the UI. */
  debug: boolean;
}

/** Defaults used when nothing (or invalid JSON) is persisted yet. */
const DEFAULTS: AppSettings = { debug: false };

/**
 * AppSettingsService
 * ------------------
 * Signal-based, `localStorage`-backed application preferences.
 *
 * Zoneless Angular: consumers read the signals directly in templates, so
 * toggling a setting re-renders every dependent view (e.g. the room page's
 * debug section) without extra plumbing.
 *
 * @example
 * settings.toggleDebug();          // enable/disable debug info
 * settings.debug();                // current value (reactive)
 */
@Injectable({ providedIn: 'root' })
export class AppSettingsService {
  /** Whether debug information should be displayed. */
  readonly debug = signal<boolean>(DEFAULTS.debug);

  constructor() {
    this.load();
  }

  /** Enables or disables the debug information. */
  setDebug(value: boolean): void {
    this.debug.set(value);
    this.save();
  }

  /** Flips the debug information flag. */
  toggleDebug(): void {
    this.setDebug(!this.debug());
  }

  /** Reads the persisted settings, falling back to the defaults on any error. */
  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      this.debug.set(typeof parsed.debug === 'boolean' ? parsed.debug : DEFAULTS.debug);
    } catch {
      // Corrupt/unavailable storage: keep the defaults.
      this.debug.set(DEFAULTS.debug);
    }
  }

  /** Persists the current settings. Storage failures are non-fatal. */
  private save(): void {
    try {
      const value: AppSettings = { debug: this.debug() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Private mode / quota exceeded: settings stay in memory for this session.
    }
  }
}
