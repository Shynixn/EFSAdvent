import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { MapGridComponent, RoomGridAction } from '../map-grid/map-grid.component';
import { StageData } from '../../entity/fsalib.entity';

/**
 * SystemColumnComponent
 * ---------------------
 * The room page's left "System" column: a wide rail (flush against the app side
 * nav) hosting the compact map grid for quick room swapping plus the stage-level
 * **Theme** setting (rendered as a dropdown-style button that opens the picker
 * modal via {@link themeClicked}).
 *
 * It also hosts a collapsible **Debug** section with the layer options (base
 * layer, GBA layer, top layer, edit top layer) and the current stage's JSON
 * definition file.
 *
 * It is purely presentational — the host supplies the parsed stage and reacts to
 * {@link roomSelected} / {@link themeClicked} / the layer-change events.
 *
 * @example
 * <app-system-column
 *   [stage]="stageData()"
 *   [selectedRoom]="roomIndex()"
 *   [themeName]="themeName()"
 *   [roomJson]="roomJson()"
 *   [gba]="gba()"
 *   [topLayer]="topLayer()"
 *   [paintTop]="paintTop()"
 *   (roomSelected)="selectRoom($event)"
 *   (themeClicked)="openTheme()"
 *   (gbaChange)="gba.set($event)"
 *   (topLayerChange)="topLayer.set($event)"
 *   (paintTopChange)="paintTop.set($event)"
 * />
 */
@Component({
  selector: 'app-system-column',
  imports: [MapGridComponent],
  templateUrl: './system-column.component.html',
  host: { class: 'block h-full w-full' },
})
export class SystemColumnComponent {
  /** Parsed stage whose layout is shown. */
  @Input() stage: StageData | null = null;
  /** Currently open room index (highlighted). */
  @Input() selectedRoom: number | null = null;
  /** Display name of the stage's current tileset theme. */
  @Input() themeName = '';
  /** Pretty-printed JSON of the room's current in-memory data (null while loading). */
  @Input() roomJson: string | null = null;
  /**
   * Same as {@link roomJson} but without the `legacyActors` and `ground` blocks
   * — only the semantic records the editor persists. Used by the "Copy JSON
   * without legacy" button.
   */
  @Input() roomJsonWithoutLegacy: string | null = null;

  /** Whether the GBA tileset/layer is drawn. */
  @Input() gba = false;
  /** Whether the paired top layer is composited over the base layer. */
  @Input() topLayer = true;
  /** Whether painting targets the top layer instead of the base layer. */
  @Input() paintTop = false;
  /**
   * Whether the Debug section (layer options + room JSON) is rendered at all.
   * Driven by the "Show debug information" preference on the settings page.
   */
  @Input() showDebug = false;
  /** Whether the Debug section is expanded. */
  readonly debugOpen = signal(false);

  /** Room index currently copied (grid context menu), or null. */
  @Input() copiedRoom: number | null = null;

  /** Emits the clicked room index. */
  @Output() roomSelected = new EventEmitter<number>();

  /** Emits a room context-menu action (create/copy/paste/delete) from the grid. */
  @Output() roomAction = new EventEmitter<RoomGridAction>();
  /** Emits when the user opens the theme picker. */
  @Output() themeClicked = new EventEmitter<void>();
  /** Emits the new GBA-layer toggle state. */
  @Output() gbaChange = new EventEmitter<boolean>();
  /** Emits the new top-layer toggle state. */
  @Output() topLayerChange = new EventEmitter<boolean>();
  /** Emits the new edit-top-layer toggle state. */
  @Output() paintTopChange = new EventEmitter<boolean>();
  /** Emits when the user clears this room's smart objects + ground from the stage JSON. */
  @Output() clearRoomData = new EventEmitter<void>();

  /** True for a moment after the "Copy JSON" button succeeds (shows feedback). */
  readonly copied = signal(false);
  /** True for a moment after the "Copy JSON without legacy" button succeeds. */
  readonly copiedWithoutLegacy = signal(false);

  /**
   * Copies the room JSON to the clipboard as **minified** JSON (no whitespace).
   * The displayed JSON is pretty-printed for readability, so it is parsed and
   * re-serialized without indentation here. Falls back to the pretty text if the
   * JSON cannot be parsed.
   */
  async copyRoomJson(): Promise<void> {
    await this.copyJson(this.roomJson, this.copied);
  }

  /**
   * Copies the room JSON **without the legacy actors and ground** (minified).
   * Legacy actors are archive-derived and never persisted, and ground is baked
   * into the tile layers on save, so this is the compact semantic subset.
   */
  async copyRoomJsonWithoutLegacy(): Promise<void> {
    await this.copyJson(this.roomJsonWithoutLegacy, this.copiedWithoutLegacy);
  }

  /** Minifies + copies `json`, showing feedback through `flag` for a moment. */
  private async copyJson(
    json: string | null,
    flag: ReturnType<typeof signal<boolean>>,
  ): Promise<void> {
    if (!json) {
      return;
    }
    let text = json;
    try {
      text = JSON.stringify(JSON.parse(json));
    } catch {
      // Not parseable — copy what we have.
    }
    try {
      await navigator.clipboard.writeText(text);
      flag.set(true);
      setTimeout(() => flag.set(false), 1500);
    } catch {
      // Clipboard unavailable (permissions / insecure context) — ignore.
    }
  }
}
