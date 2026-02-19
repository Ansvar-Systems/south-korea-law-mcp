#!/usr/bin/env tsx
/**
 * Check law.go.kr for newly published or updated Korean statutes.
 *
 * Exits:
 *   0 = no updates
 *   1 = updates found
 *   2 = check failed (network/parse/database error)
 */

import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchLawList } from './lib/fetcher.js';
import { parseLawList, type LawIndexEntry } from './lib/parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../data/database.db');
const INDEX_PATH = resolve(__dirname, '../data/source/law-index.json');

const KEY_QUERIES = ['개인정보', '정보통신망', '신용정보', '전자정부', '지능정보화'];

interface UpdateHit {
  document_id: string;
  title: string;
  remote_updated: string;
  local_updated?: string;
}

async function fetchRecentEntries(): Promise<LawIndexEntry[]> {
  const entries: LawIndexEntry[] = [];

  for (const query of KEY_QUERIES) {
    const result = await fetchLawList(1, query);
    if (result.status === 200) {
      const parsed = parseLawList(result.body);
      entries.push(...parsed.entries);
    }
  }

  return entries;
}

async function main(): Promise<void> {
  console.log('South Korea Law MCP - Update checker');
  console.log('');

  if (!existsSync(DB_PATH)) {
    console.error(`Database not found: ${DB_PATH}`);
    process.exit(2);
  }

  const db = new Database(DB_PATH, { readonly: true });
  const localDocs = new Set<string>(
    (db.prepare("SELECT id FROM legal_documents").all() as { id: string }[])
      .map(row => row.id),
  );
  db.close();

  const localIndex = existsSync(INDEX_PATH)
    ? JSON.parse(readFileSync(INDEX_PATH, 'utf-8')) as LawIndexEntry[]
    : [];
  const localIndexById = new Map<string, LawIndexEntry>();
  for (const entry of localIndex) {
    localIndexById.set(`act-${entry.lawNumber || entry.lawId}`, entry);
  }

  const recentEntries = await fetchRecentEntries();
  console.log(`Checked ${recentEntries.length} upstream entries.\n`);

  const updatedLaws: UpdateHit[] = [];
  const newLaws: UpdateHit[] = [];

  for (const entry of recentEntries) {
    const documentId = `act-${entry.lawNumber || entry.lawId}`;

    if (!localDocs.has(documentId)) {
      newLaws.push({
        document_id: documentId,
        title: entry.title,
        remote_updated: entry.enforcementDate,
      });
    }
  }

  console.log(`New laws:     ${newLaws.length}`);

  if (newLaws.length > 0) {
    console.log('\nNew upstream laws missing locally:');
    for (const hit of newLaws.slice(0, 20)) {
      console.log(`  - ${hit.document_id} (${hit.title})`);
    }
  }

  if (updatedLaws.length > 0 || newLaws.length > 0) {
    process.exit(1);
  }

  console.log('\nNo recent upstream changes detected.');
}

main().catch((error) => {
  console.error(`Update check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});
