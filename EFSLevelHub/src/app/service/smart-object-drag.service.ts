import { Injectable, signal } from '@angular/core';
import { SmartObjectDefinition } from '../entity/smart-object.entity';

/**
 * SmartObjectDragService
 * ----------------------
 * Tiny shared state for a decoration being dragged from the toolbox onto the
 * room canvas.
 *
 * HTML5 drag events do not expose `dataTransfer.getData()` during `dragover`
 * (only `types`), so the canvas cannot read which decoration is being dragged
 * from the event alone. The toolbox records the active definition here on
 * `dragstart` (and clears it on `dragend`); the canvas reads it to render the
 * transparent preview while dragging over the canvas.
 */
@Injectable({ providedIn: 'root' })
export class SmartObjectDragService {
  /** The decoration currently being dragged from the toolbox, if any. */
  readonly dragging = signal<SmartObjectDefinition | null>(null);

  /** Records the decoration being dragged. */
  start(definition: SmartObjectDefinition): void {
    this.dragging.set(definition);
  }

  /** Clears the dragged decoration. */
  clear(): void {
    this.dragging.set(null);
  }
}
