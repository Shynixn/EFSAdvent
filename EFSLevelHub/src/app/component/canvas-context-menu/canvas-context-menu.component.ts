import { Component, ElementRef, EventEmitter, Input, Output, inject, signal } from '@angular/core';

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
  /**
   * How the entries behave:
   *
   * - `choice` (default) — mutually exclusive, picking one closes the menu.
   * - `flags` — `selected` is a BITFIELD; each entry toggles its own bit and the
   *   menu stays open so several can be switched on in a row.
   * - `number` — a `−`/`+` stepper between `min` and `max` over `selected`.
   */
  kind?: 'choice' | 'flags' | 'number';
  /** Lower bound for `kind: 'number'`. */
  min?: number;
  /** Upper bound for `kind: 'number'`. */
  max?: number;
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
  host: { class: 'contents' },})
export class CanvasContextMenuComponent {
  /** This component's host element (used to resolve the positioned wrapper). */
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  /** Whether the menu is shown. */
  @Input() open = false;
  /** Left offset in pixels, relative to the positioned parent (or viewport in {@link fixed}). */
  @Input() x = 0;
  /** Top offset in pixels, relative to the positioned parent (or viewport in {@link fixed}). */
  @Input() y = 0;
  /**
   * When true the menu is positioned in **viewport** coordinates instead of the
   * positioned parent's.
   *
   * Used when the menu is opened from somewhere outside the canvas wrapper (the
   * object list), where the click position is a `clientX`/`clientY` pair and the
   * menu must appear under the pointer rather than on the canvas.
   */
  @Input() fixed = false;
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

  /**
   * Viewport X of the menu when {@link fixed} is false.
   *
   * Non-fixed callers pass coordinates relative to the canvas wrapper. The panel
   * lives in a fixed viewport layer, so the wrapper's page offset is added to
   * keep the same visual result.
   */
  get anchorX(): number {
    return this.x + this.wrapperOffset().left;
  }

  /** Viewport Y of the menu when {@link fixed} is false (see {@link anchorX}). */
  get anchorY(): number {
    return this.y + this.wrapperOffset().top;
  }

  /**
   * Viewport offset of the element the wrapper-relative coordinates belong to.
   *
   * The menu is rendered as a SIBLING of the canvas wrapper (it must not live
   * inside that positioned element, or its backdrop gets clipped by the
   * scrolling column). The wrapper is therefore the closest `.relative` element
   * within the same component host — searched among siblings when the menu is
   * not nested in it.
   */
  private wrapperOffset(): { left: number; top: number } {
    const host = this.elementRef.nativeElement as HTMLElement;
    const scope = host.parentElement;
    const wrapper =
      scope?.querySelector(':scope > .relative') ?? host.parentElement?.closest('.relative');
    const rect = (wrapper as HTMLElement | null)?.getBoundingClientRect();
    return { left: rect?.left ?? 0, top: rect?.top ?? 0 };
  }

  /** Toggles a submenu open/closed. */
  toggleGroup(id: string): void {
    this.openGroup.update((current) => (current === id ? null : id));
  }

  /** Whether a submenu is expanded. */
  isGroupOpen(id: string): boolean {
    return this.openGroup() === id;
  }

  /**
   * Closes the menu and resets the submenu state.
   *
   * When called from the backdrop the event is stopped from propagating: the
   * click that dismisses the menu must not ALSO act on whatever is underneath it
   * (a canvas hit-test, a list row, …), otherwise the menu would reopen or move.
   */
  close(event?: Event): void {
    event?.stopPropagation();
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

  /**
   * Toggles one bit of a `flags` group and keeps the menu OPEN, so several bits
   * can be switched without re-opening the menu each time.
   */
  toggleFlag(group: ContextMenuChoiceGroup, choice: ContextMenuChoice): void {
    const current = group.selected ?? 0;
    const next = (current ^ choice.value) >>> 0;
    this.choiceSelected.emit({ group: group.id, value: next });
  }

  /** Whether a `flags` group has a given bit set. */
  hasFlag(group: ContextMenuChoiceGroup, choice: ContextMenuChoice): boolean {
    return ((group.selected ?? 0) & choice.value) !== 0;
  }

  /** Steps a `number` group by `delta`, clamped to `[min, max]`, menu stays open. */
  stepNumber(group: ContextMenuChoiceGroup, delta: number): void {
    const min = group.min ?? 0;
    const max = group.max ?? 255;
    const next = Math.min(max, Math.max(min, (group.selected ?? 0) + delta));
    if (next !== group.selected) {
      this.choiceSelected.emit({ group: group.id, value: next });
    }
  }
}
