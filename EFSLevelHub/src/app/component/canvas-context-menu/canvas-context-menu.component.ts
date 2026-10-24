import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

/** A plain action entry in a {@link CanvasContextMenuComponent}. */
export interface ContextMenuAction {
  /** Emitted as the action id when the entry is clicked. */
  id: string;
  /** Label shown in the menu. */
  label: string;
  /** Optional inline SVG path data for the leading icon. */
  icon?: string;
  /** Renders the entry in red (destructive actions). */
  danger?: boolean;
  /** Renders the entry in the accent colour (e.g. "Connect"). */
  accent?: boolean;
}

/** One selectable entry inside a {@link ContextMenuChoiceGroup}. */
export interface ContextMenuChoice {
  /** Value emitted when this entry is picked. */
  value: number;
  /** Label shown for the entry. */
  label: string;
}

/**
 * A group of mutually exclusive choices, rendered as a submenu (e.g. the door
 * "Type" menu or the player "Player Color"/"Player State" menus).
 */
export interface ContextMenuChoiceGroup {
  /** Kind discriminator so the host can tell which group emitted. */
  id: string;
  /** Label of the submenu entry. */
  label: string;
  /** Optional inline SVG path data for the leading icon. */
  icon?: string;
  /** The selectable entries. */
  choices: ContextMenuChoice[];
  /** Currently selected value (shown with a checkmark). */
  selected: number | null;
}

/**
 * CanvasContextMenuComponent
 * --------------------------
 * The single, shared right-click menu used by the room canvas.
 *
 * It renders the menu shell, a full-screen backdrop that closes it, plain
 * actions and **submenus** for groups of choices — all with identical styling,
 * so specific objects (doors, the player start, …) never hand-roll their own
 * menu markup.
 *
 * The component is purely presentational: it emits {@link actionSelected} for a
 * plain entry and {@link choiceSelected} for a submenu entry, and the host
 * decides what each one means.
 *
 * @example
 * <app-canvas-context-menu
 *   [open]="!!contextMenu()"
 *   [x]="contextMenu()?.x ?? 0"
 *   [y]="contextMenu()?.y ?? 0"
 *   [actions]="menuActions()"
 *   [choiceGroups]="menuChoiceGroups()"
 *   (closed)="closeContextMenu()"
 *   (actionSelected)="onMenuAction($event)"
 *   (choiceSelected)="onMenuChoice($event)"
 * />
 */
@Component({
  selector: 'app-canvas-context-menu',
  templateUrl: './canvas-context-menu.component.html',
  host: { class: 'contents' },
})
export class CanvasContextMenuComponent {
  /** Whether the menu is shown. */
  @Input() open = false;
  /** Left offset in pixels, relative to the positioned parent. */
  @Input() x = 0;
  /** Top offset in pixels, relative to the positioned parent. */
  @Input() y = 0;
  /** Plain action entries, rendered top to bottom. */
  @Input() actions: ContextMenuAction[] = [];
  /** Submenu groups, rendered below the actions. */
  @Input() choiceGroups: ContextMenuChoiceGroup[] = [];

  /** Emits when the menu should close (backdrop click / after a selection). */
  @Output() closed = new EventEmitter<void>();
  /** Emits the id of a clicked plain action. */
  @Output() actionSelected = new EventEmitter<string>();
  /** Emits the group id and chosen value of a submenu entry. */
  @Output() choiceSelected = new EventEmitter<{ group: string; value: number }>();

  /** Id of the submenu that is currently open, if any. */
  readonly openGroup = signal<string | null>(null);

  /** Toggles a submenu open/closed. */
  toggleGroup(id: string): void {
    this.openGroup.update((current) => (current === id ? null : id));
  }

  /** Whether a submenu is expanded. */
  isGroupOpen(id: string): boolean {
    return this.openGroup() === id;
  }

  /** Closes the menu and resets the submenu state. */
  close(): void {
    this.openGroup.set(null);
    this.closed.emit();
  }

  /** Emits a plain action and closes the menu. */
  pick(action: ContextMenuAction): void {
    this.openGroup.set(null);
    this.actionSelected.emit(action.id);
    this.closed.emit();
  }

  /** Emits a submenu choice and closes the menu. */
  pickChoice(group: ContextMenuChoiceGroup, choice: ContextMenuChoice): void {
    this.openGroup.set(null);
    this.choiceSelected.emit({ group: group.id, value: choice.value });
    this.closed.emit();
  }
}
