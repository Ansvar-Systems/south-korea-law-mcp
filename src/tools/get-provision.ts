/**
 * get_provision — Retrieve a specific provision from a Korean statute.
 */

import type { Database } from '@ansvar/mcp-sqlite';
import { resolveExistingStatuteId } from '../utils/statute-id.js';
import { generateResponseMetadata, type ToolResponse } from '../utils/metadata.js';

export interface GetProvisionInput {
  law_identifier: string;
  article?: string;
  paragraph?: string;
}

export interface ProvisionResult {
  document_id: string;
  document_title: string;
  document_title_en: string | null;
  document_status: string;
  law_name: string;
  provision_ref: string;
  article_number: string;
  chapter: string | null;
  section: string;
  title: string | null;
  text: string;
  text_en: string | null;
  citation_url: string;
}

interface ProvisionRow {
  document_id: string;
  document_title: string;
  document_title_en: string | null;
  document_status: string;
  provision_ref: string;
  chapter: string | null;
  section: string;
  title: string | null;
  content: string;
  content_en: string | null;
  url: string | null;
}

/** Safety cap when returning all provisions for a statute */
const MAX_ALL_PROVISIONS = 200;

export async function getProvision(
  db: Database,
  input: GetProvisionInput
): Promise<ToolResponse<ProvisionResult | ProvisionResult[] | { provisions: ProvisionResult[]; truncated: boolean; total: number } | null>> {
  if (!input.law_identifier) {
    throw new Error('law_identifier is required');
  }

  const resolvedDocumentId = resolveExistingStatuteId(db, input.law_identifier) ?? input.law_identifier;

  const article = input.article;

  // If no specific article, return all provisions for the document (with safety cap)
  if (!article) {
    const countRow = db.prepare(
      'SELECT COUNT(*) as count FROM legal_provisions WHERE document_id = ?'
    ).get(resolvedDocumentId) as { count: number } | undefined;
    const total = countRow?.count ?? 0;

    const rows = db.prepare(`
      SELECT
        lp.document_id,
        ld.title as document_title,
        ld.title_en as document_title_en,
        ld.status as document_status,
        lp.provision_ref,
        lp.chapter,
        lp.section,
        lp.title,
        lp.content,
        lp.content_en,
        ld.url
      FROM legal_provisions lp
      JOIN legal_documents ld ON ld.id = lp.document_id
      WHERE lp.document_id = ?
      ORDER BY lp.id
      LIMIT ?
    `).all(resolvedDocumentId, MAX_ALL_PROVISIONS) as ProvisionRow[];

    const mapped = rows.map(r => mapRow(r));

    if (total > MAX_ALL_PROVISIONS) {
      return {
        results: { provisions: mapped, truncated: true, total },
        _metadata: generateResponseMetadata(db),
      };
    }

    return { results: mapped, _metadata: generateResponseMetadata(db) };
  }

  // Build article reference variants
  const articleRef = `art-${article}`;
  const koreanRef = `제${article}조`;

  const rows = db.prepare(`
    SELECT
      lp.document_id,
      ld.title as document_title,
      ld.title_en as document_title_en,
      ld.status as document_status,
      lp.provision_ref,
      lp.chapter,
      lp.section,
      lp.title,
      lp.content,
      lp.content_en,
      ld.url
    FROM legal_provisions lp
    JOIN legal_documents ld ON ld.id = lp.document_id
    WHERE lp.document_id = ?
      AND (lp.provision_ref = ? OR lp.provision_ref = ? OR lp.section = ? OR lp.section = ?)
  `).all(resolvedDocumentId, articleRef, koreanRef, article, koreanRef) as ProvisionRow[];

  if (rows.length === 0) {
    return { results: null, _metadata: generateResponseMetadata(db) };
  }

  if (rows.length === 1) {
    return { results: mapRow(rows[0]), _metadata: generateResponseMetadata(db) };
  }

  return { results: rows.map(r => mapRow(r)), _metadata: generateResponseMetadata(db) };
}

function mapRow(row: ProvisionRow): ProvisionResult {
  const articleMatch = row.provision_ref.match(/art-(\d+(?:-\d+)?)/);
  const koreanMatch = row.provision_ref.match(/제(\d+(?:의\d+)?)조/);
  const articleNumber = articleMatch?.[1] ?? koreanMatch?.[1] ?? row.section;

  const baseUrl = row.url ?? 'https://www.law.go.kr';
  const citationUrl = baseUrl.startsWith('http') ? baseUrl : `https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=${baseUrl}`;

  return {
    document_id: row.document_id,
    document_title: row.document_title,
    document_title_en: row.document_title_en,
    document_status: row.document_status,
    law_name: row.document_title,
    provision_ref: row.provision_ref,
    article_number: articleNumber,
    chapter: row.chapter,
    section: row.section,
    title: row.title,
    text: row.content,
    text_en: row.content_en,
    citation_url: citationUrl,
  };
}
