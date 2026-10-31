import { Component, OnInit, inject, signal } from '@angular/core';
import { IsoExtractorComponent } from '../../component/iso-extractor/iso-extractor.component';
import { ButtonComponent } from '../../component/button/button.component';
import { ModalComponent } from '../../component/modal/modal.component';
import { GameStateService } from '../../service/game-state.service';
import { AppSettingsService } from '../../service/app-settings.service';
import { LoggingService } from '../../service/logging.service';

/** A single entry discovered under `/editor`. */
export interface EditorEntry {
  /** Path relative to `/editor` (e.g. `stage/<uuid>.json`). */
  path: string;
  /** File name including extension. */
  name: string;
  /** File size in bytes. */
  size: number;
  /** True when the file is text and its contents could be parsed/previewed. */
  isText: boolean;
}

/**
 * SettingsPage
 * ------------
 * Application settings:
 *
 * - **General**: persisted preferences (currently the "show debug information"
 *   flag, stored in `localStorage` via {@link AppSettingsService}).
 * - **GameCube ISO Import**: the extractor, which is the prerequisite for every
 *   other feature. When no valid ISO has been imported yet, an instructional
 *   banner is shown above it.
 * - **Debug** (only when enabled): a developer-only file inspector listing every
 *   file under the OPFS `/editor` folder. Clicking a file opens a modal with its
 *   contents (JSON pretty-printed, other text verbatim, binary files report
 *   their size). Moved here from the former `/debug` page.
 */
@Component({
  selector: 'app-settings-page',
  imports: [IsoExtractorComponent, ButtonComponent, ModalComponent],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.css',
})
export class SettingsPage implements OnInit {
  private readonly gameState = inject(GameStateService);
  private readonly settings = inject(AppSettingsService);
  private readonly logger = inject(LoggingService);

  /** Whether the FSA ISO has been detected in OPFS. */
  readonly isReady = this.gameState.isReady;
  /** Whether the OPFS scan is running. */
  readonly isChecking = this.gameState.isChecking;
  /** Whether the debug information (file inspector, room debug panel) is shown. */
  readonly debug = this.settings.debug;

  /** All files found under `/editor`. */
  readonly entries = signal<EditorEntry[]>([]);
  /** Whether the directory scan is running. */
  readonly isLoading = signal(false);

  /** Whether the file-preview modal is open. */
  readonly modalOpen = signal(false);
  /** Path of the file currently shown in the modal. */
  readonly selectedPath = signal('');
  /** Text shown inside the modal. */
  readonly selectedContent = signal('');

  ngOnInit(): void {
    void this.gameState.refresh();
    if (this.debug()) {
      void this.refresh();
    }
  }

  /** Persists the "show debug information" preference. */
  setDebug(value: boolean): void {
    this.settings.setDebug(value);
    // Scan lazily the first time the inspector becomes visible.
    if (value && this.entries().length === 0) {
      void this.refresh();
    }
  }

  /** Re-scans the `/editor` folder. */
  async refresh(): Promise<void> {
    this.isLoading.set(true);
    try {
      this.entries.set(await this.listEditorFiles());
      this.logger.info(`Debug: listed ${this.entries().length} file(s) under /editor.`);
    } catch (error) {
      this.logger.error('Debug: failed to list /editor', error);
      this.entries.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  /** Recursively walks `/editor` and returns every file entry. */
  private async listEditorFiles(): Promise<EditorEntry[]> {
    const root = await navigator.storage.getDirectory();
    let editor: FileSystemDirectoryHandle;
    try {
      editor = await root.getDirectoryHandle('editor');
    } catch {
      return [];
    }

    const files: EditorEntry[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [name, handle] of (dir as any).entries()) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (handle.kind === 'directory') {
          await walk(handle as FileSystemDirectoryHandle, path);
        } else {
          const file = await (handle as FileSystemFileHandle).getFile();
          files.push({
            path,
            name,
            size: file.size,
            isText: /\.(json|txt|xml|csv|md)$/i.test(name),
          });
        }
      }
    };

    await walk(editor, '');
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Loads and displays the given file inside the modal. */
  async openFile(entry: EditorEntry): Promise<void> {
    this.selectedPath.set(entry.path);
    this.modalOpen.set(true);

    if (!entry.isText) {
      this.selectedContent.set(`(binary file — ${entry.size} bytes)`);
      return;
    }

    try {
      const bytes = await this.readEditorFile(entry.path);
      const text = bytes ? new TextDecoder().decode(bytes) : '(file not found)';
      this.selectedContent.set(this.prettify(entry.name, text));
    } catch (error) {
      this.logger.error(`Debug: failed to read "${entry.path}"`, error);
      this.selectedContent.set('(failed to read file)');
    }
  }

  /** Closes the file-preview modal. */
  closeModal(): void {
    this.modalOpen.set(false);
    this.selectedPath.set('');
    this.selectedContent.set('');
  }

  /** Reads a file under `/editor` by relative path. */
  private async readEditorFile(relativePath: string): Promise<Uint8Array | null> {
    const segments = relativePath.split('/').filter(Boolean);
    if (segments.length === 0) {
      return null;
    }
    const root = await navigator.storage.getDirectory();
    let dir = await root.getDirectoryHandle('editor');
    for (let i = 0; i < segments.length - 1; i++) {
      dir = await dir.getDirectoryHandle(segments[i]);
    }
    const fileHandle = await dir.getFileHandle(segments[segments.length - 1]);
    const file = await fileHandle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  /** Pretty-prints JSON, falling back to the raw text. */
  private prettify(name: string, text: string): string {
    if (!/\.json$/i.test(name)) {
      return text;
    }
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }

  /** Human-readable file size. */
  formatSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
