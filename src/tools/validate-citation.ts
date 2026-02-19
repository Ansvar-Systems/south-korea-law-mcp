/**
 * validate_citation — Validate a Korean legal citation against the database.
 */

import type { Database } from '@ansvar/mcp-sqlite';
import { validateCitation as doValidate } from '../citation/validator.js';
import { formatCitation } from '../citation/formatter.js';
import type { ValidationResult } from '../types/index.js';
import { generateResponseMetadata, type ToolResponse } from '../utils/metadata.js';

export interface ValidateCitationInput {
  citation: string;
}

export interface ValidateCitationResult {
  citation: string;
  formatted_citation_korean: string;
  formatted_citation_english: string;
  valid: boolean;
  document_exists: boolean;
  provision_exists: boolean;
  document_title?: string;
  status?: string;
  warnings: string[];
}

export async function validateCitationTool(
  db: Database,
  input: ValidateCitationInput
): Promise<ToolResponse<ValidateCitationResult>> {
  if (!input.citation || input.citation.trim().length === 0) {
    return {
      results: {
        citation: input.citation,
        formatted_citation_korean: '',
        formatted_citation_english: '',
        valid: false,
        document_exists: false,
        provision_exists: false,
        warnings: ['Empty citation'],
      },
      _metadata: generateResponseMetadata(db)
    };
  }

  const result: ValidationResult = doValidate(db, input.citation);
  const formattedKorean = formatCitation(result.citation, 'korean');
  const formattedEnglish = formatCitation(result.citation, 'full');

  return {
    results: {
      citation: input.citation,
      formatted_citation_korean: formattedKorean,
      formatted_citation_english: formattedEnglish,
      valid: result.citation.valid && result.document_exists && result.provision_exists,
      document_exists: result.document_exists,
      provision_exists: result.provision_exists,
      document_title: result.document_title,
      status: result.status,
      warnings: result.warnings,
    },
    _metadata: generateResponseMetadata(db)
  };
}
