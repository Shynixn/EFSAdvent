import { Component, OnInit, inject } from '@angular/core';
import { IsoExtractorComponent } from '../../component/iso-extractor/iso-extractor.component';
import { ButtonComponent } from '../../component/button/button.component';
import { GameStateService } from '../../service/game-state.service';

/**
 * SettingsPage
 * ------------
 * Application settings. Currently hosts the GameCube ISO Extractor, which is
 * the prerequisite for every other feature. When no valid ISO has been imported
 * yet, an instructional banner is shown above the extractor.
 */
@Component({
  selector: 'app-settings-page',
  imports: [IsoExtractorComponent, ButtonComponent],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.css',
})
export class SettingsPage implements OnInit {
  private readonly gameState = inject(GameStateService);

  /** Whether the FSA ISO has been detected in OPFS. */
  readonly isReady = this.gameState.isReady;
  /** Whether the OPFS scan is running. */
  readonly isChecking = this.gameState.isChecking;

  ngOnInit(): void {
    void this.gameState.refresh();
  }
}
