import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { MapGridComponent } from '../map-grid/map-grid.component';
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
 *   [stageJson]="stageJson()"
 *   [layerIndex]="layerIndex()"
 *   [gba]="gba()"
 *   [topLayer]="topLayer()"
 *   [paintTop]="paintTop()"
 *   (roomSelected)="selectRoom($event)"
 *   (themeClicked)="openTheme()"
 *   (layerIndexChange)="layerIndex.set($event)"
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
  /** Pretty-printed JSON of the stage's definition file (null while loading). */
  @Input() stageJson: string | null = null;

  /** Active base layer (0-7) shown in the Debug section. */
  @Input() layerIndex = 0;
  /** Whether the GBA tileset/layer is drawn. */
  @Input() gba = false;
  /** Whether the paired top layer is composited over the base layer. */
  @Input() topLayer = true;
  /** Whether painting targets the top layer instead of the base layer. */
  @Input() paintTop = false;

  /** Whether the Debug section is expanded. */
  readonly debugOpen = signal(false);

  /** Emits the clicked room index. */
  @Output() roomSelected = new EventEmitter<number>();
  /** Emits when the user opens the theme picker. */
  @Output() themeClicked = new EventEmitter<void>();
  /** Emits the newly selected base layer. */
  @Output() layerIndexChange = new EventEmitter<number>();
  /** Emits the new GBA-layer toggle state. */
  @Output() gbaChange = new EventEmitter<boolean>();
  /** Emits the new top-layer toggle state. */
  @Output() topLayerChange = new EventEmitter<boolean>();
  /** Emits the new edit-top-layer toggle state. */
  @Output() paintTopChange = new EventEmitter<boolean>();
  /** Emits when the user clears this room's smart objects + ground from the stage JSON. */
  @Output() clearRoomData = new EventEmitter<void>();
}
