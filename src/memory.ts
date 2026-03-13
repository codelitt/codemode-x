import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Memory database — structured LLM memory stored in SQLite.
 * Parses CLAUDE.md-style markdown tables and stores them for
 * querying via the database adapter.
 */

export const MEMORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT,
  notes TEXT,
  category TEXT DEFAULT 'team'
);

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'multifamily',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL,
  meaning TEXT
);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

/**
 * Create a new memory database with the schema.
 */
export function initMemoryDb(dbPath: string): void {
  let Database: any;
  try {
    const { createRequire } = require('module');
    const req = createRequire(import.meta.url);
    Database = req('better-sqlite3');
  } catch {
    throw new Error('Memory database requires better-sqlite3. Install it: npm install better-sqlite3');
  }

  const db = new Database(resolve(dbPath));
  db.exec(MEMORY_SCHEMA);
  db.close();
  console.log(`Memory database initialized at ${resolve(dbPath)}`);
}

/**
 * Import markdown tables from a CLAUDE.md-style file into the memory database.
 *
 * Detects table type from headers:
 *   - "Who | Role" → people table
 *   - "Property | Notes" → properties table
 *   - "Name | What" → entities table
 *   - "Term | Meaning" → terms table
 *
 * Also stores key-value pairs from non-table sections into the memories table.
 */
export function importMarkdown(dbPath: string, mdPath: string): void {
  let Database: any;
  try {
    const { createRequire } = require('module');
    const req = createRequire(import.meta.url);
    Database = req('better-sqlite3');
  } catch {
    throw new Error('Memory database requires better-sqlite3. Install it: npm install better-sqlite3');
  }

  const db = new Database(resolve(dbPath));
  const content = readFileSync(resolve(mdPath), 'utf-8');

  // Ensure schema exists
  db.exec(MEMORY_SCHEMA);

  const lines = content.split('\n');
  let currentSection = '';
  let importCount = 0;

  const insertPerson = db.prepare('INSERT INTO people (name, role, notes, category) VALUES (?, ?, ?, ?)');
  const insertProperty = db.prepare('INSERT INTO properties (name, type, notes) VALUES (?, ?, ?)');
  const insertEntity = db.prepare('INSERT INTO entities (name, description) VALUES (?, ?)');
  const insertTerm = db.prepare('INSERT INTO terms (term, meaning) VALUES (?, ?)');
  const insertMemory = db.prepare('INSERT INTO memories (category, key, value) VALUES (?, ?, ?)');

  const importAll = db.transaction(() => {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Track section headings
      if (line.startsWith('#')) {
        currentSection = line.replace(/^#+\s*/, '').trim();
        continue;
      }

      // Skip non-table lines
      if (!line.startsWith('|')) continue;

      // Skip separator rows (| --- | --- |)
      if (/^\|[\s-:|]+\|$/.test(line)) continue;

      // Parse table row
      const cells = line
        .split('|')
        .map(c => c.trim())
        .filter(c => c.length > 0);

      if (cells.length < 2) continue;

      // Skip header rows — detect by checking if next line is a separator
      const nextLine = lines[i + 1]?.trim() ?? '';
      if (/^\|[\s-:|]+\|$/.test(nextLine)) continue;

      // Determine which table to insert into based on section name
      const sectionLower = currentSection.toLowerCase();

      // Clean markdown bold/links from cells
      const clean = cells.map(c => c.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim());

      if (sectionLower.includes('direct report') || sectionLower.includes('team') || sectionLower.includes('investor') || sectionLower.includes('external')) {
        const category = sectionLower.includes('investor') || sectionLower.includes('external') ? 'investor' : 'team';
        insertPerson.run(clean[0], clean[1] || null, clean[2] || null, category);
        importCount++;
      } else if (sectionLower.includes('portfolio') || sectionLower.includes('propert')) {
        const notes = clean[1] || null;
        insertProperty.run(clean[0], 'multifamily', notes);
        importCount++;
      } else if (sectionLower.includes('entit')) {
        insertEntity.run(clean[0], clean[1] || null);
        importCount++;
      } else if (sectionLower.includes('term')) {
        insertTerm.run(clean[0], clean[1] || null);
        importCount++;
      } else {
        // Generic: store as memory
        insertMemory.run(currentSection, clean[0], clean.slice(1).join(' | '));
        importCount++;
      }
    }
  });

  importAll();
  db.close();
  console.log(`Imported ${importCount} rows from ${resolve(mdPath)} into ${resolve(dbPath)}`);
}
