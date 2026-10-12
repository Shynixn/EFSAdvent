import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { DEFAULT_STAGE_AUTHOR, StageFile } from '../../service/stage.service';
import { SortDropdownComponent } from '../sort-dropdown/sort-dropdown.component';
import { DEFAULT_SORT, SortState, sortItems } from '../sort-dropdown/sort.util';

/** A selectable row in the picker (stage name + author). */
export interface StagePickerRow {
  id: string;
  name: string;
  author: string;
  creationDate: string;
}

/**
 * StagePickerComponent
 * --------------------
 * Inline, reusable stage search: a sort dropdown and a search box over a
 * scrollable table with two columns (name, author). Emits {@link picked} when a
 * row is clicked.
 *
 * It contains **no modal chrome**, so the caller embeds it wherever it belongs
 * (e.g. inside an `<app-modal>` on a page, or inline in a form).
 *
 * @example
 * <app-modal [open]="pickerOpen()" title="Select a stage" (closed)="closePicker()">
 *   <app-stage-picker
 *     [stages]="stages()"
 *     [selectedId]="selectedId()"
 *     (picked)="onStagePicked($event)"
 *   />
 * </app-modal>
 */
@Component({
  selector: 'app-stage-picker',
  imports: [SortDropdownComponent],
  templateUrl: './stage-picker.component.html',
})
export class StagePickerComponent {
  /** Currently selected stage id (highlighted in the table). */
  @Input() selectedId = '';
  /** Placeholder shown in the search box. */
  @Input() placeholder = 'Search by stage or author name…';

  /** Candidate stages. Accepts plain arrays; normalized into rows on change. */
  @Input()
  set stages(value: StageFile[]) {
    this.stageRows.set(
      (value ?? []).map((stage) => ({
        id: stage.id,
        name: stage.name || 'Stage',
        author: stage.author?.trim() || DEFAULT_STAGE_AUTHOR,
        creationDate: stage.creationDate ?? '',
      })),
    );
  }

  /** Emits the chosen stage id when a row is clicked. */
  @Output() picked = new EventEmitter<string>();

  /** Search query entered by the user. */
  readonly query = signal('');

  /** Current sort selection. */
  readonly sort = signal<SortState>(DEFAULT_SORT);

  /** All rows (normalized once per `stages` input change). */
  private readonly stageRows = signal<StagePickerRow[]>([]);

  /** Rows filtered by the query (name/author) and sorted by the selection. */
  readonly filtered = computed<StagePickerRow[]>(() => {
    const term = this.query().trim().toLowerCase();
    const rows = this.stageRows();
    const matched = term
      ? rows.filter(
          (row) =>
            row.name.toLowerCase().includes(term) || row.author.toLowerCase().includes(term),
        )
      : rows;
    return sortItems(matched, this.sort());
  });

  /** Updates the query from the search input. */
  onSearchInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /** Selects a row and emits its id. */
  select(row: StagePickerRow): void {
    this.picked.emit(row.id);
  }

  /** Clears the search box (used when the hosting modal closes). */
  reset(): void {
    this.query.set('');
  }
}
