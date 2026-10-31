import { Component, Input } from '@angular/core';
import { ModalComponent } from '../modal/modal.component';

/**
 * LoadingModalComponent
 * ---------------------
 * A modal that shows only a spinner and a status message while work is in
 * progress. It is not dismissible (no close button, backdrop click is ignored)
 * so the user waits for the operation to finish.
 *
 * @example
 * <app-loading-modal [open]="isGenerating()" [message]="progress()" />
 */
@Component({
  selector: 'app-loading-modal',
  imports: [ModalComponent],
  templateUrl: './loading-modal.component.html',
})
export class LoadingModalComponent {
  /** Whether the modal is visible. */
  @Input() open = false;
  /** Title shown in the modal header. */
  @Input() title = 'Generating previews';
  /** Status message shown under the spinner. */
  @Input() message = 'Please wait…';
}
