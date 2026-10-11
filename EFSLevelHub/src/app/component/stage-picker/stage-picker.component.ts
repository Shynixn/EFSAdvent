import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { ModalComponent } from '../modal/modal.component';
import { DEFAULT_STAGE_AUTHOR, StageFile } from '../../service/stage.service';

/** A selectable row in the picker (stage name + author). */
export interface StagePickerRow {
  id: string;
  name: string;
  author: string;
}

/**
 * StagePickerComponent
 * --------------------
 * A modal that lets the user pick a stage from a searchable, scrollable table
 * with two columns (name, author). Used by the world page to re-point a map
 * marker at a different stage.
 *
 * @example
 * <app-stage-picker
 *   [open]="pickerOpen()"
 *   [stages]="stages()"
 *   [selectedId]="activePoint()?.stageId ?? ''"
 *   (picked)="onStagePicked($event)"
 *   (closed)="pickerOpen.set(false)"
 * />
 */
@Component({
  selector: 'app-stage-picker',
  imports: [ModalComponent],
  templateUrl: './stage-picker.component.html',
})
export class StagePickerComponent {
  /** Whether the picker is visible. */
  @Input() open = false;
  /** Currently selected stage id (highlighted in the table). */
  @Input() selectedId = '';
  /** Title shown in the modal header. */
  @Input() title = 'Select a stage';

  /** Candidate stages. Accepts plain arrays or signals via the setter below. */
  @Input()
  set stages(value: StageFile[]) {
    this.stageRows.set(
      (value ?? []).map((stage) => ({
        id: stage.id,
        name: stage.name || 'Stage',
        author: stage.author?.trim() || DEFAULT_STAGE_AUTHOR,
      })),
    );
  }

  /** Emits the chosen stage id when the user confirms a selection. */
  @Output() picked = new EventEmitter<string>();
  /** Emits when the dialog should be dismissed. */
  @Output() closed = new EventEmitter<void>();

  /** Search query entered by the user. */
  readonly query = signal('');

  /** All rows (normalized once per `stages` input change). */
  private readonly stageRows = signal<StagePickerRow[]>([]);

  /** Rows filtered by the current query (matches name or author). */
  readonly filtered = computed<StagePickerRow[]>(() => {
    const term = this.query().trim().toLowerCase();
    const rows = this.stageRows();
    if (!term) {
      return rows;
    }
    return rows.filter(
      (row) => row.name.toLowerCase().includes(term) || row.author.toLowerCase().includes(term),
    );
  });

  /** Updates the query from the search input. */
  onSearchInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /** Selects a row and emits the chosen stage id. */
  select(row: StagePickerRow): void {
    this.picked.emit(row.id);
  }

  /** Requests dismissal. */
  close(): void {
    this.closed.emit();
  }

  /** Clears the search box (used after closing). */
  reset(): void {
    this.query.set('');
  }
}
