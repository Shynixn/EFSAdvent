import { Injectable } from '@angular/core';

/** Monotonic clock used to measure elapsed times (ms since page start). */
function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Local wall-clock time of day (`HH:MM:SS.mmm`) for use in log lines. */
function timestamp(): string {
  const date = new Date();
  const pad = (n: number, width = 2) => n.toString().padStart(width, '0');
  return (
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
    pad(date.getMilliseconds(), 3)
  );
}

/**
 * A running measurement created by {@link LoggingService.startTimer}.
 *
 * Call {@link stop} to log how much time has passed since the timer started.
 * Timers are cheap and have no side effects until stopped.
 */
export class LogTimer {
  constructor(
    private readonly logger: LoggingService,
    /** Label the measurement is reported under. */
    readonly label: string,
    private readonly startedAt: number = now(),
  ) {}

  /** Milliseconds elapsed since the timer started. */
  get elapsed(): number {
    return now() - this.startedAt;
  }

  /** Stops the timer and logs the total duration. */
  stop(message?: string): number {
    const elapsed = this.elapsed;
    this.logger.info(`${message ? `${message} ` : ''}[${this.label}] took ${elapsed.toFixed(1)}ms`);
    return elapsed;
  }

  /** Logs the time elapsed so far with a custom message. */
  lap(message: string): number {
    const elapsed = this.elapsed;
    this.logger.info(`[${this.label}] ${message} (+${elapsed.toFixed(1)}ms)`);
    return elapsed;
  }
}

/**
 * LoggingService
 * --------------
 * Central application logger. Wraps the browser console with a consistent
 * `[FSAMaker]` prefix and a wall-clock timestamp (`HH:MM:SS.mmm`), so log
 * output can be filtered in devtools and the ordering/duration of work can be
 * read straight off the console.
 *
 * Injected via Angular DI (`inject(LoggingService)`), making it easy to swap
 * the implementation later (e.g. ship logs to a backend or disable them in
 * production).
 */
@Injectable({ providedIn: 'root' })
export class LoggingService {
  private readonly prefix = '[FSAMaker]';

  /** Prefixes a message with the current wall-clock time. */
  private stamp(message: string): string {
    return `${this.prefix} [${timestamp()}] ${message}`;
  }

  /** Logs an informational message. */
  info(message: string, ...args: unknown[]): void {
    console.info(this.stamp(message), ...args);
  }

  /** Logs a warning. */
  warn(message: string, ...args: unknown[]): void {
    console.warn(this.stamp(message), ...args);
  }

  /** Logs an error. */
  error(message: string, ...args: unknown[]): void {
    console.error(this.stamp(message), ...args);
  }

  /** Logs a debug message. */
  debug(message: string, ...args: unknown[]): void {
    console.debug(this.stamp(message), ...args);
  }

  /**
   * Starts a named measurement. Call {@link LogTimer.stop} on the result to log
   * how long an operation took.
   *
   * @param label Short name of the measured operation (e.g. `StageEditor.load`).
   */
  startTimer(label: string): LogTimer {
    return new LogTimer(this, label);
  }

  /**
   * Times an async operation and logs its duration, whether it resolves or
   * throws. Returns the operation's result unchanged.
   *
   * @param label     Short name of the measured operation.
   * @param operation Work to measure.
   */
  async time<T>(label: string, operation: () => Promise<T>): Promise<T> {
    const timer = this.startTimer(label);
    try {
      return await operation();
    } finally {
      timer.stop();
    }
  }
}
