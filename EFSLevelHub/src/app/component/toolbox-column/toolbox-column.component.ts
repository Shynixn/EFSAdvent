import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { TilePaletteComponent } from '../tile-palette/tile-palette.component';
import { StageRenderer } from '../../service/render/stage-renderer';

/**
 * ToolboxColumnComponent
 * ----------------------
 * The room page's right "Toolbox" column. It hosts an **Advanced** collapsible
 * section that reveals the manual tile-drawing tools, including the
 * {@link TilePaletteComponent} (rendered only while the section is open).
 *
 * The host owns the brush state; this component renders the rail and reports
 * interactions (`tilePicked`, `advancedOpenChange`).
 *
 * @example
 * <app-toolbox-column
 *   [renderer]="renderer()"
 *   [gba]="gba()"
 *   [brushTile]="brushTile()"
 *   (advancedOpenChange)="advancedOpen.set($event)"
 *   (tilePicked)="brushTile.set($event)"
 * />
 */
@Component({
  selector: 'app-toolbox-column',
  imports: [TilePaletteComponent],
  templateUrl: './toolbox-column.component.html',
  host: { class: 'block h-full w-full' },
})
export class ToolboxColumnComponent {
  /** Stage renderer used to draw the tile palette. */
  @Input() renderer: StageRenderer | null = null;
  /** Whether the GBA tileset is used for the palette. */
  @Input() gba = false;
  /** Currently selected brush tile (shown in the Advanced section). */
  @Input() brushTile = 0;

  /** Emits the Advanced section's open state whenever it changes. */
  @Output() advancedOpenChange = new EventEmitter<boolean>();
  /** Emits the tile value when the user picks a tile from the palette. */
  @Output() tilePicked = new EventEmitter<number>();

  /** Whether the Advanced (manual drawing) section is expanded. */
  readonly advancedOpen = signal(false);

  /** Toggles the Advanced section. */
  toggleAdvanced(): void {
    const open = !this.advancedOpen();
    this.advancedOpen.set(open);
    this.advancedOpenChange.emit(open);
  }
}
