import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SORT_OPTIONS, SortState } from './sort.util';

/**
 * SortDropdownComponent
 * ---------------------
 * Reusable sort selector offering the standard options (creation date and
 * alphabetically, each ascending/descending). Emits the chosen
 * {@link SortState} whenever the selection changes.
 *
 * @example
 * <app-sort-dropdown [value]="sort()" (changed)="sort.set($event)" />
 */
@Component({
  selector: 'app-sort-dropdown',
  imports: [FormsModule],
  templateUrl: './sort-dropdown.component.html',
})
export class SortDropdownComponent {
  /** Currently selected sort state. */
  @Input() value: SortState = SORT_OPTIONS[0].state;
  /** Optional label shown before the select. */
  @Input() label = 'Sort';

  /** Emits the newly selected sort state. */
  @Output() changed = new EventEmitter<SortState>();

  /** Options rendered in the dropdown. */
  readonly options = SORT_OPTIONS;

  /** Current selection id (used as the `<select>` value). */
  get selectedId(): string {
    return `${this.value.field}:${this.value.direction}`;
  }

  /** Resolves the chosen option id back to a {@link SortState} and emits it. */
  onSelectionChange(id: string): void {
    const option = this.options.find((candidate) => candidate.id === id);
    if (option) {
      this.changed.emit(option.state);
    }
  }
}
