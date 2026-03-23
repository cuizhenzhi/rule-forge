import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dataDir = join(__dirname, '..', '..', '..', '..', 'data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const dbPath = join(dataDir, 'ruleforge.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schemaPath = join(__dirname, 'schema.sql');
  const schemaSql = readFileSync(schemaPath, 'utf-8');
  db.exec(schemaSql);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}