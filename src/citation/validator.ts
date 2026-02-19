/**
 * Korean legal citation validator.
 *
 * Validates a citation string against the database to ensure the document
 * and provision actually exist (zero-hallucination enforcement).
 */

import type { Database } from '@ansvar/mcp-sqlite';
import type { ValidationResult } from '../types/index.js';
import { parseCitation } from './parser.js';

export function validateCitation(db: Database, citation: string): ValidationResult {
  const parsed = parseCitation(citation);
  const warnings: string[] = [];

  if (!parsed.valid) {
    return {
      citation: parsed,
      document_exists: false,
      provision_exists: false,
      warnings: [parsed.error ?? 'Invalid citation format'],
    };
  }

  // Look up document by title match (Korean or English)
  const searchTerm = parsed.title ?? parsed.title_en ?? '';
  const doc = db.prepare(
    "SELECT id, title, title_en, status FROM legal_documents WHERE title LIKE ? OR title_en LIKE ? LIMIT 1"
  ).get(`%${searchTerm}%`, `%${searchTerm}%`) as { id: string; title: string; title_en: string | null; status: string } | undefined;

  if (!doc) {
    return {
      citation: parsed,
      document_exists: false,
      provision_exists: false,
      warnings: [`Document "${searchTerm}" not found in database`],
    };
  }

  if (doc.status === 'repealed') {
    warnings.push('This statute has been repealed');
  }

  // Check provision existence
  let provisionExists = false;
  if (parsed.article) {
    const articleRef = `art-${parsed.article}`;
    const koreanRef = `제${parsed.article}조`;

    const prov = db.prepare(
      `SELECT 1 FROM legal_provisions
       WHERE document_id = ?
         AND (provision_ref = ? OR provision_ref = ? OR section = ? OR section = ?)
       LIMIT 1`
    ).get(doc.id, articleRef, koreanRef, parsed.article, koreanRef);
    provisionExists = !!prov;

    if (!provisionExists) {
      warnings.push(`Article ${parsed.article} (제${parsed.article}조) not found in ${doc.title}`);
    }
  }

  return {
    citation: parsed,
    document_exists: true,
    provision_exists: provisionExists,
    document_title: doc.title,
    status: doc.status,
    warnings,
  };
}
