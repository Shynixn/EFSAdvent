#!/usr/bin/env node
/**
 * Builds the Level Explorer search index.
 *
 * Scans `public/level/<guid>/manifest.json`, classifies each entry as a **world**
 * (the manifest has a `stages` array) or a **stage**, and writes
 * `public/level/searchindex.json` containing:
 *
 *  - `entries` — the flat list the browser renders as cards, and
 *  - `index`   — a pre-built FlexSearch documents index (exported), so the page
 *                only has to `import()` it instead of indexing in the browser.
 *
 * Usage:
 *   node scripts/build-level-search-index.mjs [--root <public/level>] [--out <file>]
 *
 * Exits non-zero only on unexpected I/O errors; a missing `level` folder simply
 * produces an empty index.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import FlexSearch from 'flexsearch';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');

/** Schema version written to the index (must match `LevelSearchIndex`). */
const INDEX_VERSION = 1;

/** Parses `--flag value` arguments. */
function parseArgs(argv) {
  const args = { root: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') args.root = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/build-level-search-index.mjs [--root <dir>] [--out <file>]');
      process.exit(0);
    }
  }
  return args;
}

/** Reads and parses a JSON file, or returns null when it is missing/invalid. */
async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Builds one index entry from a manifest, or null when it is not usable. */
function toEntry(guid, manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return null;
  }
  // A `stages` array marks a world; everything else is a stage.
  const isWorld = Array.isArray(manifest.stages);
  const stageIds = isWorld
    ? manifest.stages
        .map((stage) => (stage && typeof stage.id === 'string' ? stage.id : ''))
        .filter(Boolean)
    : [];

  return {
    id: guid,
    kind: isWorld ? 'world' : 'stage',
    name:
      (typeof manifest.name === 'string' && manifest.name.trim()) ||
      (isWorld ? 'Untitled World' : 'Untitled Stage'),
    author: (typeof manifest.author === 'string' && manifest.author.trim()) || 'Unknown',
    ...(typeof manifest.creationDate === 'string' ? { creationDate: manifest.creationDate } : {}),
    ...(isWorld ? { stageCount: stageIds.length, stages: stageIds } : {}),
  };
}

/** Creates a FlexSearch index tuned for one short text field (name/author). */
function createFieldIndex() {
  return new FlexSearch.Index({
    // Prefix matching so typing "shad" finds "Shadow Keep".
    tokenize: 'forward',
    resolution: 6,
    cache: false,
  });
}

/**
 * Serializes a field index as `[key, chunk]` pairs, the portable form of the
 * callback export API (the browser re-imports them with `import(key, chunk)`).
 */
function exportFieldIndex(index) {
  const chunks = [];
  index.export((key, data) => {
    chunks.push([key, data]);
  });
  return chunks;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(PROJECT_ROOT, args.root ?? path.join('public', 'level'));
  const outFile = path.resolve(PROJECT_ROOT, args.out ?? path.join(rootDir, 'searchindex.json'));

  const entries = [];
  const skipped = [];

  if (existsSync(rootDir)) {
    const dirents = await readdir(rootDir, { withFileTypes: true });
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) {
        continue;
      }
      const guid = dirent.name;
      const manifestFile = path.join(rootDir, guid, 'manifest.json');
      if (!existsSync(manifestFile)) {
        skipped.push(`${guid} (no manifest.json)`);
        continue;
      }
      const manifest = await readJson(manifestFile);
      const entry = toEntry(guid, manifest);
      if (!entry) {
        skipped.push(`${guid} (invalid manifest.json)`);
        continue;
      }
      entries.push(entry);
    }
  } else {
    console.warn(`[level-index] ${rootDir} does not exist — writing an empty index.`);
  }

  // Stable output: worlds and stages interleaved by name, then id.
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  // Pre-build the search index. Plain per-field `Index` instances are used
  // because their callback `export`/`import` is reliable in the published
  // bundle, whereas the documents API's `export()` is not.
  const fields = {
    name: createFieldIndex(),
    author: createFieldIndex(),
  };
  for (const entry of entries) {
    fields.name.add(entry.id, entry.name);
    fields.author.add(entry.id, entry.author);
  }

  const searchIndex = {
    version: INDEX_VERSION,
    generated: new Date().toISOString(),
    root: 'level',
    count: entries.length,
    entries,
    index: {
      name: exportFieldIndex(fields.name),
      author: exportFieldIndex(fields.author),
    },
  };

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(searchIndex));

  const worlds = entries.filter((entry) => entry.kind === 'world').length;
  console.log(
    `[level-index] Wrote ${path.relative(PROJECT_ROOT, outFile)} — ` +
      `${entries.length} entries (${worlds} world(s), ${entries.length - worlds} stage(s)).`,
  );
  for (const item of skipped) {
    console.warn(`[level-index] skipped ${item}`);
  }
}

main().catch((error) => {
  console.error('[level-index] failed:', error);
  process.exit(1);
});
