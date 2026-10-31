/**
 * Smart object definitions
 * ------------------------
 * The hard-coded catalog of smart objects available in the toolbox. A smart
 * object is a multi-tile object (e.g. a decoration such as a tree) stamped onto
 * a room in one action.
 *
 * Tile coordinates in a definition are **offsets** relative to the placement
 * anchor (the top-left of the object's bounding box). A tile offset may be
 * negative (e.g. a canopy that overhangs to the left of the anchor).
 */

import { IRotateable } from './contract/rotateable.entity';
import type { IScalable } from './contract/scalable.entity';
import type { IPlaceable } from './contract/placeable.entity';

/**
 * What a smart object bakes into when placed.
 *
 * - `tile`: stamps tiles onto the room layers (e.g. a tree, a door).
 * - `actor`: places an **actor** in the room's actor list (`d_enemy_map*.bin`)
 *   whose sprite is drawn over the tiles; no tiles are written.
 *
 * Everything else about a smart object (dragging, previewing, hit-testing,
 * moving, rotating, deleting) is identical regardless of `baking`.
 */
export type SmartObjectBaking = 'tile' | 'actor';

/** A single tile within a smart-object definition, relative to the anchor. */
export interface SmartObjectTileOffset {
  /** Row offset from the anchor (may be negative). */
  dRow: number;
  /** Column offset from the anchor (may be negative). */
  dCol: number;
  /** Tileset tile id (0-1023) to stamp. */
  tile: number;
}

/**
 * One variant (rotation / style) of a smart object.
 *
 * An object like a closed door has four variants (one per facing) collected in
 * its definition's {@link SmartObjectDefinition.set}; a simple object like a
 * tree has a single variant. All variants share the same anchor convention.
 */
export interface SmartObjectVariant {
  /** Tiles stamped onto the base layer. */
  bottomLayerTiles: SmartObjectTileOffset[];
  /** Tiles stamped onto the paired top layer (index + 8). */
  topLayerTiles: SmartObjectTileOffset[];
  /**
   * Tiles drawn **under the actor in the editor only** — never stamped into the
   * room and never recorded on the placement.
   *
   * Actor-baked objects sit on top of ordinary scenery that the game expects to
   * already be painted, so leaving it out makes the placed actor float in the
   * air. The item stand is the motivating case: tile 23 is the `Item pedestal`
   * the item rests on, but it is a normal base-layer tile the user paints, not
   * part of the object. Showing it here makes the editor preview match the game
   * without silently baking tiles the user did not ask for.
   */
  previewTiles?: SmartObjectTileOffset[];
}

/** Toolbox section a definition belongs to. */
export type SmartObjectSection =
  'Doors' | 'Decorations' | 'Enemies' | 'Items' | 'NPC' | 'Objects' | 'Special' | 'Switches';

/**
 * A selectable sub-type of a definition (e.g. a door can be a plain door, a
 * closed door or a key door).
 *
 * The sub-type only changes which sprite/tiles are stamped — the geometry, the
 * anchor and the rotation behave identically. Chosen from the context menu and
 * cycled implicitly so the entry list stays small while all styles remain
 * available.
 */
export interface SmartObjectSubType {
  /** Stable id, e.g. `closed-door`. */
  id: string;
  /** Display name shown in the context menu. */
  name: string;
  /** The variants (one per rotation) stamped for this sub-type. */
  set: SmartObjectVariant[];
}

/** A hard-coded smart-object definition (tile-baked or actor-baked). */
export interface SmartObjectDefinition {
  /** Stable id, e.g. `tree`. For an actor-baked object this is the actor id. */
  id: string;
  /** Whether placing this object bakes tiles or an actor. */
  baking: SmartObjectBaking;
  /** Display name shown in the toolbox. */
  name: string;
  /** Toolbox section this definition is grouped under. */
  section: SmartObjectSection;
  /**
   * Placement lifecycle behaviour (`IPlaceable`), when placing this object needs
   * to do more than drop it at the anchor.
   *
   * Lets the owning `.entity.ts` module supply the logic — e.g. a Start expands
   * into four coloured player actors — so hosts such as the room page stay
   * generic and never special-case an object id.
   */
  placement?: IPlaceable;
  /**
   * Rotation behaviour (`IRotateable`), when this object can be turned.
   *
   * `set`/`subTypes` describe the tiles; this describes WHICH orientation the
   * object starts in and how many it has. Objects without it cannot be rotated
   * and the canvas hides the "Rotate" action.
   */
  rotation?: IRotateable;
  /**
   * Scaling behaviour (`IScalable`), when this object can be grown by repeating
   * its edge tiles in a direction (context menu → **Scale**).
   *
   * Objects without it hide the Scale submenu.
   */
  scalable?: IScalable;
  /**
   * The variants (rotation styles) of this object. Single-entry for objects
   * that do not rotate (e.g. a tree); four entries for doors (one per facing).
   * Actor-baked objects have a single (empty) variant — they bake no tiles.
   *
   * When {@link subTypes} is present this is the sub-type currently selected
   * (index into `subTypes`), and {@link set} is kept as an alias of its `set`.
   */
  set: SmartObjectVariant[];
  /**
   * Optional selectable styles for this object (e.g. a door's
   * door / closed-door / key-door sprites). When present, the placement's
   * {@link subTypeIndex} picks one and {@link set} mirrors the chosen sub-type.
   */
  subTypes?: SmartObjectSubType[];
  /**
   * For `baking: 'actor'` objects: the 4-character actor id to place (e.g.
   * `AMOS`) and the default `Variable` value selecting its render variant.
   * Undefined for tile-baked objects.
   */
  actorId?: string;
  /** Default actor `Variable` used when placing (actor-baked objects only). */
  actorVariable?: number;
  /** Whether the actor has no GBA-variant sprite (actor-baked objects only). */
  noGBASprite?: boolean;
}

/**
 * Catalog of smart objects, grouped into toolbox sections.
 *
 * The `tree` entry uses the game's tree tiles: trunk/base on the bottom layer
 * (524-526) and canopy on the top layer (508-511), with the canopy overhanging
 * one row up and one column to the left. Most entries are generated from the
 * EFSAdvent editor's `data/Stamps/*.bin` catalog; the doors collapse their four
 * facings (north/east/south/west) into a single definition's `set`.
 */
export const SMART_OBJECT_DEFINITIONS: SmartObjectDefinition[] = [
  {
    id: 'door',
    baking: 'tile',
    name: 'Door',
    section: 'Doors',
    // Doors open facing north first and rotate through all four facings.
    rotation: { defaultRotation: 0, rotationCount: 4 },
    subTypes: [
      {
        id: 'door',
        name: 'Door',
        set: [
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 0, tile: 832 },
              { dRow: 0, dCol: 1, tile: 833 },
              { dRow: 1, dCol: 0, tile: 848 },
              { dRow: 1, dCol: 1, tile: 849 },
            ],
            topLayerTiles: [],
          },
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 0, tile: 838 },
              { dRow: 0, dCol: 1, tile: 839 },
              { dRow: 1, dCol: 0, tile: 854 },
              { dRow: 1, dCol: 1, tile: 855 },
            ],
            topLayerTiles: [],
          },
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 0, tile: 834 },
              { dRow: 0, dCol: 1, tile: 835 },
              { dRow: 1, dCol: 0, tile: 850 },
              { dRow: 1, dCol: 1, tile: 851 },
            ],
            topLayerTiles: [],
          },
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 0, tile: 836 },
              { dRow: 0, dCol: 1, tile: 837 },
              { dRow: 1, dCol: 0, tile: 852 },
              { dRow: 1, dCol: 1, tile: 853 },
            ],
            topLayerTiles: [],
          },
        ],
      },
      {
        id: 'closed-door',
        name: 'Closed door',
        set: [
          {
            bottomLayerTiles: [
              { dRow: 1, dCol: 0, tile: 736 },
              { dRow: 1, dCol: 1, tile: 737 },
              { dRow: 0, dCol: 0, tile: 832 },
              { dRow: 0, dCol: 1, tile: 833 },
            ],
            topLayerTiles: [],
          },
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 0, tile: 739 },
              { dRow: 1, dCol: 0, tile: 755 },
              { dRow: 0, dCol: 1, tile: 839 },
              { dRow: 1, dCol: 1, tile: 855 },
            ],
            topLayerTiles: [],
          },
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 0, tile: 752 },
              { dRow: 0, dCol: 1, tile: 753 },
              { dRow: 1, dCol: 0, tile: 850 },
              { dRow: 1, dCol: 1, tile: 851 },
            ],
            topLayerTiles: [],
          },
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 1, tile: 738 },
              { dRow: 1, dCol: 1, tile: 754 },
              { dRow: 0, dCol: 0, tile: 836 },
              { dRow: 1, dCol: 0, tile: 852 },
            ],
            topLayerTiles: [],
          },
        ],
      },
      {
        id: 'key-door',
        name: 'Key door',
        set: [
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 0, tile: 832 },
              { dRow: 0, dCol: 1, tile: 833 },
              { dRow: 1, dCol: 0, tile: 840 },
              { dRow: 1, dCol: 1, tile: 841 },
            ],
            topLayerTiles: [],
          },
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 0, tile: 843 },
              { dRow: 0, dCol: 1, tile: 839 },
              { dRow: 1, dCol: 0, tile: 859 },
              { dRow: 1, dCol: 1, tile: 855 },
            ],
            topLayerTiles: [],
          },
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 0, tile: 856 },
              { dRow: 0, dCol: 1, tile: 857 },
              { dRow: 1, dCol: 0, tile: 850 },
              { dRow: 1, dCol: 1, tile: 851 },
            ],
            topLayerTiles: [],
          },
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 0, tile: 836 },
              { dRow: 0, dCol: 1, tile: 842 },
              { dRow: 1, dCol: 0, tile: 852 },
              { dRow: 1, dCol: 1, tile: 858 },
            ],
            topLayerTiles: [],
          },
        ],
      },
    ],
    // `set` mirrors the default sub-type ("door"); kept for callers that only
    // read `set` (hit-testing bounds, toolbox preview).
    set: [
      {
        bottomLayerTiles: [
          { dRow: 0, dCol: 0, tile: 832 },
          { dRow: 0, dCol: 1, tile: 833 },
          { dRow: 1, dCol: 0, tile: 848 },
          { dRow: 1, dCol: 1, tile: 849 },
        ],
        topLayerTiles: [],
      },
      {
        bottomLayerTiles: [
          { dRow: 0, dCol: 0, tile: 838 },
          { dRow: 0, dCol: 1, tile: 839 },
          { dRow: 1, dCol: 0, tile: 854 },
          { dRow: 1, dCol: 1, tile: 855 },
        ],
        topLayerTiles: [],
      },
      {
        bottomLayerTiles: [
          { dRow: 0, dCol: 0, tile: 834 },
          { dRow: 0, dCol: 1, tile: 835 },
          { dRow: 1, dCol: 0, tile: 850 },
          { dRow: 1, dCol: 1, tile: 851 },
        ],
        topLayerTiles: [],
      },
      {
        bottomLayerTiles: [
          { dRow: 0, dCol: 0, tile: 836 },
          { dRow: 0, dCol: 1, tile: 837 },
          { dRow: 1, dCol: 0, tile: 852 },
          { dRow: 1, dCol: 1, tile: 853 },
        ],
        topLayerTiles: [],
      },
    ],
  },
  {
    id: 'big-door',
    baking: 'tile',
    name: 'Big Door',
    section: 'Doors',
    // Big doors also open facing north first.
    rotation: { defaultRotation: 0, rotationCount: 4 },
    subTypes: [
      {
        id: 'big-door',
        name: 'Big Door',
        set: [
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 0, tile: 740 },
              { dRow: 0, dCol: 1, tile: 741 },
              { dRow: 0, dCol: 2, tile: 741 },
              { dRow: 0, dCol: 3, tile: 741 },
              { dRow: 0, dCol: 4, tile: 741 },
              { dRow: 0, dCol: 5, tile: 742 },
              { dRow: 1, dCol: 0, tile: 746 },
              { dRow: 1, dCol: 1, tile: 750 },
              { dRow: 1, dCol: 2, tile: 750 },
              { dRow: 1, dCol: 3, tile: 750 },
              { dRow: 1, dCol: 4, tile: 750 },
              { dRow: 1, dCol: 5, tile: 747 },
            ],
            topLayerTiles: [],
          },
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 0, tile: 749 },
              { dRow: 0, dCol: 1, tile: 759 },
              { dRow: 1, dCol: 0, tile: 767 },
              { dRow: 1, dCol: 1, tile: 760 },
              { dRow: 2, dCol: 0, tile: 767 },
              { dRow: 2, dCol: 1, tile: 760 },
              { dRow: 3, dCol: 0, tile: 767 },
              { dRow: 3, dCol: 1, tile: 760 },
              { dRow: 4, dCol: 0, tile: 767 },
              { dRow: 4, dCol: 1, tile: 760 },
              { dRow: 5, dCol: 0, tile: 765 },
              { dRow: 5, dCol: 1, tile: 761 },
            ],
            topLayerTiles: [],
          },
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 0, tile: 762 },
              { dRow: 0, dCol: 1, tile: 766 },
              { dRow: 0, dCol: 2, tile: 766 },
              { dRow: 0, dCol: 3, tile: 766 },
              { dRow: 0, dCol: 4, tile: 766 },
              { dRow: 0, dCol: 5, tile: 763 },
              { dRow: 1, dCol: 0, tile: 756 },
              { dRow: 1, dCol: 1, tile: 757 },
              { dRow: 1, dCol: 2, tile: 757 },
              { dRow: 1, dCol: 3, tile: 757 },
              { dRow: 1, dCol: 4, tile: 757 },
              { dRow: 1, dCol: 5, tile: 758 },
            ],
            topLayerTiles: [],
          },
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 0, tile: 743 },
              { dRow: 0, dCol: 1, tile: 748 },
              { dRow: 1, dCol: 0, tile: 744 },
              { dRow: 1, dCol: 1, tile: 751 },
              { dRow: 2, dCol: 0, tile: 744 },
              { dRow: 2, dCol: 1, tile: 751 },
              { dRow: 3, dCol: 0, tile: 744 },
              { dRow: 3, dCol: 1, tile: 751 },
              { dRow: 4, dCol: 0, tile: 744 },
              { dRow: 4, dCol: 1, tile: 751 },
              { dRow: 5, dCol: 0, tile: 745 },
              { dRow: 5, dCol: 1, tile: 764 },
            ],
            topLayerTiles: [],
          },
        ],
      },
      {
        id: 'big-closed-door',
        name: 'Big Closed door',
        set: [
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 0, tile: 740 },
              { dRow: 0, dCol: 1, tile: 741 },
              { dRow: 0, dCol: 2, tile: 741 },
              { dRow: 0, dCol: 3, tile: 741 },
              { dRow: 0, dCol: 4, tile: 741 },
              { dRow: 0, dCol: 5, tile: 742 },
              { dRow: 1, dCol: 0, tile: 778 },
              { dRow: 1, dCol: 1, tile: 776 },
              { dRow: 1, dCol: 2, tile: 768 },
              { dRow: 1, dCol: 3, tile: 769 },
              { dRow: 1, dCol: 4, tile: 776 },
              { dRow: 1, dCol: 5, tile: 779 },
            ],
            topLayerTiles: [],
          },
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 1, tile: 759 },
              { dRow: 1, dCol: 1, tile: 760 },
              { dRow: 2, dCol: 1, tile: 760 },
              { dRow: 3, dCol: 1, tile: 760 },
              { dRow: 4, dCol: 1, tile: 760 },
              { dRow: 5, dCol: 1, tile: 761 },
              { dRow: 0, dCol: 0, tile: 781 },
              { dRow: 1, dCol: 0, tile: 793 },
              { dRow: 2, dCol: 0, tile: 771 },
              { dRow: 3, dCol: 0, tile: 787 },
              { dRow: 4, dCol: 0, tile: 793 },
              { dRow: 5, dCol: 0, tile: 797 },
            ],
            topLayerTiles: [],
          },
          {
            bottomLayerTiles: [
              { dRow: 1, dCol: 0, tile: 756 },
              { dRow: 1, dCol: 1, tile: 757 },
              { dRow: 1, dCol: 2, tile: 757 },
              { dRow: 1, dCol: 3, tile: 757 },
              { dRow: 1, dCol: 4, tile: 757 },
              { dRow: 1, dCol: 5, tile: 758 },
              { dRow: 0, dCol: 0, tile: 794 },
              { dRow: 0, dCol: 1, tile: 792 },
              { dRow: 0, dCol: 2, tile: 784 },
              { dRow: 0, dCol: 3, tile: 785 },
              { dRow: 0, dCol: 4, tile: 792 },
              { dRow: 0, dCol: 5, tile: 795 },
            ],
            topLayerTiles: [],
          },
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 0, tile: 743 },
              { dRow: 1, dCol: 0, tile: 744 },
              { dRow: 2, dCol: 0, tile: 744 },
              { dRow: 3, dCol: 0, tile: 744 },
              { dRow: 4, dCol: 0, tile: 744 },
              { dRow: 5, dCol: 0, tile: 745 },
              { dRow: 0, dCol: 1, tile: 780 },
              { dRow: 1, dCol: 1, tile: 777 },
              { dRow: 2, dCol: 1, tile: 770 },
              { dRow: 3, dCol: 1, tile: 786 },
              { dRow: 4, dCol: 1, tile: 777 },
              { dRow: 5, dCol: 1, tile: 796 },
            ],
            topLayerTiles: [],
          },
        ],
      },
      {
        id: 'big-key-door',
        name: 'Big Key door',
        set: [
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 0, tile: 740 },
              { dRow: 0, dCol: 1, tile: 741 },
              { dRow: 0, dCol: 2, tile: 741 },
              { dRow: 0, dCol: 3, tile: 741 },
              { dRow: 0, dCol: 4, tile: 741 },
              { dRow: 0, dCol: 5, tile: 742 },
              { dRow: 1, dCol: 0, tile: 778 },
              { dRow: 1, dCol: 1, tile: 776 },
              { dRow: 1, dCol: 2, tile: 772 },
              { dRow: 1, dCol: 3, tile: 773 },
              { dRow: 1, dCol: 4, tile: 776 },
              { dRow: 1, dCol: 5, tile: 779 },
            ],
            topLayerTiles: [],
          },
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 1, tile: 759 },
              { dRow: 1, dCol: 1, tile: 760 },
              { dRow: 2, dCol: 1, tile: 760 },
              { dRow: 3, dCol: 1, tile: 760 },
              { dRow: 4, dCol: 1, tile: 760 },
              { dRow: 5, dCol: 1, tile: 761 },
              { dRow: 0, dCol: 0, tile: 781 },
              { dRow: 1, dCol: 0, tile: 793 },
              { dRow: 2, dCol: 0, tile: 775 },
              { dRow: 3, dCol: 0, tile: 791 },
              { dRow: 4, dCol: 0, tile: 793 },
              { dRow: 5, dCol: 0, tile: 797 },
            ],
            topLayerTiles: [],
          },
          {
            bottomLayerTiles: [
              { dRow: 1, dCol: 0, tile: 756 },
              { dRow: 1, dCol: 1, tile: 757 },
              { dRow: 1, dCol: 2, tile: 757 },
              { dRow: 1, dCol: 3, tile: 757 },
              { dRow: 1, dCol: 4, tile: 757 },
              { dRow: 1, dCol: 5, tile: 758 },
              { dRow: 0, dCol: 0, tile: 794 },
              { dRow: 0, dCol: 1, tile: 792 },
              { dRow: 0, dCol: 2, tile: 788 },
              { dRow: 0, dCol: 3, tile: 789 },
              { dRow: 0, dCol: 4, tile: 792 },
              { dRow: 0, dCol: 5, tile: 795 },
            ],
            topLayerTiles: [],
          },
          {
            bottomLayerTiles: [
              { dRow: 0, dCol: 0, tile: 743 },
              { dRow: 1, dCol: 0, tile: 744 },
              { dRow: 2, dCol: 0, tile: 744 },
              { dRow: 3, dCol: 0, tile: 744 },
              { dRow: 4, dCol: 0, tile: 744 },
              { dRow: 5, dCol: 0, tile: 745 },
              { dRow: 0, dCol: 1, tile: 780 },
              { dRow: 1, dCol: 1, tile: 777 },
              { dRow: 2, dCol: 1, tile: 774 },
              { dRow: 3, dCol: 1, tile: 790 },
              { dRow: 4, dCol: 1, tile: 777 },
              { dRow: 5, dCol: 1, tile: 796 },
            ],
            topLayerTiles: [],
          },
        ],
      },
    ],
    // `set` mirrors the default sub-type ("big-door"); kept for callers that only
    // read `set` (hit-testing bounds, toolbox preview).
    set: [
      {
        bottomLayerTiles: [
          { dRow: 0, dCol: 0, tile: 740 },
          { dRow: 0, dCol: 1, tile: 741 },
          { dRow: 0, dCol: 2, tile: 741 },
          { dRow: 0, dCol: 3, tile: 741 },
          { dRow: 0, dCol: 4, tile: 741 },
          { dRow: 0, dCol: 5, tile: 742 },
          { dRow: 1, dCol: 0, tile: 746 },
          { dRow: 1, dCol: 1, tile: 750 },
          { dRow: 1, dCol: 2, tile: 750 },
          { dRow: 1, dCol: 3, tile: 750 },
          { dRow: 1, dCol: 4, tile: 750 },
          { dRow: 1, dCol: 5, tile: 747 },
        ],
        topLayerTiles: [],
      },
      {
        bottomLayerTiles: [
          { dRow: 0, dCol: 0, tile: 749 },
          { dRow: 0, dCol: 1, tile: 759 },
          { dRow: 1, dCol: 0, tile: 767 },
          { dRow: 1, dCol: 1, tile: 760 },
          { dRow: 2, dCol: 0, tile: 767 },
          { dRow: 2, dCol: 1, tile: 760 },
          { dRow: 3, dCol: 0, tile: 767 },
          { dRow: 3, dCol: 1, tile: 760 },
          { dRow: 4, dCol: 0, tile: 767 },
          { dRow: 4, dCol: 1, tile: 760 },
          { dRow: 5, dCol: 0, tile: 765 },
          { dRow: 5, dCol: 1, tile: 761 },
        ],
        topLayerTiles: [],
      },
      {
        bottomLayerTiles: [
          { dRow: 0, dCol: 0, tile: 762 },
          { dRow: 0, dCol: 1, tile: 766 },
          { dRow: 0, dCol: 2, tile: 766 },
          { dRow: 0, dCol: 3, tile: 766 },
          { dRow: 0, dCol: 4, tile: 766 },
          { dRow: 0, dCol: 5, tile: 763 },
          { dRow: 1, dCol: 0, tile: 756 },
          { dRow: 1, dCol: 1, tile: 757 },
          { dRow: 1, dCol: 2, tile: 757 },
          { dRow: 1, dCol: 3, tile: 757 },
          { dRow: 1, dCol: 4, tile: 757 },
          { dRow: 1, dCol: 5, tile: 758 },
        ],
        topLayerTiles: [],
      },
      {
        bottomLayerTiles: [
          { dRow: 0, dCol: 0, tile: 743 },
          { dRow: 0, dCol: 1, tile: 748 },
          { dRow: 1, dCol: 0, tile: 744 },
          { dRow: 1, dCol: 1, tile: 751 },
          { dRow: 2, dCol: 0, tile: 744 },
          { dRow: 2, dCol: 1, tile: 751 },
          { dRow: 3, dCol: 0, tile: 744 },
          { dRow: 3, dCol: 1, tile: 751 },
          { dRow: 4, dCol: 0, tile: 744 },
          { dRow: 4, dCol: 1, tile: 751 },
          { dRow: 5, dCol: 0, tile: 745 },
          { dRow: 5, dCol: 1, tile: 764 },
        ],
        topLayerTiles: [],
      },
    ],
  },
  {
    id: 'cave-entrance',
    baking: 'tile',
    name: 'Cave entrance',
    section: 'Doors',
    set: [
      {
        bottomLayerTiles: [
          { dRow: 0, dCol: 0, tile: 110 },
          { dRow: 0, dCol: 1, tile: 111 },
          { dRow: 1, dCol: 0, tile: 126 },
          { dRow: 1, dCol: 1, tile: 127 },
        ],
        topLayerTiles: [],
      },
    ],
  },
  {
    id: 'fire-house',
    baking: 'tile',
    name: 'Fire House',
    section: 'Decorations',
    set: [
      {
        bottomLayerTiles: [
          { dRow: 0, dCol: 0, tile: 595 },
          { dRow: 0, dCol: 1, tile: 599 },
          { dRow: 0, dCol: 2, tile: 614 },
          { dRow: 0, dCol: 3, tile: 617 },
          { dRow: 0, dCol: 4, tile: 600 },
          { dRow: 0, dCol: 5, tile: 604 },
          { dRow: 1, dCol: 0, tile: 592 },
          { dRow: 1, dCol: 1, tile: 593 },
          { dRow: 1, dCol: 2, tile: 594 },
          { dRow: 1, dCol: 3, tile: 605 },
          { dRow: 1, dCol: 4, tile: 606 },
          { dRow: 1, dCol: 5, tile: 607 },
          { dRow: 2, dCol: 0, tile: 608 },
          { dRow: 2, dCol: 1, tile: 609 },
          { dRow: 2, dCol: 2, tile: 610 },
          { dRow: 2, dCol: 3, tile: 621 },
          { dRow: 2, dCol: 4, tile: 622 },
          { dRow: 2, dCol: 5, tile: 623 },
          { dRow: 3, dCol: 0, tile: 595 },
          { dRow: 3, dCol: 1, tile: 596 },
          { dRow: 3, dCol: 2, tile: 597 },
          { dRow: 3, dCol: 3, tile: 602 },
          { dRow: 3, dCol: 4, tile: 603 },
          { dRow: 3, dCol: 5, tile: 604 },
          { dRow: 4, dCol: 0, tile: 611 },
          { dRow: 4, dCol: 1, tile: 612 },
          { dRow: 4, dCol: 2, tile: 613 },
          { dRow: 4, dCol: 3, tile: 618 },
          { dRow: 4, dCol: 4, tile: 619 },
          { dRow: 4, dCol: 5, tile: 620 },
        ],
        topLayerTiles: [
          { dRow: 5, dCol: 0, tile: 394 },
          { dRow: 5, dCol: 1, tile: 395 },
          { dRow: 5, dCol: 2, tile: 428 },
          { dRow: 5, dCol: 3, tile: 414 },
          { dRow: 5, dCol: 4, tile: 415 },
          { dRow: 5, dCol: 5, tile: 429 },
        ],
      },
    ],
  },
  {
    id: 'hidden-staircase',
    baking: 'tile',
    name: 'Hidden Staircase',
    // Lives in Doors: it is a door-like entrance rather than scenery.
    section: 'Doors',
    set: [
      {
        bottomLayerTiles: [
          { dRow: 0, dCol: 0, tile: 100 },
          { dRow: 0, dCol: 1, tile: 101 },
          { dRow: 1, dCol: 0, tile: 102 },
          { dRow: 1, dCol: 1, tile: 103 },
        ],
        topLayerTiles: [],
      },
    ],
  },
  {
    id: 'house-closed-door',
    baking: 'tile',
    name: 'House closed door',
    section: 'Decorations',
    set: [
      {
        bottomLayerTiles: [],
        topLayerTiles: [
          { dRow: 0, dCol: 0, tile: 407 },
          { dRow: 0, dCol: 1, tile: 408 },
          { dRow: 1, dCol: 0, tile: 936 },
          { dRow: 1, dCol: 1, tile: 937 },
        ],
      },
    ],
  },
  {
    id: 'house1',
    baking: 'tile',
    name: 'House',
    section: 'Decorations',
    set: [
      {
        bottomLayerTiles: [],
        topLayerTiles: [
          { dRow: 0, dCol: 0, tile: 384 },
          { dRow: 0, dCol: 1, tile: 385 },
          { dRow: 0, dCol: 2, tile: 386 },
          { dRow: 0, dCol: 3, tile: 386 },
          { dRow: 0, dCol: 4, tile: 387 },
          { dRow: 0, dCol: 5, tile: 388 },
          { dRow: 1, dCol: 0, tile: 400 },
          { dRow: 1, dCol: 1, tile: 401 },
          { dRow: 1, dCol: 2, tile: 402 },
          { dRow: 1, dCol: 3, tile: 402 },
          { dRow: 1, dCol: 4, tile: 403 },
          { dRow: 1, dCol: 5, tile: 404 },
          { dRow: 2, dCol: 0, tile: 389 },
          { dRow: 2, dCol: 1, tile: 390 },
          { dRow: 2, dCol: 2, tile: 391 },
          { dRow: 2, dCol: 3, tile: 391 },
          { dRow: 2, dCol: 4, tile: 392 },
          { dRow: 2, dCol: 5, tile: 393 },
          { dRow: 3, dCol: 0, tile: 405 },
          { dRow: 3, dCol: 1, tile: 406 },
          { dRow: 3, dCol: 2, tile: 407 },
          { dRow: 3, dCol: 3, tile: 408 },
          { dRow: 3, dCol: 4, tile: 406 },
          { dRow: 3, dCol: 5, tile: 409 },
          { dRow: 4, dCol: 0, tile: 394 },
          { dRow: 4, dCol: 1, tile: 395 },
          { dRow: 4, dCol: 2, tile: 412 },
          { dRow: 4, dCol: 3, tile: 413 },
          { dRow: 4, dCol: 4, tile: 396 },
          { dRow: 4, dCol: 5, tile: 397 },
        ],
      },
    ],
  },
  {
    id: 'house2',
    baking: 'tile',
    name: 'House2',
    section: 'Decorations',
    set: [
      {
        bottomLayerTiles: [
          { dRow: 0, dCol: 0, tile: 614 },
          { dRow: 0, dCol: 1, tile: 615 },
          { dRow: 0, dCol: 2, tile: 616 },
          { dRow: 0, dCol: 3, tile: 615 },
          { dRow: 0, dCol: 4, tile: 616 },
          { dRow: 0, dCol: 5, tile: 617 },
          { dRow: 1, dCol: 0, tile: 610 },
          { dRow: 1, dCol: 1, tile: 611 },
          { dRow: 1, dCol: 2, tile: 611 },
          { dRow: 1, dCol: 3, tile: 620 },
          { dRow: 1, dCol: 4, tile: 620 },
          { dRow: 1, dCol: 5, tile: 621 },
          { dRow: 2, dCol: 0, tile: 608 },
          { dRow: 2, dCol: 1, tile: 609 },
          { dRow: 2, dCol: 2, tile: 622 },
          { dRow: 2, dCol: 3, tile: 609 },
          { dRow: 2, dCol: 4, tile: 622 },
          { dRow: 2, dCol: 5, tile: 623 },
          { dRow: 3, dCol: 0, tile: 608 },
          { dRow: 3, dCol: 1, tile: 609 },
          { dRow: 3, dCol: 2, tile: 622 },
          { dRow: 3, dCol: 3, tile: 609 },
          { dRow: 3, dCol: 4, tile: 622 },
          { dRow: 3, dCol: 5, tile: 623 },
          { dRow: 4, dCol: 0, tile: 612 },
          { dRow: 4, dCol: 1, tile: 626 },
          { dRow: 4, dCol: 2, tile: 637 },
          { dRow: 4, dCol: 3, tile: 613 },
          { dRow: 4, dCol: 4, tile: 618 },
          { dRow: 4, dCol: 5, tile: 619 },
        ],
        topLayerTiles: [
          { dRow: 5, dCol: 0, tile: 427 },
          { dRow: 5, dCol: 1, tile: 412 },
          { dRow: 5, dCol: 2, tile: 413 },
          { dRow: 5, dCol: 3, tile: 428 },
          { dRow: 5, dCol: 4, tile: 396 },
          { dRow: 5, dCol: 5, tile: 397 },
        ],
      },
    ],
  },
  {
    id: 'lifting-rock-soil',
    baking: 'tile',
    name: 'Lifting rock soil',
    section: 'Decorations',
    set: [
      {
        bottomLayerTiles: [
          { dRow: 0, dCol: 0, tile: 96 },
          { dRow: 0, dCol: 1, tile: 97 },
          { dRow: 1, dCol: 0, tile: 98 },
          { dRow: 1, dCol: 1, tile: 99 },
        ],
        topLayerTiles: [],
      },
    ],
  },
  {
    id: 'statue',
    baking: 'tile',
    name: 'Statue',
    section: 'Decorations',
    set: [
      {
        bottomLayerTiles: [
          { dRow: 0, dCol: 0, tile: 656 },
          { dRow: 0, dCol: 1, tile: 657 },
          { dRow: 1, dCol: 0, tile: 658 },
          { dRow: 1, dCol: 1, tile: 659 },
        ],
        topLayerTiles: [],
      },
    ],
  },
  {
    id: 'tree',
    baking: 'tile',
    name: 'Tree',
    section: 'Decorations',
    set: [
      {
        // Base: three canopy rows over the trunk row (4 rows total).
        bottomLayerTiles: [
          { dRow: -2, dCol: 0, tile: 74 },
          { dRow: -2, dCol: 1, tile: 74 },
          { dRow: -2, dCol: 2, tile: 74 },
          { dRow: -2, dCol: 3, tile: 74 },
          { dRow: -1, dCol: 0, tile: 74 },
          { dRow: -1, dCol: 1, tile: 74 },
          { dRow: -1, dCol: 2, tile: 74 },
          { dRow: -1, dCol: 3, tile: 74 },
          { dRow: 0, dCol: 0, tile: 508 },
          { dRow: 0, dCol: 1, tile: 509 },
          { dRow: 0, dCol: 2, tile: 510 },
          { dRow: 0, dCol: 3, tile: 511 },
          { dRow: 1, dCol: 0, tile: 524 },
          { dRow: 1, dCol: 1, tile: 525 },
          { dRow: 1, dCol: 2, tile: 526 },
          { dRow: 1, dCol: 3, tile: 527 },
        ],
        // Treetop row, one row above the base.
        topLayerTiles: [
          { dRow: -3, dCol: 0, tile: 464 },
          { dRow: -3, dCol: 1, tile: 465 },
          { dRow: -3, dCol: 2, tile: 466 },
          { dRow: -3, dCol: 3, tile: 467 },
          { dRow: -2, dCol: 0, tile: 480 },
          { dRow: -2, dCol: 1, tile: 481 },
          { dRow: -2, dCol: 2, tile: 482 },
          { dRow: -2, dCol: 3, tile: 483 },
          { dRow: -1, dCol: 0, tile: 496 },
          { dRow: -1, dCol: 1, tile: 497 },
          { dRow: -1, dCol: 2, tile: 498 },
          { dRow: -1, dCol: 3, tile: 499 },
        ],
      },
    ],
  },
  {
    id: 'breakable-block',
    baking: 'tile',
    name: 'Breakable Block',
    section: 'Decorations',
    // A single tile that can be GROWN in any direction from the context menu:
    // the tile is repeated, so a whole wall is one smart object instead of many.
    scalable: {},
    set: [
      {
        // A single breakable-block tile stamped on the base (ground) layer.
        bottomLayerTiles: [{ dRow: 0, dCol: 0, tile: 1 }],
        topLayerTiles: [],
      },
    ],
  },
  {
    id: 'treetop',
    baking: 'tile',
    name: 'Treetop',
    section: 'Decorations',
    set: [
      {
        bottomLayerTiles: [
          { dRow: 3, dCol: 0, tile: 512 },
          { dRow: 3, dCol: 1, tile: 513 },
          { dRow: 3, dCol: 2, tile: 514 },
          { dRow: 3, dCol: 3, tile: 515 },
        ],
        topLayerTiles: [
          { dRow: 0, dCol: 0, tile: 464 },
          { dRow: 0, dCol: 1, tile: 465 },
          { dRow: 0, dCol: 2, tile: 466 },
          { dRow: 0, dCol: 3, tile: 467 },
          { dRow: 1, dCol: 0, tile: 480 },
          { dRow: 1, dCol: 1, tile: 481 },
          { dRow: 1, dCol: 2, tile: 482 },
          { dRow: 1, dCol: 3, tile: 483 },
          { dRow: 2, dCol: 0, tile: 496 },
          { dRow: 2, dCol: 1, tile: 497 },
          { dRow: 2, dCol: 2, tile: 498 },
          { dRow: 2, dCol: 3, tile: 499 },
        ],
      },
    ],
  },
];

/**
 * Actor-baked (enemy) definitions, registered at runtime from FSALib's actor
 * catalog. Kept separate from the static catalog because they are loaded
 * asynchronously; {@link findSmartObjectDefinition} searches both.
 */
const ACTOR_SMART_OBJECTS = new Map<string, SmartObjectDefinition>();

/**
 * Registers actor-baked smart objects (enemies) so placements referring to them
 * can be resolved by id (for hover, move, delete and rotation).
 *
 * The registry is ADDITIVE: actor templates are seeded at module load (see the
 * bottom of this file) and must survive the catalog registration that happens
 * later, asynchronously.
 */
export function registerActorSmartObjects(definitions: SmartObjectDefinition[]): void {
  for (const definition of definitions) {
    ACTOR_SMART_OBJECTS.set(definition.id, definition);
  }
}

/**
 * Legacy definition ids that were merged into another definition's `subTypes`.
 * Old saved rooms still reference these ids, so they resolve to the merged
 * definition plus the sub-type index to use.
 */
const LEGACY_SUBTYPE_IDS: Record<string, { id: string; subTypeIndex: number }> = {
  'closed-door': { id: 'door', subTypeIndex: 1 },
  'key-door': { id: 'door', subTypeIndex: 2 },
  'big-closed-door': { id: 'big-door', subTypeIndex: 1 },
  'big-key-door': { id: 'big-door', subTypeIndex: 2 },
};

/** Looks up a smart-object definition by id (static catalog then actor-baked). */
export function findSmartObjectDefinition(id: string): SmartObjectDefinition | undefined {
  const direct =
    SMART_OBJECT_DEFINITIONS.find((definition) => definition.id === id) ??
    ACTOR_SMART_OBJECTS.get(id);
  if (direct) {
    return direct;
  }
  // A legacy id merged into another definition's sub-types.
  const legacy = LEGACY_SUBTYPE_IDS[id];
  if (legacy) {
    return SMART_OBJECT_DEFINITIONS.find((definition) => definition.id === legacy.id);
  }
  return undefined;
}

/**
 * Resolves the sub-type a placement uses: the sub-type index recorded on the
 * placement, or the one implied by a legacy definition id.
 */
export function resolveSubTypeIndex(id: string, subTypeIndex: number | undefined): number {
  if (subTypeIndex !== undefined) {
    return subTypeIndex;
  }
  return LEGACY_SUBTYPE_IDS[id]?.subTypeIndex ?? 0;
}

/**
 * The variants a definition stamps for a given sub-type: the sub-type's `set`
 * when the definition has sub-types, otherwise the definition's own `set`.
 */
export function variantsForSubType(
  definition: SmartObjectDefinition,
  subTypeIndex = 0,
): SmartObjectVariant[] {
  const subType = definition.subTypes?.[subTypeIndex];
  return subType?.set ?? definition.set;
}
