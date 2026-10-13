import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

/**
 * ToolboxColumnComponent
 * ----------------------
 * The room page's right "Toolbox" column. It hosts an **Advanced** collapsible
 * section that reveals the manual tile-drawing controls.
 *
 * Purely presentational: the host owns the tile palette, this component only
 * renders the rail and reports interactions.
 *
 * @example
 * <app-toolbox-column [brushTile]="brushTile()" (advancedOpenChange)="advancedOpen.set($event)" />
 */
@Component({
  selector: 'app-toolbox-column',
  templateUrl: './toolbox-column.component.html',
})
export class ToolboxColumnComponent {
  /** Currently selected brush tile (shown in the Advanced section). */
  @Input() brushTile = 0;

  /** Emits the Advanced section's open state whenever it changes. */
  @Output() advancedOpenChange = new EventEmitter<boolean>();

  /** Whether the Advanced (manual drawing) section is expanded. */
  readonly advancedOpen = signal(false);

  /** Toggles the Advanced section. */
  toggleAdvanced(): void {
    const open = !this.advancedOpen();
    this.advancedOpen.set(open);
    this.advancedOpenChange.emit(open);
  }
}
