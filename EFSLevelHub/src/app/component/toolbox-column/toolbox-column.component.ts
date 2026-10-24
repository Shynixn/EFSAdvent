import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  effect,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { TilePaletteComponent } from '../tile-palette/tile-palette.component';
import { StageRenderer } from '../../service/render/stage-renderer';
import {
  SMART_OBJECT_DEFINITIONS,
  SmartObjectDefinition,
  findSmartObjectDefinition,
  smartObjectBounds,
  renderSmartObjectPreview,
} from '../../entity/smartobject.entity';
import {
  ACTOR_TEMPLATE_SECTIONS,
  ActorTemplate,
  ActorTemplateSection,
  actorTemplatesFor,
} from '../../entity/actor-template.entity';
import { GROUND_DEFINITIONS, GroundDefinition } from '../../entity/ground.entity';
import { SmartObjectDragService } from '../../service/smart-object-drag.service';
import { ActorSpriteService } from '../../service/actor-sprite.service';
import { hideNativeDragImage } from '../../util/drag';
import {
  PLAYER_START_ACTOR_ID,
  PLAYER_START_DEFINITION,
} from '../../entity/smartobject/player-start.entity';
import { GOAL_DEFINITION } from '../../entity/smartobject/goal.entity';
import { FORCE_GEM_DEFINITION } from '../../entity/smartobject/force-gem.entity';
import { EditorService } from '../../service/editor.service';
import { ImageBuffer } from '../../service/render/gba-tile-renderer';

/**
 * ToolboxColumnComponent
 * ----------------------
 * The room page's right "Toolbox" column. It opens with **tabs for the actor
 * templates** (Items, NPC, Objects, Special, Switches — the EFSAdvent
 * `data/actortemplates` catalog), each listing draggable presets with mini
 * previews. Below the tabs it hosts an **Advanced** collapsible section (manual
 * tile drawing + the {@link TilePaletteComponent}), the Ground, Doors,
 * Decorations and Enemies sections.
 *
 * The host owns the brush/tool state; this component renders the rail and
 * reports interactions (`tilePicked`, `advancedOpenChange`).
 *
 * @example
 * <app-toolbox-column
 *   [renderer]="renderer()"
 *   [gba]="gba()"
 *   [brushTile]="brushTile()"
 *   (advancedOpenChange)="advancedOpen.set($event)"
 *   (tilePicked)="brushTile.set($event)"
 * />
 */
@Component({
  selector: 'app-toolbox-column',
  imports: [TilePaletteComponent],
  templateUrl: './toolbox-column.component.html',
  host: { class: 'block h-full w-full' },
})
export class ToolboxColumnComponent implements AfterViewInit {
  /** Stage renderer used to draw the tile palette and decoration previews. */
  private _renderer: StageRenderer | null = null;
  @Input()
  get renderer(): StageRenderer | null {
    return this._renderer;
  }
  set renderer(value: StageRenderer | null) {
    this._renderer = value;
    queueMicrotask(() => void this.drawPreviews());
  }

  /** Whether the GBA tileset is used for the palette/previews. */
  private _gba = false;
  @Input()
  get gba(): boolean {
    return this._gba;
  }
  set gba(value: boolean) {
    this._gba = value;
    queueMicrotask(() => void this.drawPreviews());
  }

  /**
   * Currently selected tileset theme index. Changing it swaps the tileset used
   * for every preview, so the whole toolbox repaints when this input changes.
   */
  @Input()
  set themeIndex(value: number) {
    if (value === this._themeIndex) {
      return;
    }
    this._themeIndex = value;
    queueMicrotask(() => void this.drawPreviews());
  }
  get themeIndex(): number {
    return this._themeIndex;
  }
  private _themeIndex = -1;

  /** Currently selected brush tile (shown in the Advanced section). */
  @Input() brushTile = 0;

  /** Id of the currently selected ground (none selected when empty). */
  @Input() selectedGroundId = '';

  /** Emits the Advanced section's open state whenever it changes. */
  @Output() advancedOpenChange = new EventEmitter<boolean>();
  /** Emits the tile value when the user picks a tile from the palette. */
  @Output() tilePicked = new EventEmitter<number>();
  /** Emits the ground definition when the user picks a ground. */
  @Output() groundPicked = new EventEmitter<GroundDefinition>();
  /** Emits when the user clears the selected ground (deselect). */
  @Output() groundCleared = new EventEmitter<void>();
  /** Emits when a decoration drag starts (host switches to the hand tool). */
  @Output() decorationDragStarted = new EventEmitter<void>();

  private readonly dragService = inject(SmartObjectDragService);

  /** Icons generated from the game data at ISO-import time (lazy fallback). */
  private readonly actorSprites = inject(ActorSpriteService);
  private readonly editor = inject(EditorService);

  /** Decoded fallback icons, keyed by actor id (blob URLs are cheap to reuse). */
  private readonly iconCache = new Map<string, ImageBitmap | null>();

  /** Whether the Advanced (manual drawing) section is expanded. */
  readonly advancedOpen = signal(true);

  /** Whether the Ground section is expanded. */
  readonly groundOpen = signal(true);

  /** Whether the Start & End section is expanded. */
  readonly startEndOpen = signal(true);

  /** Whether the Walls section is expanded. */
  readonly wallsOpen = signal(true);

  /** Whether the Decorations section is expanded. */
  readonly decorationsOpen = signal(true);

  /** Whether the Enemies section is expanded. */
  readonly enemiesOpen = signal(true);

  /** Whether the NPC section is expanded. */
  readonly npcsOpen = signal(true);

  /** Whether the Items section is expanded. */
  readonly itemsOpen = signal(true);

  /** Whether the Misc (actor template) section is expanded. */
  readonly miscOpen = signal(true);

  /**
   * Toolbox tabs. Each tab groups related sections; every section starts
   * expanded.
   *
   * - **Common**: the tile-level pieces used in most rooms (ground, walls,
   *   decorations, advanced tile reference, start/end markers).
   * - **Items+NPC**: actor-baked smart objects that are picked up or talked to
   *   (collectibles and NPCs).
   * - **Misc**: everything else — the EFSAdvent actor presets, plus the doors.
   */
  readonly tabs = ['Common', 'Items & NPC', 'Misc'] as const;

  /** The tab currently selected. */
  readonly activeTab = signal<(typeof this.tabs)[number]>('Common');

  /** Switches tabs. */
  selectTab(tab: (typeof this.tabs)[number]): void {
    this.activeTab.set(tab);
  }

  /** The actor-template tabs, in display order. */
  readonly sections = ACTOR_TEMPLATE_SECTIONS;

  /** The tab currently selected (opens on the first one, Items). */
  readonly activeSection = signal<ActorTemplateSection>(ACTOR_TEMPLATE_SECTIONS[0]);

  /** Templates listed in the selected tab. */
  get templates(): ActorTemplate[] {
    return actorTemplatesFor(this.activeSection());
  }

  /** Available decoration (smart-object) definitions, shown in the toolbox. */
  readonly decorations: SmartObjectDefinition[] = SMART_OBJECT_DEFINITIONS;

  /** Definitions in the "Doors" section. */
  readonly doorDefinitions: SmartObjectDefinition[] = SMART_OBJECT_DEFINITIONS.filter(
    (definition) => definition.section === 'Doors',
  );

  /** Definitions in the "Decorations" section. */
  readonly otherDefinitions: SmartObjectDefinition[] = SMART_OBJECT_DEFINITIONS.filter(
    (definition) => definition.section !== 'Doors',
  );

  /** Placable enemies (actor-baked smart objects), shown in the Enemies section. */
  private _enemies: SmartObjectDefinition[] = [];
  @Input()
  get enemies(): SmartObjectDefinition[] {
    return this._enemies;
  }
  set enemies(value: SmartObjectDefinition[]) {
    this._enemies = value ?? [];
    // The catalog arrives asynchronously; repaint the thumbnails once it does.
    queueMicrotask(() => void this.drawPreviews());
  }

  /** Placable NPCs (actor-baked smart objects), shown in the NPC section. */
  private _npcs: SmartObjectDefinition[] = [];
  @Input()
  get npcs(): SmartObjectDefinition[] {
    return this._npcs;
  }
  set npcs(value: SmartObjectDefinition[]) {
    this._npcs = value ?? [];
    queueMicrotask(() => void this.drawPreviews());
  }

  /** Available ground definitions, shown in the Ground box. */
  readonly grounds: GroundDefinition[] = GROUND_DEFINITIONS;

  /** The per-decoration mini preview canvases. */
  private readonly previewCanvases = viewChildren<ElementRef<HTMLCanvasElement>>('decoPreview');

  /** The per-ground mini preview canvases. */
  private readonly groundCanvases = viewChildren<ElementRef<HTMLCanvasElement>>('groundPreview');

  /** The per-enemy mini preview canvases. */
  private readonly enemyCanvases = viewChildren<ElementRef<HTMLCanvasElement>>('enemyPreview');

  /** The per-actor-template mini preview canvases. */
  private readonly templateCanvases =
    viewChildren<ElementRef<HTMLCanvasElement>>('templatePreview');

  /** The player-start preview canvas (Common → Start & End). */
  private readonly playerStartCanvases =
    viewChildren<ElementRef<HTMLCanvasElement>>('playerStartPreview');

  constructor() {
    // Redraw the mini previews once the canvases are available.
    effect(() => {
      this.previewCanvases();
      this.groundCanvases();
      this.enemyCanvases();
      this.templateCanvases();
      this.playerStartCanvases();
      this.startEndCanvases();
      queueMicrotask(() => void this.drawPreviews());
    });
  }

  ngAfterViewInit(): void {
    void this.drawPreviews();
  }

  /** Renders each decoration's mini preview into its canvas (once loaded). */
  private async drawPreviews(): Promise<void> {
    const renderer = this._renderer;
    if (!renderer) {
      return;
    }
    await renderer.prepareTileset();
    const canvases = this.previewCanvases();
    // Match each canvas to its definition by id, so collapsing a section (which
    // removes its canvases from the DOM) does not shift the mapping.
    for (const ref of canvases) {
      const id = ref.nativeElement.dataset['decoId'];
      const definition = id ? findSmartObjectDefinition(id) : undefined;
      const canvas = ref.nativeElement;
      if (!definition) {
        continue;
      }
      const bounds = smartObjectBounds(definition);
      canvas.width = bounds.cols * 16;
      canvas.height = bounds.rows * 16;
      const buffer = renderSmartObjectPreview(definition, (target, px, py, tileId) =>
        renderer.drawTilesetTile(target, px, py, tileId, this._gba),
      );
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        continue;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(buffer.pixels), buffer.width, buffer.height),
        0,
        0,
      );
    }

    // Ground swatches: a single representative tile per ground.
    const groundCanvases = this.groundCanvases();
    for (let i = 0; i < this.grounds.length && i < groundCanvases.length; i++) {
      const ground = this.grounds[i];
      const canvas = groundCanvases[i].nativeElement;
      canvas.width = 16;
      canvas.height = 16;
      const buffer = new ImageBuffer(16, 16);
      buffer.fill(0, 0, 0, 0);
      renderer.drawTilesetTile(buffer, 0, 0, ground.tile, this._gba);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        continue;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(buffer.pixels), buffer.width, buffer.height),
        0,
        0,
      );
    }

    // Actor-template thumbnails: render each preset's actor with ITS OWN
    // variable, so e.g. the KEY0 presets show a key, the big key, a bracelet…
    // (the actor picks its sprite from the variable's render variants).
    const templateCanvases = this.templateCanvases();
    if (templateCanvases.length > 0) {
      try {
        await renderer.prepareActors();
      } catch {
        // Sprite sheets may be missing for this stage; skip the thumbnails.
      }
      const byId = new Map(this.templates.map((template) => [template.id, template]));
      for (const ref of templateCanvases) {
        const id = ref.nativeElement.dataset['templateId'];
        const template = id ? byId.get(id) : undefined;
        const canvas = ref.nativeElement;
        if (!template) {
          continue;
        }
        // Bake with the template's variable (this is what makes the preview and
        // the placement match).
        const buffer = await renderer.renderActorPreview(
          template.actorId,
          template.variable,
          32,
          32,
          this._gba,
        );
        if (!buffer) {
          // No sprite this stage carries: fall back to the icon generated from
          // the game data at import time, then to a blank card.
          await this.drawIconFallback(canvas, template.actorId);
          continue;
        }
        canvas.width = buffer.width;
        canvas.height = buffer.height;
        const scale = Math.min(64 / buffer.width, 64 / buffer.height);
        canvas.style.width = `${Math.round(buffer.width * scale)}px`;
        canvas.style.height = `${Math.round(buffer.height * scale)}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          continue;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.putImageData(
          new ImageData(new Uint8ClampedArray(buffer.pixels), buffer.width, buffer.height),
          0,
          0,
        );
      }
    }

    // Player start preview (Common → Start & End).
    const playerStartCanvases = this.playerStartCanvases();
    if (playerStartCanvases.length > 0) {
      try {
        await renderer.prepareActors();
      } catch {
        // Sprite sheets may be missing; skip the thumbnail.
      }
      for (const ref of playerStartCanvases) {
        const canvas = ref.nativeElement;
        canvas.width = 32;
        canvas.height = 32;
        const buffer = await renderer.renderActorPreview(
          PLAYER_START_ACTOR_ID,
          PLAYER_START_DEFINITION.actorVariable ?? 0,
          32,
          32,
          this._gba,
        );
        const ctx = canvas.getContext('2d');
        if (!ctx || !buffer) {
          continue;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.putImageData(
          new ImageData(new Uint8ClampedArray(buffer.pixels), buffer.width, buffer.height),
          0,
          0,
        );
      }
    }

    // Enemy thumbnails: render each actor's default variant into its canvas.
    const enemyCanvases = this.enemyCanvases();
    if (enemyCanvases.length > 0) {
      try {
        await renderer.prepareActors();
      } catch {
        // Sprite sheets may be missing for this stage; skip enemy thumbnails.
      }
      for (const ref of enemyCanvases) {
        const id = ref.nativeElement.dataset['enemyId'];
        const enemy =
          this.enemies.find((entry) => entry.id === id) ??
          this.npcs.find((entry) => entry.id === id);
        const canvas = ref.nativeElement;
        if (!enemy) {
          continue;
        }
        const buffer = await renderer.renderActorPreview(
          id ?? '',
          enemy.actorVariable ?? 0,
          32,
          32,
          this._gba,
        );
        if (!buffer) {
          continue;
        }
        canvas.width = buffer.width;
        canvas.height = buffer.height;

        // Scale the bitmap to FIT the 64px-thumbnail box (preserving aspect),
        // so small sprites are enlarged and large ones shrunk without warp.
        const scale = Math.min(64 / buffer.width, 64 / buffer.height);
        canvas.style.width = `${Math.round(buffer.width * scale)}px`;
        canvas.style.height = `${Math.round(buffer.height * scale)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          continue;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.putImageData(
          new ImageData(new Uint8ClampedArray(buffer.pixels), buffer.width, buffer.height),
          0,
          0,
        );
      }
    }
    // Start & End object thumbnails (the goal).
    const startEndCanvases = this.startEndCanvases();
    if (startEndCanvases.length > 0) {
      try {
        await renderer.prepareActors();
      } catch {
        // Sprite sheets may be missing for this stage; skip these thumbnails.
      }
      for (const ref of startEndCanvases) {
        const id = ref.nativeElement.dataset['startendId'];
        const definition = this.startEndObjects.find((entry) => entry.id === id);
        const canvas = ref.nativeElement;
        if (!definition) {
          continue;
        }
        const buffer = await renderer.renderActorPreview(
          definition.actorId ?? '',
          definition.actorVariable ?? 0,
          64,
          64,
          this._gba,
        );
        if (!buffer) {
          continue;
        }
        canvas.width = buffer.width;
        canvas.height = buffer.height;
        const scale = Math.min(64 / buffer.width, 64 / buffer.height);
        canvas.style.width = `${Math.round(buffer.width * scale)}px`;
        canvas.style.height = `${Math.round(buffer.height * scale)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          continue;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.putImageData(
          new ImageData(new Uint8ClampedArray(buffer.pixels), buffer.width, buffer.height),
          0,
          0,
        );
      }
    }

    // Item objects (the force gem) use the same actor preview path.
    const itemCanvases = this.itemCanvases();
    if (itemCanvases.length > 0) {
      try {
        await renderer.prepareActors();
      } catch {
        // Sprite sheets may be missing for this stage; skip these thumbnails.
      }
      for (const ref of itemCanvases) {
        const id = ref.nativeElement.dataset['itemId'];
        const definition = this.itemObjects.find((entry) => entry.id === id);
        const canvas = ref.nativeElement;
        if (!definition) {
          continue;
        }
        const buffer = await renderer.renderActorPreview(
          definition.actorId ?? '',
          definition.actorVariable ?? 0,
          64,
          64,
          this._gba,
        );
        if (!buffer) {
          continue;
        }
        canvas.width = buffer.width;
        canvas.height = buffer.height;
        const scale = Math.min(64 / buffer.width, 64 / buffer.height);
        canvas.style.width = `${Math.round(buffer.width * scale)}px`;
        canvas.style.height = `${Math.round(buffer.height * scale)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          continue;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.putImageData(
          new ImageData(new Uint8ClampedArray(buffer.pixels), buffer.width, buffer.height),
          0,
          0,
        );
      }
    }
  }

  /** Selects an actor-template tab. */
  selectSection(section: ActorTemplateSection): void {
    this.activeSection.set(section);
  }

  /**
   * Draws the import-time generated icon for an actor into a thumbnail canvas.
   *
   * Used when the stage cannot render the actor (no sprite sheet / no render
   * definition). Falls back to hiding the canvas when no icon exists either, so
   * the card still shows its name.
   */
  private async drawIconFallback(canvas: HTMLCanvasElement, actorId: string): Promise<void> {
    const hide = (): void => {
      canvas.width = 1;
      canvas.height = 1;
      canvas.style.width = '0px';
      canvas.style.height = '0px';
    };
    const path = await this.actorSprites.iconPathFor(actorId);
    if (!path) {
      hide();
      return;
    }
    let bitmap = this.iconCache.get(actorId);
    if (bitmap === undefined) {
      bitmap = await this.loadIcon(path);
      this.iconCache.set(actorId, bitmap ?? null);
    }
    if (!bitmap) {
      hide();
      return;
    }
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const scale = Math.min(64 / bitmap.width, 64 / bitmap.height);
    canvas.style.width = `${Math.round(bitmap.width * scale)}px`;
    canvas.style.height = `${Math.round(bitmap.height * scale)}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
  }

  /** Decodes a PNG from the editor store into an ImageBitmap (null on failure). */
  private async loadIcon(path: string): Promise<ImageBitmap | null> {
    try {
      const bytes = await this.editor.readEditorFile(path);
      if (!bytes || bytes.byteLength === 0) {
        return null;
      }
      const blob = new Blob([bytes as BlobPart], { type: 'image/png' });
      return await createImageBitmap(blob);
    } catch {
      return null;
    }
  }

  /** Toggles the Advanced section. */
  toggleAdvanced(): void {
    const open = !this.advancedOpen();
    this.advancedOpen.set(open);
    this.advancedOpenChange.emit(open);
  }

  /** Toggles the Ground section. */
  toggleGround(): void {
    this.groundOpen.update((open) => !open);
  }

  /** Toggles the Start & End section. */
  toggleStartEnd(): void {
    this.startEndOpen.update((open) => !open);
  }

  /** Toggles the Walls section. */
  toggleWalls(): void {
    this.wallsOpen.update((open) => !open);
  }

  /** Toggles the Decorations section. */
  toggleDecorations(): void {
    this.decorationsOpen.update((open) => !open);
  }

  /** Toggles the Enemies section. */
  toggleEnemies(): void {
    this.enemiesOpen.update((open) => !open);
  }

  /** Toggles the NPC section. */
  toggleNpcs(): void {
    this.npcsOpen.update((open) => !open);
  }

  /** Toggles the Items section. */
  toggleItems(): void {
    this.itemsOpen.update((open) => !open);
  }

  /** Toggles the Misc (actor template) section. */
  toggleMisc(): void {
    this.miscOpen.update((open) => !open);
  }

  /** Selects a ground (or deselects it when the same one is clicked again). */
  selectGround(ground: GroundDefinition): void {
    if (this.selectedGroundId === ground.id) {
      this.groundCleared.emit();
      return;
    }
    this.groundPicked.emit(ground);
  }

  /** Starts a native drag carrying the decoration id. */
  onDecorationDragStart(event: DragEvent, definition: SmartObjectDefinition): void {
    event.dataTransfer?.setData('application/x-smart-object', definition.id);
    // Hide the default drag image (the toolbox card) so it does not obscure the
    // transparent preview we draw on the canvas.
    hideNativeDragImage(event);
    // dragover cannot read the data payload, so expose it via the shared service
    // for the canvas preview. Start from the default variant (index 0).
    this.dragService.start(definition, 0);
    // Let the host switch to the hand tool so the decoration can be positioned.
    this.decorationDragStarted.emit();
  }

  /** Clears the shared drag state when the drag ends. */
  onDecorationDragEnd(): void {
    this.dragService.clear();
  }

  /**
   * Starts a native drag for an actor template.
   *
   * Templates are ordinary actor-baked smart objects (id `template:<tab>:<n>`)
   * registered at module load, so the canvas resolves them through the same
   * path as any other actor. The template's own `Variable` travels with the
   * drag so the placement bakes exactly the preset (not the definition default).
   */
  onTemplateDragStart(event: DragEvent, template: ActorTemplate): void {
    const definition = findSmartObjectDefinition(template.id);
    if (!definition) {
      return;
    }
    event.dataTransfer?.setData('application/x-smart-object', definition.id);
    hideNativeDragImage(event);
    this.dragService.start(definition, 0, template.variable);
    this.decorationDragStarted.emit();
  }

  /** Clears the shared drag state when a template drag ends. */
  onTemplateDragEnd(): void {
    this.dragService.clear();
  }

  /** The player start smart-object definition (shown in Start & End). */
  readonly playerStart = PLAYER_START_DEFINITION;

  /**
   * Other Start & End objects (besides the player start), rendered as draggable
   * cards. Currently just the goal, an actor-baked smart object with a `Shape`
   * context-menu option.
   */
  readonly startEndObjects: SmartObjectDefinition[] = [GOAL_DEFINITION];

  /**
   * Collectible item objects shown in the Items section of the Items & NPC tab.
   *
   * These are actor-baked smart objects with their own variable-backed fields
   * (the force gem's `Gem Type`), so they are listed separately from the flat
   * EFSAdvent actor presets in the Misc tab.
   */
  readonly itemObjects: SmartObjectDefinition[] = [FORCE_GEM_DEFINITION];

  /** The item preview canvases. */
  private readonly itemCanvases = viewChildren<ElementRef<HTMLCanvasElement>>('itemPreview');

  /** Starts a native drag for an item actor object. */
  onItemDragStart(event: DragEvent, definition: SmartObjectDefinition): void {
    event.dataTransfer?.setData('application/x-smart-object', definition.id);
    hideNativeDragImage(event);
    this.dragService.start(definition, 0);
    this.decorationDragStarted.emit();
  }

  /** The Start & End object preview canvases. */
  private readonly startEndCanvases =
    viewChildren<ElementRef<HTMLCanvasElement>>('startEndPreview');

  /** Starts a native drag for a Start & End actor object. */
  onStartEndDragStart(event: DragEvent, definition: SmartObjectDefinition): void {
    event.dataTransfer?.setData('application/x-smart-object', definition.id);
    hideNativeDragImage(event);
    this.dragService.start(definition, 0);
    this.decorationDragStarted.emit();
  }

  /**
   * Starts a native drag for the player start marker.
   *
   * Modelled as an ordinary actor-baked smart object so it uses the shared
   * drag/drop, preview and context-menu paths; only its own menu items (rotate,
   * player state, player colour) are specific to it.
   */
  onPlayerStartDragStart(event: DragEvent): void {
    event.dataTransfer?.setData('application/x-smart-object', PLAYER_START_DEFINITION.id);
    hideNativeDragImage(event);
    this.dragService.start(
      PLAYER_START_DEFINITION,
      PLAYER_START_DEFINITION.rotation?.defaultRotation ?? 0,
    );
    this.decorationDragStarted.emit();
  }
}
