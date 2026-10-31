import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { LevelExplorerPage } from './page/level-explorer-page/level-explorer-page';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes)],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});

describe('LevelExplorerPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LevelExplorerPage],
      providers: [provideRouter(routes)],
    }).compileComponents();
  });

  it('should render the page title', () => {
    const fixture = TestBed.createComponent(LevelExplorerPage);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('FSA Maker');
  });

  it('should render example level cards', () => {
    const fixture = TestBed.createComponent(LevelExplorerPage);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('article').length).toBeGreaterThan(0);
  });
});
