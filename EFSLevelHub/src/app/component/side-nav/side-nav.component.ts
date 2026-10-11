import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { GameStateService } from '../../service/game-state.service';
import { WorldTabsService } from '../../service/world-tabs.service';

/** A single entry in the application's side navigation. */
export interface NavItem {
  label: string;
  route: string;
  /** Inline SVG path data (`d` attribute) for the item's icon. */
  icon: string;
  /** When true, the item is highlighted as the primary entry point. */
  primary?: boolean;
}

/**
 * SideNavComponent
 * ----------------
 * Collapsible application shell navigation. On wide screens it collapses to an
 * icon-only rail; the collapsed state is remembered for the session.
 */
@Component({
  selector: 'app-side-nav',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './side-nav.component.html',
  styleUrl: './side-nav.component.css',
})
export class SideNavComponent {
  private readonly gameState = inject(GameStateService);
  private readonly worldTabs = inject(WorldTabsService);

  /** Whether the rail is collapsed to icons only. */
  readonly collapsed = signal(false);

  /** Whether the ISO has been imported (drives the settings warning badge). */
  readonly isoReady = this.gameState.isReady;

  /** Open world tabs, shown nested under "My Worlds". */
  readonly worldTabsList = this.worldTabs.tabs;

  /** Navigation entries rendered top-to-bottom. */
  readonly items: NavItem[] = [
    {
      label: 'My Stages',
      route: '/my-stages',
      icon: 'M4 3a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1H4zm2 3h8v2H6V6zm0 4h8v2H6v-2zm0 4h5v2H6v-2z',
    },
    {
      label: 'My Worlds',
      route: '/my-worlds',
      icon: 'M10 2a8 8 0 100 16 8 8 0 000-16zM4.5 10a5.5 5.5 0 019.4-3.9c-.5.8-1 1.5-1.7 1.9-.6.3-1.3.3-1.9.6-.7.4-1 1.2-1.4 1.9-.4.8-1.2 1.4-2 1.6-.6.2-1.2.1-1.8-.1A5.5 5.5 0 014.5 10zm5.5 5.5c-.6 0-1.2-.1-1.7-.3.3-.6.8-1 1.5-1.2.6-.2 1.3-.1 1.9.1.5.2 1 .5 1.5.9a5.5 5.5 0 01-3.2.5z',
    },
    {
      label: 'Level Explorer',
      route: '/level-explorer',
      primary: true,
      icon: 'M3 4.5A1.5 1.5 0 014.5 3h4A1.5 1.5 0 0110 4.5v4A1.5 1.5 0 018.5 10h-4A1.5 1.5 0 013 8.5v-4zM3 12.5A1.5 1.5 0 014.5 11h4A1.5 1.5 0 0110 12.5v2A1.5 1.5 0 018.5 16h-4A1.5 1.5 0 013 14.5v-2zM11 4.5A1.5 1.5 0 0112.5 3h3A1.5 1.5 0 0117 4.5v9A1.5 1.5 0 0115.5 15h-3A1.5 1.5 0 0111 13.5v-9z',
    },
    {
      label: 'Settings',
      route: '/settings',
      icon: 'M10 6.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM8.5 10a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM8.9 1.5a1 1 0 00-.98.8l-.28 1.41a6.5 6.5 0 00-1.2.7l-1.35-.5a1 1 0 00-1.2.44l-1.1 1.9a1 1 0 00.2 1.25l1.06.96a6.6 6.6 0 000 1.39l-1.06.96a1 1 0 00-.2 1.25l1.1 1.9a1 1 0 001.2.44l1.35-.5c.38.28.78.51 1.2.7l.28 1.41a1 1 0 00.98.8h2.2a1 1 0 00.98-.8l.28-1.41c.42-.19.82-.42 1.2-.7l1.35.5a1 1 0 001.2-.44l1.1-1.9a1 1 0 00-.2-1.25l-1.06-.96a6.6 6.6 0 000-1.39l1.06-.96a1 1 0 00.2-1.25l-1.1-1.9a1 1 0 00-1.2-.44l-1.35.5a6.5 6.5 0 00-1.2-.7l-.28-1.41a1 1 0 00-.98-.8H8.9z',
    },
    {
      label: 'Debug',
      route: '/debug',
      icon: 'M4 3a1 1 0 00-1 1v1.5h14V4a1 1 0 00-1-1H4zM3 8v6a1 1 0 001 1h.5l1.4 2.1a.75.75 0 101.25-.8L6.5 15h7l-.65.3a.75.75 0 101.25.8L15.5 15h.5a1 1 0 001-1V8H3zm4 2.25a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0v-2.5zm3.25-.75a.75.75 0 01.75.75v2.5a.75.75 0 01-1.5 0v-2.5a.75.75 0 01.75-.75zm4.75.75a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0v-2.5z',
    },
  ];

  /** Toggles the collapsed (icon-only) state. */
  toggle(): void {
    this.collapsed.update((value) => !value);
  }

  /**
   * Whether a nav item is locked. Every entry except Settings requires the game
   * files to be imported first.
   */
  isLocked(item: NavItem): boolean {
    return !this.isoReady() && item.route !== '/settings';
  }
}
