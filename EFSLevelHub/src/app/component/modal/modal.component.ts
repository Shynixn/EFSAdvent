import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ButtonComponent } from '../button/button.component';

/**
 * ModalComponent
 * --------------
 * Reusable, accessible modal dialog shell with a backdrop, title and projected
 * body/footer content. Emits {@link closed} when the user dismisses the dialog
 * (backdrop click, Escape key or the close button).
 */
@Component({
  selector: 'app-modal',
  imports: [ButtonComponent],
  templateUrl: './modal.component.html',
  styleUrl: './modal.component.css',
})
export class ModalComponent {
  /** Dialog title shown in the header. */
  @Input() title = '';
  /** When false the dialog is not rendered. */
  @Input() open = false;
  /** Tailwind max-width class for the dialog panel. */
  @Input() maxWidth = 'max-w-md';
  /** Emits when the dialog should be dismissed. */
  @Output() closed = new EventEmitter<void>();

  /** Requests dismissal (backdrop / close button / Escape). */
  close(): void {
    this.closed.emit();
  }

  /** Handles the Escape key while the dialog is focused. */
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
    }
  }
}
