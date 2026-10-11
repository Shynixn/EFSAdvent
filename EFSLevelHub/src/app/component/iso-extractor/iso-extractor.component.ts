import { Component, OnInit, inject, signal } from '@angular/core';
import { IsoExtractorService } from '../../service/iso-extractor.service';
import { OpfsCacheService } from '../../service/opfs-cache.service';
import { LoggingService } from '../../service/logging.service';
import { ExtractionProgress, StorageEstimate } from '../../entity/iso.entity';

/**
 * IsoExtractorComponent
 * ---------------------
 * Minimal standalone UI for selecting a GameCube ISO/GCM file, extracting it
 * into OPFS, and reporting live progress + storage usage.
 *
 * Uses Angular signals + zoneless change detection: writable signals are read
 * directly in the template, so mutating them schedules change detection
 * automatically.
 */
@Component({
  selector: 'app-iso-extractor',
  templateUrl: './iso-extractor.component.html',
  styleUrl: './iso-extractor.component.css',
})
export class IsoExtractorComponent implements OnInit {
  private readonly isoExtractor = inject(IsoExtractorService);
  private readonly opfs = inject(OpfsCacheService);
  private readonly logger = inject(LoggingService);

  readonly selectedFileName = signal('');
  readonly isExtracting = signal(false);
  readonly extractedCount = signal(0);
  readonly totalFiles = signal(0);
  readonly currentFileName = signal('');
  /** Human-readable description of the current extraction phase. */
  readonly statusMessage = signal('');
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly storage = signal<StorageEstimate>({ usedMB: 0, totalMB: 0 });
  /** Number of files already cached in OPFS from a previous session. */
  readonly cachedFileCount = signal(0);
  readonly isClearing = signal(false);

  ngOnInit(): void {
    void this.refreshStorage();
    void this.refreshCachedFileCount();
  }

  /** Handles the `<input type="file">` change event. */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.selectedFileName.set(file.name);
    this.resetProgress();
    void this.extract(file);
  }

  /** Runs extraction and keeps the UI state in sync. */
  private async extract(file: File): Promise<void> {
    this.isExtracting.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.logger.info(`UI: extraction started for "${file.name}" (${file.size} bytes)`);

    try {
      const result = await this.isoExtractor.extractAndCacheIso(file, (progress) =>
        this.onProgress(progress),
      );

      this.totalFiles.set(result.totalFiles);
      this.successMessage.set(`Extraction complete — ${result.totalFiles} file(s) cached to OPFS.`);
      this.logger.info(`UI: extraction finished (${result.totalFiles} files).`);
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Unknown extraction error.');
      this.logger.error('UI: extraction failed', error);
    } finally {
      this.isExtracting.set(false);
      this.currentFileName.set('');
      await this.refreshStorage();
      await this.refreshCachedFileCount();
    }
  }

  /** Applies an extraction progress event to the UI state. */
  private onProgress(progress: ExtractionProgress): void {
    this.statusMessage.set(progress.message);
    this.extractedCount.set(progress.extractedCount);
    this.totalFiles.set(progress.totalFiles);
    this.currentFileName.set(progress.currentFileName ?? '');
    this.logger.info(
      `UI progress [${progress.phase}] ${progress.message} ` +
        `(${progress.extractedCount}/${progress.totalFiles})`,
    );
  }

  /** Re-reads the OPFS storage quota for the status readout. */
  async refreshStorage(): Promise<void> {
    this.storage.set(await this.opfs.getStorageEstimate());
  }

  /** Re-counts the files currently cached under `/extracted_game`. */
  async refreshCachedFileCount(): Promise<void> {
    this.cachedFileCount.set(await this.opfs.countExtractedFiles());
  }

  /** Wipes the extracted game cache from OPFS. */
  async clearCache(): Promise<void> {
    this.isClearing.set(true);
    this.successMessage.set('');
    this.errorMessage.set('');
    try {
      await this.opfs.clearExtractedGame();
      await this.refreshStorage();
      await this.refreshCachedFileCount();
      this.successMessage.set('Cache cleared.');
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Failed to clear cache.');
      this.logger.error('UI: clear cache failed', error);
    } finally {
      this.isClearing.set(false);
    }
  }

  private resetProgress(): void {
    this.extractedCount.set(0);
    this.totalFiles.set(0);
    this.currentFileName.set('');
    this.statusMessage.set('');
    this.errorMessage.set('');
    this.successMessage.set('');
  }
}
