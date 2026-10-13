import { Component, Input } from '@angular/core';

/**
 * LoadingOverlayComponent
 * -----------------------
 * A full-screen, non-dismissible semi-transparent overlay shown while a page is
 * loading heavy content (parsing a stage archive, rendering previews, …).
 *
 * It is deliberately chrome-free (no dialog card) so it reads as a page-level
 * loading veil rather than a modal. Because the underlying work (wasm parsing,
 * canvas rendering) is synchronous and blocks the main thread, hosts show this
 * overlay and then yield for a frame (see `LoadingOverlayComponent` usage) so
 * the browser has a chance to paint the veil *before* the blocking work starts.
 *
 * @example
 * <app-loading-overlay [open]="isLoading()" />
 */
@Component({
  selector: 'app-loading-overlay',
  templateUrl: './loading-overlay.component.html',
})
export class LoadingOverlayComponent {
  /** Whether the overlay is visible. */
  @Input() open = false;
  /** Status message shown in the overlay. */
  @Input() message = 'Loading...';
}
