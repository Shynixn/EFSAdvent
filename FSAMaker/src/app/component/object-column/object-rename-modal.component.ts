import { Component, EventEmitter, Input, Output, effect, signal } from '@angular/core';
import { ModalComponent } from '../modal/modal.component';
import { ButtonComponent } from '../button/button.component';

/**
 * ObjectRenameModalComponent
 * --------------------------
 * Small modal text input used to name (or rename) a placed smart object from the
 * object column. The name is stored on the placement by the host; an empty name
 * clears it (the object then shows its definition name again).
 *
 * @example
 * <app-object-rename-modal
 *   [open]="renameOpen()"
 *   [currentName]="renameCurrentName()"
 *   (closed)="closeRenameObject()"
 *   (nameSubmitted)="renameObject($event)"
 * />
 */
@Component({
  selector: 'app-object-rename-modal',
  imports: [ModalComponent, ButtonComponent],
  template: `
    <app-modal title="Name object" [open]="open" (closed)="closed.emit()">
      <form class="space-y-4" (submit)="submit($event)">
        <label class="block">
          <span class="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
            Name
          </span>
          <input
            #nameInput
            type="text"
            [value]="value()"
            (input)="value.set($any($event.target).value)"
            (keydown.enter)="submit($event)"
            maxlength="64"
            autocomplete="off"
            placeholder="e.g. Boss door"
            class="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-indigo-500"
          />
        </label>
        <p class="text-[11px] leading-relaxed text-slate-500">
          Only used in the object list. Leave empty to use the default name.
        </p>
        <div class="flex justify-end gap-2">
          <app-button variant="outline" color="slate" size="sm" (clicked)="closed.emit()">
            Cancel
          </app-button>
          <app-button variant="primary" color="indigo" size="sm" (clicked)="submit($event)">
            Save
          </app-button>
        </div>
      </form>
    </app-modal>
  `,
})
export class ObjectRenameModalComponent {
  /** Whether the dialog is visible. */
  @Input() open = false;
  /** Name the dialog opens with (the object's current custom name). */
  @Input() currentName = '';

  /** Emits when the dialog should be dismissed without changes. */
  @Output() closed = new EventEmitter<void>();
  /** Emits the new name (may be an empty string to clear it). */
  @Output() nameSubmitted = new EventEmitter<string>();

  /** The edited value, seeded from {@link currentName} whenever the dialog opens. */
  readonly value = signal('');

  constructor() {
    effect(() => {
      if (this.open) {
        this.value.set(this.currentName ?? '');
      }
    });
  }

  /** Confirms the edit. */
  submit(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.nameSubmitted.emit(this.value().trim());
  }
}
