import { Routes } from '@angular/router';
import { HomePage } from './page/home-page/home-page';

export const routes: Routes = [
  { path: '', component: HomePage, title: 'EFS Level Hub' },
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
  },
  { path: '**', redirectTo: '' },
];
