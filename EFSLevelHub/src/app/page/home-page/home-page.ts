import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home-page',
  imports: [RouterLink],
  templateUrl: './home-page.html',
  styleUrl: './home-page.css',
})
export class HomePage {
  @Input() title = 'EFS Level Hub';
  @Input() subtitle = 'Browse and manage your EFS Advent levels.';
}
