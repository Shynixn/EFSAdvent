import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';

/** Visual style of a button. */
export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';

/** Accent colour used by the button variants. */
export type ButtonColor = 'indigo' | 'emerald' | 'red' | 'slate';

/** Size preset for a button. */
export type ButtonSize = 'sm' | 'md';

/**
 * ButtonComponent
 * ---------------
 * Unified button/link styling used everywhere in the app so every action looks
 * consistent. Renders an `<a>` when {@link routerLink} is set, otherwise a
 * `<button>`.
 *
 * @example
 * <app-button variant="primary" (clicked)="save()">Save</app-button>
 * <app-button variant="outline" color="red" (clicked)="clear()">Clear</app-button>
 */
@Component({
  selector: 'app-button',
  imports: [RouterLink, NgTemplateOutlet],
  templateUrl: './button.component.html',
  styleUrl: './button.component.css',
})
export class ButtonComponent {
  /** Visual style. */
  @Input() variant: ButtonVariant = 'primary';
  /** Accent colour. */
  @Input() color: ButtonColor = 'indigo';
  /** Size preset. */
  @Input() size: ButtonSize = 'md';
  /** Native button type (ignored when rendered as a link). */
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  /** When set, renders an anchor instead of a button. */
  @Input() routerLink: string | unknown[] | null = null;
  /** Disables interaction and dims the button. */
  @Input() disabled = false;
  /** Stretches the button to fill its container width. */
  @Input() fullWidth = false;
  /** Optional tooltip / accessible title. */
  @Input() title = '';
  /**
   * Optional inline SVG path data (`d` attribute) rendered as a leading icon.
   * Ignored when {@link iconOnly} draws it as the sole content.
   */
  @Input() icon = '';
  /** Renders only the icon (no projected content). */
  @Input() iconOnly = false;
  /** Emits on click when enabled. */
  @Output() clicked = new EventEmitter<MouseEvent>();

  /** Handles a click, suppressing it when disabled. */
  onClick(event: MouseEvent): void {
    if (this.disabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    this.clicked.emit(event);
  }

  /** Resolves the Tailwind class string for the current inputs. */
  get classes(): string {
    return [
      BASE,
      SIZES[this.size],
      VARIANTS[this.variant][this.color],
      this.fullWidth ? 'w-full' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
}

/** Classes shared by every button variant. */
const BASE =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50';

/** Size presets. */
const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};

/** Variant + colour combinations. */
const VARIANTS: Record<ButtonVariant, Record<ButtonColor, string>> = {
  primary: {
    indigo: 'bg-indigo-500 text-white shadow hover:bg-indigo-400',
    emerald: 'bg-emerald-500 text-white shadow hover:bg-emerald-400',
    red: 'bg-red-500 text-white shadow hover:bg-red-400',
    slate: 'bg-slate-600 text-white shadow hover:bg-slate-500',
  },
  outline: {
    indigo: 'border border-indigo-400/60 text-indigo-100 hover:border-indigo-300 hover:text-white',
    emerald:
      'border border-emerald-400/60 text-emerald-100 hover:border-emerald-300 hover:text-white',
    red: 'border border-red-500/60 text-red-300 hover:border-red-400 hover:text-red-200',
    slate: 'border border-slate-600 text-slate-200 hover:border-slate-400 hover:text-white',
  },
  ghost: {
    indigo: 'text-indigo-200 hover:bg-indigo-500/15 hover:text-white',
    emerald: 'text-emerald-200 hover:bg-emerald-500/15 hover:text-white',
    red: 'text-red-300 hover:bg-red-500/15 hover:text-red-200',
    slate: 'text-slate-300 hover:bg-slate-800 hover:text-white',
  },
  danger: {
    indigo: 'bg-red-500 text-white shadow hover:bg-red-400',
    emerald: 'bg-red-500 text-white shadow hover:bg-red-400',
    red: 'bg-red-500 text-white shadow hover:bg-red-400',
    slate: 'bg-red-500 text-white shadow hover:bg-red-400',
  },
};
