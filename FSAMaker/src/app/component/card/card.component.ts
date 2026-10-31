import { Component, EventEmitter, Input, Output } from '@angular/core';

/** Visual variants a card can adopt. */
export type CardVariant = 'default' | 'danger';

/**
 * CardComponent
 * -------------
 * Reusable content card with an optional image header, a title, a subtitle and
 * a corner badge. Used across the app (worlds, stages, …) so cards stay
 * visually consistent.
 */
@Component({
  selector: 'app-card',
  templateUrl: './card.component.html',
  styleUrl: './card.component.css',
})
export class CardComponent {
  /** Title shown in the card body. */
  @Input() title = '';
  /** Optional secondary line under the title. */
  @Input() subtitle = '';
  /** Optional author name, shown with an avatar icon under the title. */
  @Input() author = '';
  /** Optional creation date (`yyyy-MM-dd`), shown above the uuid. */
  @Input() creationDate = '';
  /** Optional unique id, shown very small at the bottom of the card. */
  @Input() uuid = '';
  /** Optional image URL rendered in the header banner. */
  @Input() imageUrl: string | null = null;
  /**
   * How the header image fills its box: `cover` crops to fill (default),
   * `contain` fits and centres the whole image (used for stage thumbnails).
   */
  @Input() imageFit: 'cover' | 'contain' = 'cover';
  /** When true, the header shows a spinner instead of the image. */
  @Input() loading = false;
  /** Text shown next to the spinner in the loading state. */
  @Input() loadingText = 'Generating…';
  /** Optional text for a corner badge over the image (e.g. "Cannot be changed"). */
  @Input() badge: string | null = null;
  /** Visual variant; `danger` adds a red border/badge accent. */
  @Input() variant: CardVariant = 'default';
  /** When true the card is non-interactive (no hover lift). */
  @Input() disabled = false;

  /** Emits when the card is clicked (only when not disabled). */
  @Output() cardClick = new EventEmitter<void>();

  /**
   * Emits the pointer event on a right-click, so the host can open its own
   * context menu. The browser menu is suppressed here (only when
   * {@link disabled} is false) — hosts that want it keep their own handler.
   */
  @Output() cardContextMenu = new EventEmitter<MouseEvent>();

  /** Handles a right-click: suppresses the browser menu and reports the event. */
  onContextMenu(event: MouseEvent): void {
    if (this.disabled) {
      return;
    }
    event.preventDefault();
    this.cardContextMenu.emit(event);
  }
}
