/**
 * Korean statute identifier handling.
 *
 * Korean statutes are identified by law number (e.g., act-16930) or
 * by their Korean title (e.g., 개인정보 보호법).
 */

import type { Database } from '@ansvar/mcp-sqlite';

export function isValidStatuteId(id: string): boolean {
  return id.length > 0 && id.trim().length > 0;
}

/**
 * Resolve a statute identifier to an existing document ID in the database.
 * Tries exact match first, then LIKE match on Korean title, then English title.
 */
export function resolveExistingStatuteId(
  db: Database,
  inputId: string,
): string | null {
  // Try exact match first
  const exact = db.prepare(
    "SELECT id FROM legal_documents WHERE id = ? LIMIT 1"
  ).get(inputId) as { id: string } | undefined;

  if (exact) return exact.id;

  // Try LIKE match on title (Korean)
  const byTitle = db.prepare(
    "SELECT id FROM legal_documents WHERE title LIKE ? LIMIT 1"
  ).get(`%${inputId}%`) as { id: string } | undefined;

  if (byTitle) return byTitle.id;

  // Try LIKE match on English title
  const byTitleEn = db.prepare(
    "SELECT id FROM legal_documents WHERE title_en LIKE ? LIMIT 1"
  ).get(`%${inputId}%`) as { id: string } | undefined;

  if (byTitleEn) return byTitleEn.id;

  // Try match on law_number
  const byLawNumber = db.prepare(
    "SELECT id FROM legal_documents WHERE law_number = ? LIMIT 1"
  ).get(inputId) as { id: string } | undefined;

  return byLawNumber?.id ?? null;
}
