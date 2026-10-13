import { Component, EventEmitter, Input, Output, effect, inject } from '@angular/core';
import { ButtonComponent } from '../button/button.component';
import { ModalComponent } from '../modal/modal.component';
import { TilesetThemeService } from '../../service/tileset-theme.service';
import { TilesetTheme } from '../../entity/tileset.util';

/**
 * ThemePickerComponent
 * --------------------
 * The tileset "Theme" picker modal. It renders the available tilesets with
 * preview thumbnails and highlights the stage's current selection; picking one
 * emits {@link themeSelected} and the host applies it (via
 * {@link TilesetThemeService}) so the change is shared across open rooms.
 *
 * @example
 * <app-theme-picker
 *   [open]="themeOpen()"
 *   [currentIndex]="currentThemeIndex()"
 *   (closed)="closeTheme()"
 *   (themeSelected)="selectTheme($event)"
 * />
 */
@Component({
  selector: 'app-theme-picker',
  imports: [ButtonComponent, ModalComponent],
  templateUrl: './theme-picker.component.html',
})
export class ThemePickerComponent {
  private readonly themeService = inject(TilesetThemeService);

  /** Whether the modal is visible. */
  @Input() open = false;
  /** Currently selected tileset index (highlighted). */
  @Input() currentIndex = 0;

  /** Emits when the user picks a theme. */
  @Output() themeSelected = new EventEmitter<TilesetTheme>();
  /** Emits when the modal should close. */
  @Output() closed = new EventEmitter<void>();

  /** Available themes. */
  readonly themes = this.themeService.themes;
  /** Preview URL per tileset index. */
  readonly previews = this.themeService.previews;
  /** Whether the list is loading. */
  readonly themesLoading = this.themeService.themesLoading;
  /** Whether previews are loading. */
  readonly previewsLoading = this.themeService.themePreviewsLoading;

  constructor() {
    // Load the (global, one-time) tile list + previews whenever the modal opens.
    effect(() => {
      if (this.open) {
        void this.themeService.ensureLoaded();
      }
    });
  }

  /** Picks a theme and emits it. */
  pick(theme: TilesetTheme): void {
    this.themeSelected.emit(theme);
  }

  /** Requests modal dismissal. */
  close(): void {
    this.closed.emit();
  }
}
