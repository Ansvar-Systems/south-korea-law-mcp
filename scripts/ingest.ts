#!/usr/bin/env tsx
/**
 * South Korea Law MCP — Ingestion Pipeline
 *
 * Two-phase ingestion of Korean legislation from open.law.go.kr:
 *   Phase 1 (Discovery): Fetch law list from API
 *   Phase 2 (Content): Fetch individual law XML, parse, and write seed JSON
 *
 * Usage:
 *   npm run ingest                    # Full ingestion
 *   npm run ingest -- --limit 20      # Test with 20 laws
 *   npm run ingest -- --skip-discovery # Reuse cached law index
 *
 * Requires KOREA_LAW_API_KEY environment variable (free registration at open.law.go.kr).
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fetchLawList, fetchLawDetail } from './lib/fetcher.js';
import { parseLawList, parseLawXml, type LawIndexEntry, type ParsedLaw } from './lib/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_DIR = path.resolve(__dirname, '../data/source');
const SEED_DIR = path.resolve(__dirname, '../data/seed');
const INDEX_PATH = path.join(SOURCE_DIR, 'law-index.json');

// Key laws to ingest for the free tier
const KEY_LAW_QUERIES = [
  '개인정보 보호법',           // PIPA
  '정보통신망',                // Network Act
  '신용정보',                  // Credit Information Act
  '전자정부법',                // Electronic Government Act
  '지능정보화 기본법',          // Framework Act on Intelligent Informatization
  '정보보호',                  // Information Protection
  '사이버',                    // Cyber-related
  '대한민국헌법',              // Constitution
];

// ─────────────────────────────────────────────────────────────────────────────
// CLI argument parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(): { limit: number | null; skipDiscovery: boolean } {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let skipDiscovery = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--skip-discovery') {
      skipDiscovery = true;
    }
  }

  return { limit, skipDiscovery };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Discovery — Build law index from API
// ─────────────────────────────────────────────────────────────────────────────

async function discoverLaws(): Promise<LawIndexEntry[]> {
  console.log('Phase 1: Discovering Korean laws from open.law.go.kr...\n');

  if (!process.env.KOREA_LAW_API_KEY) {
    console.log('  WARNING: KOREA_LAW_API_KEY not set. API responses may be limited.');
    console.log('  Register at https://open.law.go.kr for a free API key.\n');
  }

  const allEntries: LawIndexEntry[] = [];

  for (const query of KEY_LAW_QUERIES) {
    process.stdout.write(`  Searching for: ${query}...`);

    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const result = await fetchLawList(page, query);

      if (result.status !== 200) {
        console.log(` HTTP ${result.status} — skipping.`);
        break;
      }

      const listResult = parseLawList(result.body);
      allEntries.push(...listResult.entries);

      console.log(` ${listResult.entries.length} entries (total: ${listResult.totalCount})`);

      hasMore = listResult.hasNextPage;
      page++;

      if (page > 10) {
        console.log('    Hit page limit, moving to next query.');
        break;
      }
    }
  }

  // Deduplicate by lawId
  const seen = new Set<string>();
  const deduped: LawIndexEntry[] = [];
  for (const entry of allEntries) {
    if (!seen.has(entry.lawId) && entry.lawId) {
      seen.add(entry.lawId);
      deduped.push(entry);
    }
  }

  console.log(`\n  Discovered ${deduped.length} unique laws (from ${allEntries.length} entries)\n`);

  fs.mkdirSync(SOURCE_DIR, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(deduped, null, 2));
  console.log(`  Index saved to ${INDEX_PATH}\n`);

  return deduped;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Content — Fetch and parse each law
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAndParseLaws(laws: LawIndexEntry[], limit: number | null): Promise<void> {
  const toProcess = limit ? laws.slice(0, limit) : laws;
  console.log(`Phase 2: Fetching content for ${toProcess.length} laws...\n`);

  fs.mkdirSync(SEED_DIR, { recursive: true });

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let totalProvisions = 0;

  for (const law of toProcess) {
    const seedFile = path.join(SEED_DIR, `${law.lawId}.json`);

    // Incremental: skip if seed already exists
    if (fs.existsSync(seedFile)) {
      skipped++;
      processed++;
      if (processed % 50 === 0) {
        console.log(`  Progress: ${processed}/${toProcess.length} (${skipped} skipped, ${failed} failed)`);
      }
      continue;
    }

    try {
      const result = await fetchLawDetail(law.lawId);

      if (result.status !== 200) {
        if (result.status === 404) {
          const minimalSeed: ParsedLaw = {
            id: `act-${law.lawNumber || law.lawId}`,
            type: 'statute',
            title: law.title,
            title_en: '',
            short_name: '',
            law_number: law.lawNumber,
            status: 'in_force',
            issued_date: law.promulgationDate,
            in_force_date: law.enforcementDate,
            url: law.url,
            provisions: [],
          };
          fs.writeFileSync(seedFile, JSON.stringify(minimalSeed, null, 2));
          failed++;
        } else {
          console.log(`  ERROR: HTTP ${result.status} for ${law.lawId} (${law.title})`);
          failed++;
        }
      } else {
        const parsed = parseLawXml(result.body, law.lawId);
        fs.writeFileSync(seedFile, JSON.stringify(parsed, null, 2));
        totalProvisions += parsed.provisions.length;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`  ERROR parsing ${law.lawId} (${law.title}): ${msg}`);
      failed++;
    }

    processed++;
    if (processed % 50 === 0) {
      console.log(`  Progress: ${processed}/${toProcess.length} (${skipped} skipped, ${failed} failed, ${totalProvisions} provisions)`);
    }
  }

  console.log(`\nPhase 2 complete:`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Skipped (already cached): ${skipped}`);
  console.log(`  Failed/Not available: ${failed}`);
  console.log(`  Total provisions extracted: ${totalProvisions}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { limit, skipDiscovery } = parseArgs();

  console.log('South Korea Law MCP — Ingestion Pipeline');
  console.log('=========================================\n');

  if (limit) console.log(`  --limit ${limit}`);
  if (skipDiscovery) console.log(`  --skip-discovery`);
  console.log('');

  let laws: LawIndexEntry[];

  if (skipDiscovery && fs.existsSync(INDEX_PATH)) {
    console.log(`Using cached law index from ${INDEX_PATH}\n`);
    laws = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
    console.log(`  ${laws.length} laws in index\n`);
  } else {
    laws = await discoverLaws();
  }

  await fetchAndParseLaws(laws, limit);

  console.log('\nIngestion complete.');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
