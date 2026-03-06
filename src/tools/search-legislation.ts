/**
 * search_legislation — Full-text search across South Korean statute provisions.
 * Supports both Korean and English queries.
 */

import type { Database } from '@ansvar/mcp-sqlite';
import { buildFtsQueryVariants, buildLikePattern, sanitizeFtsInput } from '../utils/fts-query.js';
import { normalizeAsOfDate } from '../utils/as-of-date.js';
import { generateResponseMetadata, type ToolResponse } from '../utils/metadata.js';

export interface SearchLegislationInput {
  query: string;
  document_id?: string;
  status?: string;
  as_of_date?: string;
  limit?: number;
}

export interface SearchLegislationResult {
  document_id: string;
  document_title: string;
  document_title_en: string | null;
  provision_ref: string;
  chapter: string | null;
  section: string;
  title: string | null;
  snippet: string;
  relevance: number;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function searchLegislation(
  db: Database,
  input: SearchLegislationInput
): Promise<ToolResponse<SearchLegislationResult[]>> {
  if (!input.query || input.query.trim().length === 0) {
    return {
      results: [],
      _metadata: generateResponseMetadata(db)
    };
  }

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  // Fetch extra rows to account for deduplication
  const fetchLimit = limit * 2;
  const queryVariants = buildFtsQueryVariants(sanitizeFtsInput(input.query));
  if (input.as_of_date) normalizeAsOfDate(input.as_of_date);

  let queryStrategy = 'none';
  for (const ftsQuery of queryVariants) {
    let sql = `
      SELECT
        lp.document_id,
        ld.title as document_title,
        ld.title_en as document_title_en,
        lp.provision_ref,
        lp.chapter,
        lp.section,
        lp.title,
        snippet(provisions_fts, 0, '>>>', '<<<', '...', 32) as snippet,
        bm25(provisions_fts) as relevance
      FROM provisions_fts
      JOIN legal_provisions lp ON lp.id = provisions_fts.rowid
      JOIN legal_documents ld ON ld.id = lp.document_id
      WHERE provisions_fts MATCH ?
    `;
    const params: (string | number)[] = [ftsQuery];

    if (input.document_id) {
      sql += ' AND lp.document_id = ?';
      params.push(input.document_id);
    }

    if (input.status) {
      sql += ' AND ld.status = ?';
      params.push(input.status);
    }

    sql += ' ORDER BY relevance LIMIT ?';
    params.push(fetchLimit);

    try {
      const rows = db.prepare(sql).all(...params) as SearchLegislationResult[];
      if (rows.length > 0) {
        queryStrategy = ftsQuery === queryVariants[0] ? 'exact' : 'fallback';
        const deduped = deduplicateResults(rows, limit);
        return {
          results: deduped,
          _metadata: {
            ...generateResponseMetadata(db),
            ...(queryStrategy === 'fallback' ? { query_strategy: 'broadened' } : {}),
          },
        };
      }
    } catch {
      // FTS query syntax error — try next variant
      continue;
    }
  }

  // LIKE fallback — final tier when all FTS5 variants return no results
  {
    const likePattern = buildLikePattern(sanitizeFtsInput(input.query));
    let likeSql = `
      SELECT
        lp.document_id,
        ld.title as document_title,
        ld.title_en as document_title_en,
        lp.provision_ref,
        lp.chapter,
        lp.section,
        lp.title,
        substr(lp.content, 1, 200) as snippet,
        0 as relevance
      FROM legal_provisions lp
      JOIN legal_documents ld ON ld.id = lp.document_id
      WHERE lp.content LIKE ? COLLATE NOCASE
    `;
    const likeParams: (string | number)[] = [likePattern];

    if (input.document_id) {
      likeSql += ' AND lp.document_id = ?';
      likeParams.push(input.document_id);
    }

    if (input.status) {
      likeSql += ' AND ld.status = ?';
      likeParams.push(input.status);
    }

    likeSql += ' LIMIT ?';
    likeParams.push(fetchLimit);

    try {
      const rows = db.prepare(likeSql).all(...likeParams) as SearchLegislationResult[];
      if (rows.length > 0) {
        return {
          results: deduplicateResults(rows, limit),
          _metadata: {
            ...generateResponseMetadata(db),
            query_strategy: 'like_fallback',
          },
        };
      }
    } catch {
      // LIKE query failed — fall through to empty return
    }
  }

  return { results: [], _metadata: generateResponseMetadata(db) };
}

/**
 * Deduplicate search results by document_title + provision_ref.
 * Keeps the first (highest-ranked) occurrence.
 */
function deduplicateResults(
  rows: SearchLegislationResult[],
  limit: number,
): SearchLegislationResult[] {
  const seen = new Set<string>();
  const deduped: SearchLegislationResult[] = [];
  for (const row of rows) {
    const key = `${row.document_title}::${row.provision_ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
    if (deduped.length >= limit) break;
  }
  return deduped;
}
