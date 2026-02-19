#!/usr/bin/env tsx
/**
 * Database builder for South Korea Law MCP server.
 *
 * Builds the SQLite database from seed JSON files in data/seed/.
 *
 * Usage: npm run build:db
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEED_DIR = path.resolve(__dirname, '../data/seed');
const DB_PATH = path.resolve(__dirname, '../data/database.db');

// ─────────────────────────────────────────────────────────────────────────────
// Seed file types
// ─────────────────────────────────────────────────────────────────────────────

interface DocumentSeed {
  id: string;
  type: 'statute' | 'presidential_decree' | 'ministerial_ordinance';
  title: string;
  title_en?: string;
  short_name?: string;
  law_number?: string;
  status: 'in_force' | 'amended' | 'repealed' | 'not_yet_in_force';
  issued_date?: string;
  in_force_date?: string;
  url?: string;
  description?: string;
  language?: string;
  provisions?: ProvisionSeed[];
}

interface ProvisionSeed {
  provision_ref: string;
  chapter?: string;
  section: string;
  title?: string;
  content: string;
  content_en?: string;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Database schema
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA = `
-- Legal documents (statutes, presidential decrees, ministerial ordinances)
CREATE TABLE legal_documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('statute', 'presidential_decree', 'ministerial_ordinance')),
  title TEXT NOT NULL,
  title_en TEXT,
  short_name TEXT,
  law_number TEXT,
  status TEXT NOT NULL DEFAULT 'in_force'
    CHECK(status IN ('in_force', 'amended', 'repealed', 'not_yet_in_force')),
  issued_date TEXT,
  in_force_date TEXT,
  url TEXT,
  description TEXT,
  language TEXT DEFAULT 'ko',
  last_updated TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_documents_law_number ON legal_documents(law_number);

-- Individual provisions from statutes
CREATE TABLE legal_provisions (
  id INTEGER PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES legal_documents(id),
  provision_ref TEXT NOT NULL,
  chapter TEXT,
  section TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  content_en TEXT,
  language TEXT DEFAULT 'ko',
  metadata TEXT,
  UNIQUE(document_id, provision_ref)
);

CREATE INDEX idx_provisions_doc ON legal_provisions(document_id);
CREATE INDEX idx_provisions_chapter ON legal_provisions(document_id, chapter);

-- FTS5 for provision search (Korean + English content)
CREATE VIRTUAL TABLE provisions_fts USING fts5(
  content, title, content_en,
  content='legal_provisions',
  content_rowid='id',
  tokenize='unicode61'
);

CREATE TRIGGER provisions_ai AFTER INSERT ON legal_provisions BEGIN
  INSERT INTO provisions_fts(rowid, content, title, content_en)
  VALUES (new.id, new.content, new.title, COALESCE(new.content_en, ''));
END;

CREATE TRIGGER provisions_ad AFTER DELETE ON legal_provisions BEGIN
  INSERT INTO provisions_fts(provisions_fts, rowid, content, title, content_en)
  VALUES ('delete', old.id, old.content, old.title, COALESCE(old.content_en, ''));
END;

CREATE TRIGGER provisions_au AFTER UPDATE ON legal_provisions BEGIN
  INSERT INTO provisions_fts(provisions_fts, rowid, content, title, content_en)
  VALUES ('delete', old.id, old.content, old.title, COALESCE(old.content_en, ''));
  INSERT INTO provisions_fts(rowid, content, title, content_en)
  VALUES (new.id, new.content, new.title, COALESCE(new.content_en, ''));
END;

-- English translations (separate table for KLRI translations)
CREATE TABLE english_translations (
  id INTEGER PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES legal_documents(id),
  provision_ref TEXT,
  translation TEXT NOT NULL,
  source TEXT DEFAULT 'KLRI',
  last_updated TEXT DEFAULT (datetime('now')),
  UNIQUE(document_id, provision_ref)
);

CREATE INDEX idx_translations_doc ON english_translations(document_id);

-- Cross-references between provisions/documents
CREATE TABLE cross_references (
  id INTEGER PRIMARY KEY,
  source_document_id TEXT NOT NULL REFERENCES legal_documents(id),
  source_provision_ref TEXT,
  target_document_id TEXT NOT NULL REFERENCES legal_documents(id),
  target_provision_ref TEXT,
  ref_type TEXT NOT NULL DEFAULT 'references'
    CHECK(ref_type IN ('references', 'amended_by', 'implements', 'see_also'))
);

CREATE INDEX idx_xref_source ON cross_references(source_document_id);
CREATE INDEX idx_xref_target ON cross_references(target_document_id);

-- =============================================================================
-- EU REFERENCES SCHEMA
-- =============================================================================

CREATE TABLE eu_documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('directive', 'regulation')),
  year INTEGER NOT NULL CHECK (year >= 1957 AND year <= 2100),
  number INTEGER NOT NULL CHECK (number > 0),
  community TEXT CHECK (community IN ('EU', 'EC', 'EEC', 'Euratom')),
  celex_number TEXT,
  title TEXT,
  title_en TEXT,
  short_name TEXT,
  adoption_date TEXT,
  entry_into_force_date TEXT,
  in_force BOOLEAN DEFAULT 1,
  amended_by TEXT,
  repeals TEXT,
  url_eur_lex TEXT,
  description TEXT,
  last_updated TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_eu_documents_type_year ON eu_documents(type, year DESC);
CREATE INDEX idx_eu_documents_celex ON eu_documents(celex_number);

CREATE TABLE eu_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL CHECK (source_type IN ('provision', 'document', 'case_law')),
  source_id TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES legal_documents(id),
  provision_id INTEGER REFERENCES legal_provisions(id),
  eu_document_id TEXT NOT NULL REFERENCES eu_documents(id),
  eu_article TEXT,
  reference_type TEXT NOT NULL CHECK (reference_type IN (
    'implements', 'supplements', 'applies', 'references', 'complies_with',
    'derogates_from', 'amended_by', 'repealed_by', 'cites_article'
  )),
  reference_context TEXT,
  full_citation TEXT,
  is_primary_implementation BOOLEAN DEFAULT 0,
  implementation_status TEXT CHECK (implementation_status IN ('complete', 'partial', 'pending', 'unknown')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_verified TEXT,
  UNIQUE(source_id, eu_document_id, eu_article)
);

CREATE INDEX idx_eu_references_document ON eu_references(document_id, eu_document_id);
CREATE INDEX idx_eu_references_eu_document ON eu_references(eu_document_id, document_id);
CREATE INDEX idx_eu_references_provision ON eu_references(provision_id, eu_document_id);

-- Build metadata (tier, schema version, build timestamp)
CREATE TABLE db_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function dedupeProvisions(provisions: ProvisionSeed[]): ProvisionSeed[] {
  const byRef = new Map<string, ProvisionSeed>();

  for (const provision of provisions) {
    const ref = provision.provision_ref.trim();
    const existing = byRef.get(ref);

    if (!existing) {
      byRef.set(ref, { ...provision, provision_ref: ref });
      continue;
    }

    // Keep the one with more content
    const existingContent = normalizeWhitespace(existing.content);
    const incomingContent = normalizeWhitespace(provision.content);

    if (incomingContent.length > existingContent.length) {
      byRef.set(ref, {
        ...provision,
        provision_ref: ref,
        title: provision.title ?? existing.title,
      });
    }
  }

  return Array.from(byRef.values());
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

function buildDatabase(): void {
  console.log('Building South Korea Law MCP database...\n');

  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log('  Deleted existing database.\n');
  }

  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  db.exec(SCHEMA);

  const insertDoc = db.prepare(`
    INSERT INTO legal_documents (id, type, title, title_en, short_name, law_number, status, issued_date, in_force_date, url, description, language)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertProvision = db.prepare(`
    INSERT INTO legal_provisions (document_id, provision_ref, chapter, section, title, content, content_en, language, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertEuDocument = db.prepare(`
    INSERT OR IGNORE INTO eu_documents
      (id, type, year, number, community, title, short_name, url_eur_lex, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertEuReference = db.prepare(`
    INSERT OR IGNORE INTO eu_references
      (source_type, source_id, document_id, provision_id, eu_document_id, eu_article,
       reference_type, reference_context, full_citation, is_primary_implementation,
       implementation_status, last_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Load seed files
  if (!fs.existsSync(SEED_DIR)) {
    console.log(`No seed directory at ${SEED_DIR} — creating empty database.`);

    // Insert GDPR EU document for cross-referencing
    insertDefaultEuDocuments(db, insertEuDocument);
    writeMetadata(db);
    finalizeDb(db);
    return;
  }

  const seedFiles = fs.readdirSync(SEED_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('.') && !f.startsWith('_'));

  if (seedFiles.length === 0) {
    console.log('No seed files found. Database created with empty schema.');
    insertDefaultEuDocuments(db, insertEuDocument);
    writeMetadata(db);
    finalizeDb(db);
    return;
  }

  let totalDocs = 0;
  let totalProvisions = 0;
  let totalEuDocuments = 0;
  let totalEuReferences = 0;
  let emptyDocs = 0;

  const loadAll = db.transaction(() => {
    // Insert default EU documents for cross-referencing
    insertDefaultEuDocuments(db, insertEuDocument);
    totalEuDocuments += 3;

    for (const file of seedFiles) {
      const filePath = path.join(SEED_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const seed = JSON.parse(content) as DocumentSeed;

      insertDoc.run(
        seed.id,
        seed.type ?? 'statute',
        seed.title,
        seed.title_en ?? null,
        seed.short_name ?? null,
        seed.law_number ?? null,
        seed.status ?? 'in_force',
        seed.issued_date ?? null,
        seed.in_force_date ?? null,
        seed.url ?? null,
        seed.description ?? null,
        seed.language ?? 'ko',
      );
      totalDocs++;

      if (!seed.provisions || seed.provisions.length === 0) {
        emptyDocs++;
        continue;
      }

      const deduped = dedupeProvisions(seed.provisions);

      for (const prov of deduped) {
        insertProvision.run(
          seed.id,
          prov.provision_ref,
          prov.chapter ?? null,
          prov.section,
          prov.title ?? null,
          prov.content,
          prov.content_en ?? null,
          'ko',
          prov.metadata ? JSON.stringify(prov.metadata) : null,
        );
        totalProvisions++;
      }

      // Auto-add GDPR cross-reference for PIPA
      if (seed.title.includes('개인정보 보호법') || seed.title_en?.includes('Personal Information Protection')) {
        try {
          insertEuReference.run(
            'document', seed.id, seed.id, null,
            'regulation:2016/679', null,
            'references',
            'PIPA is substantially aligned with GDPR. South Korea GDPR adequacy talks ongoing since 2022.',
            'Regulation (EU) 2016/679 (GDPR)',
            1, 'partial', new Date().toISOString(),
          );
          totalEuReferences++;
        } catch {
          // Ignore duplicate
        }
      }
    }
  });

  loadAll();

  writeMetadata(db);
  finalizeDb(db);

  const size = fs.statSync(DB_PATH).size;
  console.log(
    `\nBuild complete: ${totalDocs} documents, ${totalProvisions} provisions, ` +
    `${totalEuDocuments} EU documents, ${totalEuReferences} EU references`
  );
  if (emptyDocs > 0) {
    console.log(`  ${emptyDocs} documents with no provisions.`);
  }
  console.log(`Output: ${DB_PATH} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

function insertDefaultEuDocuments(db: Database, stmt: Database.Statement): void {
  // GDPR
  stmt.run(
    'regulation:2016/679', 'regulation', 2016, 679, 'EU',
    'General Data Protection Regulation (GDPR)',
    'GDPR',
    'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
    'The EU General Data Protection Regulation - primary reference for PIPA alignment analysis',
  );
  // NIS2 Directive
  stmt.run(
    'directive:2022/2555', 'directive', 2022, 2555, 'EU',
    'Directive on measures for a high common level of cybersecurity (NIS2)',
    'NIS2',
    'https://eur-lex.europa.eu/eli/dir/2022/2555/oj',
    'The EU NIS2 Directive - reference for Network Act cybersecurity provisions',
  );
  // AI Act
  stmt.run(
    'regulation:2024/1689', 'regulation', 2024, 1689, 'EU',
    'Regulation laying down harmonised rules on artificial intelligence (AI Act)',
    'AI Act',
    'https://eur-lex.europa.eu/eli/reg/2024/1689/oj',
    'The EU AI Act - reference for Framework Act on Intelligent Informatization',
  );
}

function writeMetadata(db: Database): void {
  const insertMeta = db.prepare('INSERT INTO db_metadata (key, value) VALUES (?, ?)');
  const writeMeta = db.transaction(() => {
    insertMeta.run('tier', 'free');
    insertMeta.run('schema_version', '1');
    insertMeta.run('built_at', new Date().toISOString());
    insertMeta.run('builder', 'build-db.ts');
    insertMeta.run('jurisdiction', 'KR');
    insertMeta.run('source', 'law.go.kr');
    insertMeta.run('licence', 'Korean Government Open Data');
  });
  writeMeta();
}

function finalizeDb(db: Database): void {
  db.pragma('journal_mode = DELETE');
  db.exec('ANALYZE');
  db.exec('VACUUM');
  db.close();
}

buildDatabase();
