import { Routes } from '@angular/router';
import { HomePage } from './page/home-page/home-page';

export const routes: Routes = [
  { path: '', component: HomePage, title: 'EFS Level Hub' },
  { path: '**', redirectTo: '' },
];
