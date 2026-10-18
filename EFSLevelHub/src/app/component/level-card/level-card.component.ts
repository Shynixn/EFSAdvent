import { Component, EventEmitter, Input, Output } from '@angular/core';

/** Kind of published entry a card shows. */
export type LevelCardKind = 'stage' | 'world';

/**
 * LevelCardComponent
 * ------------------
 * A **read-only** card for the Level Explorer. It deliberately mirrors
 * `CardComponent` (same size, border, hover lift, author row and uuid) so the
 * explorer looks like My Stages / My Worlds, but adds:
 *
 *  - a `kind` badge (stage / world) over the preview image,
 *  - a "N stages" pill for worlds, and
 *  - a download icon hint next to the badge: activating the card downloads the
 *    entry as `.fsastage` / `.fsaworld`. There is deliberately no separate
 *    button — the whole card is the download target.
 */
@Component({
  selector: 'app-level-card',
  templateUrl: './level-card.component.html',
})
export class LevelCardComponent {
  /** Kind shown in the badge and used for the subtitle. */
  @Input() kind: LevelCardKind = 'stage';
  /** Display name. */
  @Input() title = '';
  /** Author name. */
  @Input() author = '';
  /** Creation date (`yyyy-MM-dd`), shown next to the author. */
  @Input() creationDate = '';
  /** Entry id (guid), shown small at the bottom. */
  @Input() uuid = '';
  /** Preview image URL (world thumbnail or stage preview), or null. */
  @Input() imageUrl: string | null = null;
  /** Number of stages (worlds only). */
  @Input() stageCount = 0;
  /** True while this entry is being packaged/downloaded. */
  @Input() busy = false;

  /** Emits when the card is activated (download). */
  @Output() cardClick = new EventEmitter<void>();

  /** Short type label shown in the badge. */
  get kindLabel(): string {
    return this.kind === 'world' ? 'World' : 'Stage';
  }
}
