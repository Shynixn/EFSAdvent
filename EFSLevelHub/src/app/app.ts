import { Component, OnInit, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { SideNavComponent } from './component/side-nav/side-nav.component';
import { GameStateService } from './service/game-state.service';

@Component({
  imports: [RouterOutlet, SideNavComponent],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App implements OnInit {
  private readonly router = inject(Router);
  private readonly gameState = inject(GameStateService);

  protected readonly title = 'EFSLevelHub';

  async ngOnInit(): Promise<void> {
    // On startup, verify the game's disc assets are present. If not, route the
    // user straight to Settings so they can import their FSA ISO.
    const ready = await this.gameState.refresh();
    if (!ready) {
      await this.router.navigate(['/settings']);
    }
  }
}
