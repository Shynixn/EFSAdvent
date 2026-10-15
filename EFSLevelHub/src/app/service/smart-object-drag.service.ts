import { Injectable, signal } from '@angular/core';
import { SmartObjectDefinition } from '../entity/smartobject.definition';

/**
 * SmartObjectDragService
 * ----------------------
 * Tiny shared state for the smart object being dragged from the toolbox onto
 * the room canvas.
 *
 * A smart object is either a **decoration** (bakes tiles into a layer) or an
 * **enemy** (places an actor in the room's enemy list) — they differ only in
 * how they are persisted, so a single definition slot drives them both.
 *
 * HTML5 drag events do not expose `dataTransfer.getData()` during `dragover`
 * (only `types`), so the canvas cannot read which item is being dragged from the
 * event alone. The toolbox records the active definition here on `dragstart`
 * (and clears it on `dragend`); the canvas reads it to render the transparent
 * preview while dragging over the canvas.
 */
@Injectable({ providedIn: 'root' })
export class SmartObjectDragService {
  /** The definition currently being dragged, or null. Only one drag at a time. */
  readonly definition = signal<SmartObjectDefinition | null>(null);

  /** Variant (rotation style) index the dragged object uses. */
  readonly variantIndex = signal(0);

  /** Records a smart object being dragged (and the chosen variant). */
  start(definition: SmartObjectDefinition, variantIndex = 0): void {
    this.definition.set(definition);
    this.variantIndex.set(variantIndex);
  }

  /** Clears the dragged definition. */
  clear(): void {
    this.definition.set(null);
    this.variantIndex.set(0);
  }
}
