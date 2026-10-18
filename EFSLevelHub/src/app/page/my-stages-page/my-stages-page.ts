import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CardComponent } from '../../component/card/card.component';
import { ModalComponent } from '../../component/modal/modal.component';
import { ButtonComponent } from '../../component/button/button.component';
import { StagePickerComponent } from '../../component/stage-picker/stage-picker.component';
import { SortDropdownComponent } from '../../component/sort-dropdown/sort-dropdown.component';
import { DEFAULT_SORT, SortState, sortItems } from '../../component/sort-dropdown/sort.util';
import { MIN_STAGE_NAME_LENGTH, StageFile, StageService } from '../../service/stage.service';
import { StageTabsService } from '../../service/stage-tabs.service';
import { StagePreviewService } from '../../service/stage-preview.service';
import { EditorService, WORLDMAP_FILE } from '../../service/editor.service';
import { LoggingService } from '../../service/logging.service';

/**
 * MyStagesPage
 * ------------
 * Lists the stages registered in the editor. A leading "+" card opens a choice
 * modal that either imports a shared stage package (a `.fsastage` file — a ZIP
 * with a `manifest.json` and a `stage.arc`) or creates a new stage from an
 * existing one used as a template. Until a stage's own map preview is generated
 * (which happens lazily when a stage is opened), each card shows the shared
 * world map image.
 */
@Component({
  selector: 'app-my-stages-page',
  imports: [
    CardComponent,
    ModalComponent,
    ButtonComponent,
    StagePickerComponent,
    SortDropdownComponent,
    FormsModule,
  ],
  templateUrl: './my-stages-page.html',
  styleUrl: './my-stages-page.css',
})
export class MyStagesPage implements OnInit {
  private readonly stageService = inject(StageService);
  private readonly stageTabs = inject(StageTabsService);
  private readonly stagePreview = inject(StagePreviewService);
  private readonly editor = inject(EditorService);
  private readonly router = inject(Router);
  private readonly logger = inject(LoggingService);

  /** All registered stages. */
  readonly stages = this.stageService.stages;

  /** Current sort selection. */
  readonly sort = signal<SortState>(DEFAULT_SORT);

  /** Stages in the selected sort order. */
  readonly sortedStages = computed(() => sortItems(this.stages(), this.sort()));

  /** Blob URL of the shared world map image (used as a placeholder preview). */
  readonly worldmapUrl = signal<string | null>(null);

  /** Per-stage thumbnail blob URLs (only present once generated). */
  private readonly thumbnails = signal<Record<string, string>>({});

  /** Whether the "choose create/import" modal is open. */
  readonly choiceOpen = signal(false);
  /** Whether the "create stage" modal is open. */
  readonly createOpen = signal(false);
  /** Whether the "import stage package" modal is open. */
  readonly importOpen = signal(false);

  /**
   * Open card context menu: the stage it targets plus its position in viewport
   * (client) pixels. `null` when closed.
   */
  readonly stageMenu = signal<{ stage: StageFile; x: number; y: number } | null>(null);

  /** Stage awaiting delete confirmation, or `null` when the dialog is closed. */
  readonly deleteTarget = signal<StageFile | null>(null);
  /** Delete error message, if any. */
  readonly deleteError = signal('');
  /** Whether a delete operation is in flight. */
  readonly deleting = signal(false);

  /** Name entered in the "create stage" modal. */
  readonly newName = signal('');
  /** Author entered in the "create stage" modal. */
  readonly newAuthor = signal('');
  /** Id of the chosen template stage, or `null` when none is selected. */
  readonly templateId = signal<string | null>(null);
  /** Validation / creation error message. */
  readonly createError = signal('');
  /** Whether a create/import operation is in flight. */
  readonly busy = signal(false);

  /** Minimum characters required for a stage name (for the hint text). */
  readonly minNameLength = MIN_STAGE_NAME_LENGTH;

  ngOnInit(): void {
    void this.init();
  }

  /** Loads stages and resolves the shared world map image. */
  private async init(): Promise<void> {
    await this.stageService.load();
    await this.loadWorldmap();
    await this.loadThumbnails();
  }

  /** Human-readable author of a stage (with the game's fallback). */
  authorOf(stage: StageFile): string {
    return this.stageService.authorOf(stage);
  }

  /** Preview image for a stage card: its thumbnail when generated, else the world map. */
  previewFor(stage: StageFile): string | null {
    return this.thumbnails()[stage.id] ?? this.worldmapUrl();
  }

  /**
   * How the card should fit the preview image: stage thumbnails are centred
   * (`contain`), the shared world map placeholder fills the box (`cover`).
   */
  previewFit(stage: StageFile): 'cover' | 'contain' {
    return this.thumbnails()[stage.id] ? 'contain' : 'cover';
  }

  /** Loads each stage's cached thumbnail (if any) as a blob URL. */
  private async loadThumbnails(): Promise<void> {
    const map: Record<string, string> = {};
    for (const stage of this.stages()) {
      const url = await this.stagePreview.readThumbnailUrl(stage.id);
      if (url) {
        map[stage.id] = url;
      }
    }
    this.thumbnails.set(map);
  }

  /** Opens the initial choice modal. */
  openChoice(): void {
    this.choiceOpen.set(true);
  }

  /** Opens a stage in a new tab and navigates to its page. */
  openStage(stage: StageFile): void {
    this.closeStageMenu();
    this.stageTabs.open(stage.id);
    void this.router.navigate(['/my-stages', stage.id]);
  }

  /**
   * Opens the card context menu at the pointer position.
   *
   * The position is stored in CLIENT pixels and the menu is rendered `fixed`, so
   * it appears under the cursor regardless of page scroll.
   */
  onStageContextMenu(event: MouseEvent, stage: StageFile): void {
    event.preventDefault();
    event.stopPropagation();
    this.stageMenu.set({ stage, x: event.clientX, y: event.clientY });
  }

  /** Closes the card context menu. */
  closeStageMenu(): void {
    this.stageMenu.set(null);
  }

  /** Opens the delete-confirmation dialog for a stage (closing the menu first). */
  openDelete(stage: StageFile): void {
    this.closeStageMenu();
    this.deleteError.set('');
    this.deleteTarget.set(stage);
  }

  /** Closes the delete-confirmation dialog. */
  closeDelete(): void {
    this.deleteTarget.set(null);
  }

  /**
   * Deletes the stage awaiting confirmation.
   *
   * Its open tabs are closed first so no page keeps editing a stage whose files
   * no longer exist, then the cached thumbnail URL is revoked.
   */
  async confirmDelete(): Promise<void> {
    const stage = this.deleteTarget();
    if (!stage || this.deleting()) {
      return;
    }
    this.deleting.set(true);
    this.deleteError.set('');
    try {
      const removed = await this.stageService.deleteStage(stage.id);
      if (!removed) {
        this.deleteError.set('This stage could not be deleted.');
        return;
      }
      this.stageTabs.close(stage.id);
      this.stagePreview.revokeThumbnail(this.thumbnails()[stage.id]);
      this.thumbnails.update((map) => {
        const { [stage.id]: _removed, ...rest } = map;
        return rest;
      });
      this.closeDelete();
    } catch (error) {
      this.logger.error('MyStages: failed to delete stage', error);
      this.deleteError.set('Could not delete the stage.');
    } finally {
      this.deleting.set(false);
    }
  }

  /** Closes the choice modal. */
  closeChoice(): void {
    this.choiceOpen.set(false);
  }

  /** Opens the "create stage" modal with a clean form. */
  openCreate(): void {
    this.choiceOpen.set(false);
    this.newName.set('');
    this.newAuthor.set('');
    this.templateId.set(null);
    this.createError.set('');
    this.busy.set(false);
    this.createOpen.set(true);
  }

  /** Closes the "create stage" modal. */
  closeCreate(): void {
    this.createOpen.set(false);
  }

  /** Opens the "import stage package" modal. */
  openImport(): void {
    this.choiceOpen.set(false);
    this.createError.set('');
    this.busy.set(false);
    this.importOpen.set(true);
  }

  /** Closes the "import stage package" modal. */
  closeImport(): void {
    this.importOpen.set(false);
  }

  /** Selects (or clears) the template stage used as a base. */
  chooseTemplate(stageId: string): void {
    this.templateId.set(this.templateId() === stageId ? null : stageId);
  }

  /** Creates a stage from the form values. */
  async createStage(): Promise<void> {
    if (this.busy()) {
      return;
    }
    const name = this.newName().trim();
    if (name.length < MIN_STAGE_NAME_LENGTH) {
      this.createError.set(`Enter a name of at least ${MIN_STAGE_NAME_LENGTH} characters.`);
      return;
    }
    if (!this.newAuthor().trim()) {
      this.createError.set('Enter an author.');
      return;
    }
    const templateId = this.templateId();
    if (!templateId) {
      this.createError.set('Select a base template stage.');
      return;
    }

    this.busy.set(true);
    this.createError.set('');
    try {
      const stage = await this.stageService.createStage(name, this.newAuthor(), templateId);
      if (!stage) {
        this.createError.set('Could not create the stage — check the name, author and template.');
        return;
      }
      this.closeCreate();
    } catch (error) {
      this.logger.error('MyStages: failed to create stage', error);
      this.createError.set('Something went wrong creating the stage.');
    } finally {
      this.busy.set(false);
    }
  }

  /** Handles a `.fsastage` selection and imports it. */
  async onZipSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Allow re-selecting the same file later.
    input.value = '';
    if (!file) {
      return;
    }

    this.createError.set('');
    // The file picker filters by extension, but a dropped/renamed file can still
    // get through — accept the extension case-insensitively.
    if (!/\.fsastage$/i.test(file.name)) {
      this.createError.set('Please choose a stage package (.fsastage file).');
      return;
    }

    this.busy.set(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const stage = await this.stageService.importStageZip(bytes);
      if (!stage) {
        this.createError.set(
          'That file is not a valid .fsastage package (needs manifest.json and stage.arc).',
        );
        return;
      }
      this.closeImport();
    } catch (error) {
      this.logger.error('MyStages: failed to import stage package', error);
      this.createError.set('Could not read the selected stage package.');
    } finally {
      this.busy.set(false);
    }
  }

  /** Loads `/editor/cache/image/worldmap.png` from OPFS as a blob URL. */
  private async loadWorldmap(): Promise<void> {
    try {
      const bytes = await this.editor.readEditorFile(WORLDMAP_FILE);
      if (!bytes) {
        this.logger.warn('MyStages: world map image not found yet.');
        return;
      }
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'image/png' });
      this.worldmapUrl.set(URL.createObjectURL(blob));
    } catch (error) {
      this.logger.error('MyStages: failed to load world map image', error);
    }
  }
}
