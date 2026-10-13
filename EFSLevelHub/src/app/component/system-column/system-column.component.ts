import { Component, EventEmitter, Input, Output } from '@angular/core';
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
 * It is purely presentational — the host supplies the parsed stage and reacts to
 * {@link roomSelected} / {@link themeClicked}.
 *
 * @example
 * <app-system-column
 *   [stage]="stageData()"
 *   [selectedRoom]="roomIndex()"
 *   [themeName]="themeName()"
 *   (roomSelected)="selectRoom($event)"
 *   (themeClicked)="openTheme()"
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

  /** Emits the clicked room index. */
  @Output() roomSelected = new EventEmitter<number>();
  /** Emits when the user opens the theme picker. */
  @Output() themeClicked = new EventEmitter<void>();
}
