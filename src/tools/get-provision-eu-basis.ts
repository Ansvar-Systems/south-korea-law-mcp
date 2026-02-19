/**
 * get_provision_eu_basis — Get EU legal basis for a specific Korean provision.
 */

import type { Database } from '@ansvar/mcp-sqlite';
import type { ProvisionEUReference } from '../types/index.js';
import { generateResponseMetadata, type ToolResponse } from '../utils/metadata.js';
import { resolveExistingStatuteId } from '../utils/statute-id.js';

export interface GetProvisionEUBasisInput {
  law_identifier: string;
  provision_ref?: string;
}

export interface GetProvisionEUBasisResult {
  document_id: string;
  document_title: string;
  provision_ref?: string;
  provision_content?: string;
  eu_references: ProvisionEUReference[];
}

export async function getProvisionEUBasis(
  db: Database,
  input: GetProvisionEUBasisInput
): Promise<ToolResponse<GetProvisionEUBasisResult>> {
  if (!input.law_identifier) {
    throw new Error('law_identifier is required');
  }

  const resolvedId = resolveExistingStatuteId(db, input.law_identifier);
  if (!resolvedId) {
    throw new Error(`Document "${input.law_identifier}" not found in database`);
  }

  const doc = db.prepare(
    'SELECT id, title FROM legal_documents WHERE id = ?'
  ).get(resolvedId) as { id: string; title: string };

  // If no provision_ref specified, get all EU references for this document
  if (!input.provision_ref?.trim()) {
    const sql = `
      SELECT ed.id, ed.type, ed.title, ed.short_name, er.eu_article,
             er.reference_type, er.full_citation, er.reference_context
      FROM eu_documents ed
      JOIN eu_references er ON ed.id = er.eu_document_id
      WHERE er.document_id = ?
      ORDER BY ed.year DESC
    `;

    interface Row {
      id: string; type: 'directive' | 'regulation'; title: string | null;
      short_name: string | null; eu_article: string | null;
      reference_type: string; full_citation: string | null; reference_context: string | null;
    }

    const rows = db.prepare(sql).all(resolvedId) as Row[];

    return {
      results: {
        document_id: resolvedId,
        document_title: doc.title,
        eu_references: rows.map(r => mapEuRef(r)),
      },
      _metadata: generateResponseMetadata(db),
    };
  }

  // Look up specific provision
  const articleRef = `art-${input.provision_ref}`;
  const koreanRef = `제${input.provision_ref}조`;

  const provision = db.prepare(
    'SELECT id, content FROM legal_provisions WHERE document_id = ? AND (provision_ref = ? OR provision_ref = ? OR section = ? OR section = ?) LIMIT 1'
  ).get(resolvedId, input.provision_ref, articleRef, input.provision_ref, koreanRef) as { id: number; content: string } | undefined;

  if (!provision) {
    throw new Error(`Provision ${input.provision_ref} not found in ${input.law_identifier}`);
  }

  const sql = `
    SELECT ed.id, ed.type, ed.title, ed.short_name, er.eu_article,
           er.reference_type, er.full_citation, er.reference_context
    FROM eu_documents ed
    JOIN eu_references er ON ed.id = er.eu_document_id
    WHERE er.provision_id = ?
    ORDER BY ed.year DESC
  `;

  interface Row {
    id: string; type: 'directive' | 'regulation'; title: string | null;
    short_name: string | null; eu_article: string | null;
    reference_type: string; full_citation: string | null; reference_context: string | null;
  }

  const rows = db.prepare(sql).all(provision.id) as Row[];

  return {
    results: {
      document_id: resolvedId,
      document_title: doc.title,
      provision_ref: input.provision_ref,
      provision_content: provision.content,
      eu_references: rows.map(r => mapEuRef(r)),
    },
    _metadata: generateResponseMetadata(db),
  };
}

interface RefRow {
  id: string; type: 'directive' | 'regulation'; title: string | null;
  short_name: string | null; eu_article: string | null;
  reference_type: string; full_citation: string | null; reference_context: string | null;
}

function mapEuRef(r: RefRow): ProvisionEUReference {
  const ref: ProvisionEUReference = {
    id: r.id, type: r.type,
    reference_type: r.reference_type as any,
    full_citation: r.full_citation || r.id,
  };
  if (r.title) ref.title = r.title;
  if (r.short_name) ref.short_name = r.short_name;
  if (r.eu_article) ref.article = r.eu_article;
  if (r.reference_context) ref.context = r.reference_context;
  return ref;
}
