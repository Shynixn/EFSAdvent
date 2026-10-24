/**
 * Hides the browser's default drag image for a native HTML5 drag.
 *
 * By default the browser renders a "ghost" of the dragged element (the toolbox
 * card) that follows the cursor for the whole drag. The room canvas already
 * draws a live, correctly-anchored preview of the object being placed, so the
 * card ghost is redundant and obscures it.
 *
 * Setting a 1×1 fully transparent canvas as the drag image suppresses it in all
 * major browsers. The element must be in the document for the image to be
 * picked up (notably in Firefox), so it is appended off-screen and removed on
 * the next frame. It is also removed on `dragend` as a safety net.
 *
 * @param event The `DragEvent` from the `dragstart` handler.
 */
export function hideNativeDragImage(event: DragEvent): void {
  const transfer = event.dataTransfer;
  if (!transfer) {
    return;
  }

  const image = document.createElement('canvas');
  image.width = 1;
  image.height = 1;
  // Transparent (the canvas starts fully transparent).
  image.style.position = 'fixed';
  image.style.top = '-1000px';
  image.style.left = '-1000px';
  image.style.width = '1px';
  image.style.height = '1px';
  image.style.pointerEvents = 'none';
  document.body.appendChild(image);

  transfer.effectAllowed = 'copy';
  transfer.setDragImage(image, 0, 0);

  // The browser snapshots the image synchronously, so it can go immediately;
  // deferring the removal keeps it reliable across browsers.
  setTimeout(() => image.remove(), 0);

  event.currentTarget?.addEventListener('dragend', () => image.remove(), { once: true });
}
