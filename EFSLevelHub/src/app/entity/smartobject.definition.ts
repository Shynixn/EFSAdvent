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

/** The kind of a smart object. Currently only a placable decoration. */
export type SmartObjectType = 'decoration';

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
}

/** Toolbox section a definition belongs to. */
export type SmartObjectSection = 'Doors' | 'Decorations';

/** A hard-coded smart-object (decoration) definition. */
export interface SmartObjectDefinition {
  /** Stable id, e.g. `tree`. */
  id: string;
  /** What kind of smart object this is (e.g. `decoration`). */
  type: SmartObjectType;
  /** Display name shown in the toolbox. */
  name: string;
  /** Toolbox section this definition is grouped under. */
  section: SmartObjectSection;
  /**
   * The variants (rotation styles) of this object. Single-entry for objects
   * that do not rotate (e.g. a tree); four entries for doors (one per facing).
   */
  set: SmartObjectVariant[];
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
    id: 'closed-door',
    type: 'decoration',
    name: 'Closed door',
    section: 'Doors',
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
    id: 'door',
    type: 'decoration',
    name: 'Door',
    section: 'Doors',
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
    id: 'key-door',
    type: 'decoration',
    name: 'Key door',
    section: 'Doors',
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
  {
    id: 'big-closed-door',
    type: 'decoration',
    name: 'Big Closed door',
    section: 'Doors',
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
    id: 'big-door',
    type: 'decoration',
    name: 'Big Door',
    section: 'Doors',
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
    id: 'big-key-door',
    type: 'decoration',
    name: 'Big Key door',
    section: 'Doors',
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
  {
    id: 'cave-entrance',
    type: 'decoration',
    name: 'Cave entrance',
    section: 'Decorations',
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
    type: 'decoration',
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
    type: 'decoration',
    name: 'Hidden Staircase',
    section: 'Decorations',
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
    type: 'decoration',
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
    type: 'decoration',
    name: 'House1',
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
    type: 'decoration',
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
    type: 'decoration',
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
    type: 'decoration',
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
    type: 'decoration',
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
    id: 'treetop',
    type: 'decoration',
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

/** Looks up a smart-object definition by id. */
export function findSmartObjectDefinition(id: string): SmartObjectDefinition | undefined {
  return SMART_OBJECT_DEFINITIONS.find((definition) => definition.id === id);
}
