/**
 * Actor templates
 * ---------------
 * The hand-curated "one click places this actor" presets from EFSAdvent's
 * `data/actortemplates/*.txt` catalog, grouped into the toolbox tabs
 * **Items**, **NPC**, **Objects**, **Special** and **Switches**.
 *
 * Every template line looks like:
 *
 * ```text
 * Treasure Chest;TKRA, L:0, X:0, Y:0, V:0,0,0,4.
 * ```
 *
 * i.e. `name;ID, L:layer, X:x, Y:y, V:byte4,byte3,byte2,byte1.` — the exact
 * format FSALib's `Actor.ToStringCode()` writes and `Actor.PasteFromString()`
 * reads (`V` bytes are ordered LSB-byte FIRST: byte4, byte3, byte2, byte1).
 *
 * A template places an actor-baked smart object with the template's `Variable`,
 * so the sprite selected from the actor's render variants matches the preset
 * (e.g. `KEY0` renders a Key, Big Key, Power Bracelet… purely from `V`).
 *
 * This module has NO imports (not even types) to keep it free of module cycles:
 * projections onto smart objects live in `smartobject.entity.ts`.
 */

/** Toolbox tab a template is listed under. */
export type ActorTemplateSection = 'Items' | 'NPC' | 'Objects' | 'Special' | 'Switches';

/** One actor preset from the EFSAdvent template catalog. */
export interface ActorTemplate {
  /**
   * Stable smart-object id: `template:<section>:<index>`. Actor templates can
   * share the same actor id (e.g. several `KEY0` items), so the id cannot be the
   * actor id itself.
   */
  id: string;
  /** Display name shown in the toolbox, e.g. `Treasure Chest`. */
  name: string;
  /** 4-character actor id, e.g. `TKRA`. */
  actorId: string;
  /** Actor `Variable` packed from the template's `V` bytes. */
  variable: number;
  /** Toolbox tab this template belongs to. */
  section: ActorTemplateSection;
}

/** The order the toolbox tabs are shown in. */
export const ACTOR_TEMPLATE_SECTIONS: readonly ActorTemplateSection[] = [
  'Items',
  'NPC',
  'Objects',
  'Special',
  'Switches',
];

/**
 * Section → raw template lines, transcribed from EFSAdvent's `.txt` files.
 *
 * NOTE: the lines are kept as written in the source (including its typos). As in
 * EFSAdvent's loader, a line without the `name;code` separator is SKIPPED — the
 * source has three such `Items` lines (`Blue Bracelet, …`, `Bombos Medallion, …`,
 * `Quake Medallion, …` use a comma instead of a semicolon), so those presets do
 * not exist in the WinForms editor either.
 */
const TEMPLATE_LINES: Record<ActorTemplateSection, readonly string[]> = {
  Items: [
    'Force Gem;RUPY, L:0, X:0, Y:0, V:0,0,0,1.',
    'Buried Force Gem;BRRY, L:0, X:0, Y:0, V:0,0,0,0.',
    'Escaping Force Gem;ESRY, L:0, X:0, Y:0, V:0,0,0,0.',
    'Hovering Force Gem;HNRY, L:0, X:0, Y:0, V:0,0,16,0.',
    'Wooden Force Gem;WDRY, L:0, X:0, Y:0, V:0,0,0,0.',
    'Ice Force Gem;WDRY, L:0, X:0, Y:0, V:0,1,0,0.',
    'Force Lucke Hole;PONT, L:0, X:0, Y:0, V:0,0,0,0.',
    'Force Lucke Stone;GOLD, L:0, X:0, Y:0, V:0,2,0,0.',
    'Force Fairy (Hidden);PONT, L:0, X:0, Y:0, V:0,0,0,9.',
    'Force Fairy;FARY, L:0, X:0, Y:8, V:132,64,0,0.',
    'Key;KEY0, L:0, X:0, Y:0, V:0,0,0,0.',
    'Big Key;KEY0, L:0, X:0, Y:0, V:0,0,0,1.',
    'Power Bracelet;KEY0, L:0, X:0, Y:0, V:0,0,0,3.',
    'Heart Container;KEY0, L:0, X:0, Y:0, V:0,0,0,4.',
    // Typo in the source (comma, not semicolon) — skipped, exactly like EFSAdvent.
    'Blue Bracelet, L:0, X:0, Y:0, V:0,0,0,5.',
    'Moon Perl;KEY0, L:0, X:0, Y:0, V:0,0,0,6.',
    // Typo in the source (comma, not semicolon) — skipped, exactly like EFSAdvent.
    'Bombos Medallion, L:0, X:0, Y:0, V:0,0,0,7.',
    // Typo in the source (comma, not semicolon) — skipped, exactly like EFSAdvent.
    'Quake Medallion, L:0, X:0, Y:0, V:0,0,0,8.',
    'Carrot;NNJN, L:0, X:0, Y:0, V:8,34,128,0.',
  ],
  NPC: [
    'Old Man;JIJI, L:0, X:0, Y:0, V:0,0,0,0.',
    'Kepora Gebora;KEPO, L:0, X:0, Y:0, V:226,80,0,14.',
    'Navi;NAVI, L:0, X:0, Y:0, V:131,241,0,35.',
    'Cucco;NIWA, L:0, X:0, Y:0, V:0,0,0,6.',
    'Thief;TZOK, L:0, X:0, Y:0, V:40,9,8,0.',
    'Thief Cage;TOOI, L:0, X:0, Y:0, V:130,71,8,10.',
    'Gambling NPC;GMBL, L:0, X:0, Y:0, V:3,0,35,20.',
    'Gambling Shop Treasure Chest;GMTB, L:0, X:0, Y:0, V:0,0,0,0.',
    'Item Shopkeeper (unused);DEAL, L:0, X:0, Y:0, V:0,0,0,0.',
    'Shop Item (unused);SITM, L:0, X:0, Y:0, V:0,0,0,5.',
    'Malon;OPGL, L:0, X:0, Y:0, V:253,0,0,1.',
    'Malon (Arrival Point);OPGA, L:0, X:0, Y:0, V:167,128,0,0.',
    'Talon;OPGA, L:0, X:0, Y:0, V:0,0,0,1.',
    'Escort Zora;FAZR, L:0, X:0, Y:0, V:152,4,2,0.',
    'Escort Zora (Arrival Point);FZRA, L:0, X:0, Y:0, V:132,128,3,1.',
    'Hungry Zora;SAYA, L:0, X:0, Y:0, V:8,0,0,0.',
    'Fish;FISH, L:0, X:0, Y:0, V:0,0,0,0.',
    'Shooting Minigame NPC;SYKY, L:0, X:0, Y:0, V:128,0,0,0.',
    'Horse Racing Minigame NPC;HRMN, L:0, X:0, Y:0, V:128,0,0,0.',
    'Cucco Minigame NPC;NWOK, L:0, X:0, Y:0, V:128,0,1,64.',
    'Hammer Minigame NPC;HAYA, L:0, X:0, Y:0, V:252,0,0,0.',
    'Tennis Minigame NPC;TENN, L:0, X:0, Y:0, V:136,0,0,0.',
    'Whac-A-Mole Minigame NPC;MGYA, L:0, X:0, Y:0, V:248,0,0,0.',
    'Digging Minigame NPC (unused);ANHO, L:0, X:0, Y:0, V:248,0,0,0.',
    'Digging Treasure Hunt;SVTG, L:0, X:0, Y:0, V:0,0,0,0.',
  ],
  Objects: [
    'Treasure Chest;TKRA, L:0, X:0, Y:0, V:0,0,0,4.',
    'Big Chest;DOOR, L:0, X:0, Y:0, V:0,0,0,7.',
    'Movable 2x2 Block;BLCK, L:0, X:0, Y:0, V:0,0,0,9.',
    'Movable 3x3 Block;BLCK, L:0, X:0, Y:0, V:0,0,0,10.',
    'Movable 4x4 Block;BLCK, L:0, X:0, Y:0, V:0,0,0,11.',
    'Movable Color Block;BCK2, L:0, X:0, Y:0, V:0,0,0,4.',
    '2 Person Lifting Rock;RCK2, L:0, X:0, Y:0, V:0,0,0,0.',
    'Door;DOOR, L:0, X:5, Y:17, V:0,0,32,128.',
    'Torch Flame;TRCH, L:0, X:0, Y:0, V:0,0,0,0.',
    'Bomb Flower;HBMB, L:0, X:0, Y:0, V:0,0,0,1.',
    'Sign;KNBN, L:0, X:0, Y:0, V:0,0,0,0.',
    'Item Stand;SWNP, L:0, X:0, Y:0, V:12,0,192,2.',
    'Flying Cannon;CNON, L:0, X:0, Y:0, V:0,0,0,0.',
    'Movable 6x6 Platform;LIFT, L:0, X:0, Y:0, V:0,16,0,6.',
    'Icicle;ICCL, L:0, X:0, Y:0, V:0,0,0,0.',
    'Cloud Platform;CLOD, L:0, X:0, Y:0, V:0,0,0,0.',
    'Lily Pad;LOTS, L:0, X:0, Y:0, V:0,0,0,2.',
    'Lily Pad Zora;LTZR, L:0, X:0, Y:0, V:0,0,0,0.',
    'Liftable Tree;WOOD, L:0, X:0, Y:0, V:0,0,0,0.',
    'Jet Flame;FLME, L:0, X:0, Y:0, V:0,0,0,0.',
    'Eternal Flame;BLZ2, L:0, X:0, Y:0, V:0,0,0,0.',
    'Cactus;SBTN, L:0, X:0, Y:0, V:0,0,0,0.',
    'Castle Barrier;BARI, L:0, X:0, Y:0, V:12,64,0,2.',
    'Wooden Box (unused);BRBL, L:0, X:0, Y:0, V:0,0,0,1.',
    'Chasing Iron Ball;SBAL, L:0, X:0, Y:0, V:128,0,0,17.',
    'Iron Ball (Manager);TKYU, L:0, X:0, Y:0, V:0,88,88,1.',
    'Rotating fireball (Manager)l;FBMR, L:0, X:0, Y:0, V:12,0,0,3.',
    'Invisible NPC wall;TOMI, L:0, X:0, Y:0, V:0,0,0,0.',
    'Invisible Player Wall;PTMI, L:0, X:0, Y:0, V:0,0,0,0.',
  ],
  Special: [
    'Goal Warp;GLWP, L:0, X:0, Y:0, V:0,0,0,17.',
    'Battle Royale End Check;BFIN, L:0, X:0, Y:0, V:0,0,0,0.',
    'Environmental Control;SWEV, L:0, X:0, Y:0, V:0,40,0,0.',
    'Environmental Control 2;SEV2, L:0, X:0, Y:0, V:0,32,0,0.',
    'Light Control;LTEV, L:0, X:0, Y:0, V:0,0,0,3.',
    'Tingle Buster;TINB, L:0, X:0, Y:0, V:0,0,0,0.',
    'Vaati Buster;GFBS, L:0, X:0, Y:0, V:0,0,0,0.',
    'BGM change;BGMN, L:0, X:0, Y:0, V:0,0,32,159.',
    'Play SE;SWNP, L:0, X:0, Y:0, V:8,0,0,3.',
    'Play Warning SE;SENP, L:0, X:0, Y:0, V:1,128,0,2.',
    'Arrow Symbol;YAJI, L:0, X:0, Y:0, V:0,0,0,0.',
    'Treasure Mark;TKRM, L:0, X:0, Y:0, V:0,0,0,0.',
    'Blindfold;BLDF, L:0, X:0, Y:0, V:2,16,16,0.',
    'Zoom;ZOOM, L:0, X:0, Y:0, V:0,0,0,0.',
    'Zoom Out;ZOMO, L:0, X:0, Y:0, V:8,0,0,0.',
    'Focus;FOCS, L:0, X:0, Y:0, V:0,64,0,0.',
    'Room Scroll Blockade;SZSC, L:0, X:4, Y:0, V:128,0,0,0.',
    'Tile Rewriter;PNPC, L:0, X:0, Y:0, V:12,0,0,48.',
    'Tile Mass Rewriter;PNP2, L:0, X:0, Y:0, V:12,0,0,48.',
  ],
  Switches: [
    'Switch;SWTH, L:0, X:0, Y:0, V:8,0,0,0.',
    'Invisible Trigger Area;SWTH, L:0, X:0, Y:0, V:8,34,0,7.',
    'Tile Change Switch;PONT, L:0, X:0, Y:0, V:8,0,0,3.',
    '4 Person Switch;YNSW, L:0, X:0, Y:0, V:8,0,0,1.',
    'On / Off Switch;ONOF, L:0, X:0, Y:0, V:8,0,0,0.',
    'Eyeball Switch;MEDM, L:0, X:0, Y:0, V:0,0,0,0.',
    'Floor Block Switch;RDBL, L:0, X:0, Y:0, V:0,0,0,0.',
    'Candle Check Switch;LWSW, L:0, X:0, Y:0, V:8,0,0,0.',
    'Chain Pull Switch;PSWK, L:0, X:0, Y:0, V:8,0,0,0.',
    'BTI Pull Switch;PSWB, L:0, X:0, Y:0, V:8,0,0,0.',
    'Enemy Annihilation Switch;ZNSW, L:0, X:0, Y:0, V:1,0,0,0.',
    'Number Of Enemy Annihilation Switch;SKIL, L:0, X:0, Y:0, V:8,0,0,3.',
    'Thwomp Switch;DOSN, L:0, X:0, Y:0, V:8,0,0,0.',
    'Focus Switch;FOCS, L:0, X:0, Y:0, V:16,64,0,0.',
    'Local switch;LCLS, L:0, X:0, Y:0, V:8,64,0,0.',
    'Global Switch;GLBS, L:0, X:0, Y:0, V:8,64,0,0.',
    '4 Switch Monitoring;SWT4, L:0, X:0, Y:0, V:128,68,50,1.',
    'Wait Switch;WTSW, L:0, X:0, Y:0, V:16,64,0,128.',
    'OFF Switch;OFFS, L:0, X:0, Y:0, V:16,64,0,2.',
    'Check Switch;CKSW, L:0, X:0, Y:0, V:0,66,16,128.',
  ],
};

/** Matches one template line: `Name;ID, L:n, X:n, Y:n, V:a,b,c,d.` */
const TEMPLATE_RE =
  /^([^;]+);\s*([A-Za-z0-9]{4}),\s*L:\d+,\s*X:\d+,\s*Y:\d+,\s*V:(\d+),(\d+),(\d+),(\d+)/;

/** Packs the four `V` bytes of an EFSAdvent template code (`byte4..byte1`). */
function packVariable(b4: number, b3: number, b2: number, b1: number): number {
  return ((b4 & 0xff) | ((b3 & 0xff) << 8) | ((b2 & 0xff) << 16) | ((b1 & 0xff) << 24)) >>> 0;
}

/** Parses a section's raw template lines into {@link ActorTemplate}s. */
function parseSection(section: ActorTemplateSection, lines: readonly string[]): ActorTemplate[] {
  const templates: ActorTemplate[] = [];
  lines.forEach((line, index) => {
    const match = TEMPLATE_RE.exec(line.trim());
    if (!match) {
      return;
    }
    templates.push({
      id: `template:${section}:${index}`,
      name: match[1].trim(),
      actorId: match[2],
      variable: packVariable(+match[3], +match[4], +match[5], +match[6]),
      section,
    });
  });
  return templates;
}

/** Every actor template, in tab order. */
export const ACTOR_TEMPLATES: readonly ActorTemplate[] = ACTOR_TEMPLATE_SECTIONS.flatMap(
  (section) => parseSection(section, TEMPLATE_LINES[section]),
);

/** Templates of one toolbox tab. */
export function actorTemplatesFor(section: ActorTemplateSection): ActorTemplate[] {
  return ACTOR_TEMPLATES.filter((template) => template.section === section);
}
