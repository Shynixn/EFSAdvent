import { Routes } from '@angular/router';
import { LevelExplorerPage } from './page/level-explorer-page/level-explorer-page';
import { requiresGameFilesGuard } from './guard/requires-game-files.guard';

export const routes: Routes = [
  {
    path: '',
    component: LevelExplorerPage,
    title: 'Level Explorer',
    canActivate: [requiresGameFilesGuard],
  },
  {
    path: 'level-explorer',
    component: LevelExplorerPage,
    title: 'Level Explorer',
    canActivate: [requiresGameFilesGuard],
  },
  {
    path: 'my-stages',
    loadComponent: () => import('./page/my-stages-page/my-stages-page').then((m) => m.MyStagesPage),
    title: 'My Stages',
    canActivate: [requiresGameFilesGuard],
  },
  {
    path: 'my-worlds',
    loadComponent: () => import('./page/my-worlds-page/my-worlds-page').then((m) => m.MyWorldsPage),
    title: 'My Worlds',
    canActivate: [requiresGameFilesGuard],
  },
  {
    path: 'settings',
    loadComponent: () => import('./page/settings-page/settings-page').then((m) => m.SettingsPage),
    title: 'Settings',
  },
  {
    path: 'extract',
    loadComponent: () =>
      import('./component/iso-extractor/iso-extractor.component').then(
        (m) => m.IsoExtractorComponent,
      ),
    title: 'ISO Extractor',
  },
  {
    path: 'map-viewer',
    loadComponent: () =>
      import('./component/map-viewer/map-viewer.component').then((m) => m.MapViewerComponent),
    title: 'Map Viewer',
    canActivate: [requiresGameFilesGuard],
  },
  { path: '**', redirectTo: '' },
];
