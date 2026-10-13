import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MapGridComponent } from '../map-grid/map-grid.component';
import { StageData } from '../../entity/fsalib.entity';

/**
 * SystemColumnComponent
 * ---------------------
 * The room page's left "System" column: a wide rail (flush against the app side
 * nav) hosting the compact map grid for quick room swapping.
 *
 * It is purely presentational — the host supplies the parsed stage and reacts to
 * {@link roomSelected} by navigating to that room.
 *
 * @example
 * <app-system-column [stage]="stageData()" [selectedRoom]="roomIndex()" (roomSelected)="selectRoom($event)" />
 */
@Component({
  selector: 'app-system-column',
  imports: [MapGridComponent],
  templateUrl: './system-column.component.html',
})
export class SystemColumnComponent {
  /** Parsed stage whose layout is shown. */
  @Input() stage: StageData | null = null;
  /** Currently open room index (highlighted). */
  @Input() selectedRoom: number | null = null;

  /** Emits the clicked room index. */
  @Output() roomSelected = new EventEmitter<number>();
}
