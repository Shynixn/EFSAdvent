import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

/**
 * ToolboxColumnComponent
 * ----------------------
 * The room page's right "Toolbox" column. It hosts the stage-level **Theme**
 * setting (read via {@link themeName}, changed via {@link themeClicked}) and an
 * **Advanced** collapsible section that reveals the manual tile-drawing controls.
 *
 * Purely presentational: the host owns the theme service and the tile palette,
 * this component only renders the rail and reports interactions.
 *
 * @example
 * <app-toolbox-column
 *   [themeName]="themeName()"
 *   [brushTile]="brushTile()"
 *   (themeClicked)="openTheme()"
 * />
 */
@Component({
  selector: 'app-toolbox-column',
  templateUrl: './toolbox-column.component.html',
})
export class ToolboxColumnComponent {
  /** Display name of the stage's current tileset theme. */
  @Input() themeName = '';
  /** Currently selected brush tile (shown in the Advanced section). */
  @Input() brushTile = 0;

  /** Emits when the user opens the theme picker. */
  @Output() themeClicked = new EventEmitter<void>();

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
