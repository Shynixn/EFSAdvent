/**
 * Shared entity / data-holding types for GameCube ISO parsing.
 */

/** A single parsed FST entry (file or directory). */
export interface FstEntry {
  /** True when the entry represents a directory. */
  isDirectory: boolean;
  /** Offset into the FST string table where the UTF-8 name lives. */
  nameOffset: number;
  /**
   * For files: absolute byte offset of the file data inside the ISO.
   * For directories: index of the parent entry.
   */
  offset: number;
  /**
   * For files: size of the file data in bytes.
   * For directories: index of the next entry *after* this directory's subtree.
   */
  size: number;
}

/** A resolved file ready for extraction (absolute offset/size + full path). */
export interface ResolvedFile {
  /** Path relative to the ISO root, using forward slashes (e.g. `sys/main.dol`). */
  path: string;
  /** Absolute byte offset of the file data within the ISO. */
  offset: number;
  /** Size of the file data in bytes. */
  size: number;
}

/** Result of a completed ISO extraction. */
export interface ExtractionResult {
  /** Total number of files that were written to OPFS. */
  totalFiles: number;
}

/** OPFS storage quota information, expressed in megabytes. */
export interface StorageEstimate {
  usedMB: number;
  totalMB: number;
}

/** High-level phase of the ISO extraction pipeline, for UI feedback. */
export type ExtractionPhase =
  'persisting' | 'reading-header' | 'reading-fst' | 'parsing-fst' | 'extracting' | 'complete';

/** Progress event emitted throughout the extraction pipeline. */
export interface ExtractionProgress {
  phase: ExtractionPhase;
  /** Human-readable description of the current step. */
  message: string;
  /** Files written so far (only meaningful during/after `extracting`). */
  extractedCount: number;
  /** Total files discovered (0 until the FST has been parsed). */
  totalFiles: number;
  /** Current file path (only set during `extracting`). */
  currentFileName?: string;
}
