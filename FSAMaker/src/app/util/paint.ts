/**
 * Waits for the browser to paint at least one frame, then resolves.
 *
 * Used before kicking off block-the-main-thread work (wasm parsing, canvas
 * rendering): the caller first shows a loading overlay and marks it dirty, then
 * awaits this so Angular flushes the overlay to the DOM and the browser paints
 * it, and only then runs the blocking work. Without the yield the overlay and
 * the (synchronous) work would land in the same frame, so the overlay would
 * never be seen.
 *
 * A double `requestAnimationFrame` plus a short timeout is used because a single
 * rAF fires *before* paint; the second fires after the first paint has been
 * committed.
 *
 * @param delayMs Extra delay appended after the paint yield (default 50ms).
 */
export function nextPaint(delayMs = 50): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, delayMs);
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, delayMs);
      });
    });
  });
}
