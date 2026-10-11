import { Injectable } from '@angular/core';

/**
 * LoggingService
 * --------------
 * Central application logger. Wraps the browser console with a consistent
 * `[EFSLevelHub]` prefix so log output can be filtered in devtools.
 *
 * Injected via Angular DI (`inject(LoggingService)`), making it easy to swap
 * the implementation later (e.g. ship logs to a backend or disable them in
 * production).
 */
@Injectable({ providedIn: 'root' })
export class LoggingService {
  private readonly prefix = '[EFSLevelHub]';

  /** Logs an informational message. */
  info(message: string, ...args: unknown[]): void {
    console.info(`${this.prefix} ${message}`, ...args);
  }

  /** Logs a warning. */
  warn(message: string, ...args: unknown[]): void {
    console.warn(`${this.prefix} ${message}`, ...args);
  }

  /** Logs an error. */
  error(message: string, ...args: unknown[]): void {
    console.error(`${this.prefix} ${message}`, ...args);
  }

  /** Logs a debug message. */
  debug(message: string, ...args: unknown[]): void {
    console.debug(`${this.prefix} ${message}`, ...args);
  }
}
