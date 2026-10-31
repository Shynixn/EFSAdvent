import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

/** A single selectable entry in a {@link DropdownComponent}. */
export interface DropdownOption {
  /** Value emitted when the option is picked. */
  value: number;
  /** Text shown to the user. */
  label: string;
}

/**
 * DropdownComponent
 * -----------------
 * A single, consistent "label + current value + chevron" control used for the
 * room page's stage-level settings (Theme, Background music).
 *
 * It renders the same shell everywhere, so the two settings look identical even
 * though they behave differently:
 *
 * - **inline mode** (default) opens a small panel listing {@link options} and
 *   emits {@link valueChange} when one is picked (used for background music);
 * - **external mode** (`[externalPicker]="true"`) does not render a panel: it
 *   only emits {@link opened} so the host can open its own richer picker (used
 *   for the tileset Theme modal with preview thumbnails).
 *
 * @example Inline (music)
 * <app-dropdown label="Background music" [options]="tracks" [value]="musicId()" (valueChange)="selectMusic($event)" />
 *
 * @example External (theme picker modal)
 * <app-dropdown label="Theme" [valueText]="themeName()" [externalPicker]="true" (opened)="openTheme()" />
 */
@Component({
  selector: 'app-dropdown',
  templateUrl: './dropdown.component.html',
  host: { class: 'block w-full' },
})
export class DropdownComponent {
  /** Small caption shown above the value (e.g. "Theme"). */
  @Input() label = '';
  /** Options rendered in inline mode. */
  @Input() options: DropdownOption[] = [];
  /** Currently selected value (highlighted in inline mode). */
  @Input() value: number | null = null;
  /**
   * Text shown as the current value. When omitted, it is derived from the
   * matching option's label in {@link options}.
   */
  @Input() valueText = '';
  /** Disables the control. */
  @Input() disabled = false;
  /** Placeholder shown when no value/label is available yet. */
  @Input() placeholder = 'Loading…';
  /**
   * When true the control does not open an inline list; it only emits
   * {@link opened} and the host shows its own picker.
   */
  @Input() externalPicker = false;

  /** Emits the picked value in inline mode. */
  @Output() valueChange = new EventEmitter<number>();
  /** Emits when the control is activated in external-picker mode. */
  @Output() opened = new EventEmitter<void>();

  /** Whether the inline option panel is open. */
  readonly open = signal(false);

  /** Current value text, falling back to the selected option / placeholder. */
  get displayText(): string {
    if (this.valueText) {
      return this.valueText;
    }
    const match = this.options.find((option) => option.value === this.value);
    return match?.label ?? this.placeholder;
  }

  /** Handles a click on the control's button. */
  activate(): void {
    if (this.disabled) {
      return;
    }
    if (this.externalPicker) {
      this.opened.emit();
      return;
    }
    this.open.update((value) => !value);
  }

  /** Picks an inline option. */
  pick(option: DropdownOption): void {
    this.open.set(false);
    if (option.value !== this.value) {
      this.valueChange.emit(option.value);
    }
  }

  /** Closes the inline panel (backdrop click). */
  close(): void {
    this.open.set(false);
  }
}
