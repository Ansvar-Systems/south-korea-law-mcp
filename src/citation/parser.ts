/**
 * Korean legal citation parser.
 *
 * Parses citations in multiple formats:
 *   1. Korean: "제15조 개인정보 보호법"
 *   2. English: "Article 15, Personal Information Protection Act (Act No. 16930)"
 *   3. Short: "Art. 15, PIPA"
 *   4. ID-based: "act-16930, art. 15"
 *   5. With paragraph: "Article 15(1)" / "제15조제1항"
 */

import type { ParsedCitation } from '../types/index.js';

// Korean format: 제15조 개인정보 보호법
// With paragraph: 제15조제1항 개인정보 보호법
const KOREAN_CITATION = /^제(\d+)조(?:의(\d+))?(?:제(\d+)항)?(?:제(\d+)호)?\s+(.+)$/;

// English format: Article 15, Personal Information Protection Act (Act No. 16930)
const ENGLISH_CITATION = /^(?:Article|Art\.?)\s+(\d+)(?:\((\d+)\))?(?:\((\d+)\))?\s*,?\s+(.+?)(?:\s*\(Act\s+No\.\s*(\d+)\))?$/i;

// Short format: Art. 15, PIPA
const SHORT_CITATION = /^(?:Art\.?)\s+(\d+)(?:\((\d+)\))?\s*,?\s+(.+?)$/i;

// ID-based format: act-16930, art. 15
const ID_CITATION = /^(act-\d+)\s*,?\s*(?:art\.?|article)\s+(\d+)(?:\((\d+)\))?$/i;

// Trailing article format: 개인정보 보호법 제15조
const TRAILING_KOREAN = /^(.+?)\s+제(\d+)조(?:의(\d+))?(?:제(\d+)항)?(?:제(\d+)호)?$/;

/** Well-known short name mappings */
const SHORT_NAMES: Record<string, string> = {
  'pipa': '개인정보 보호법',
  'network act': '정보통신망 이용촉진 및 정보보호 등에 관한 법률',
  'credit information act': '신용정보의 이용 및 보호에 관한 법률',
  'electronic government act': '전자정부법',
  'intelligent informatization act': '지능정보화 기본법',
};

export function parseCitation(citation: string): ParsedCitation {
  const trimmed = citation.trim();

  // Korean format: 제15조 개인정보 보호법
  let match = trimmed.match(KOREAN_CITATION);
  if (match) {
    return {
      valid: true,
      type: 'statute',
      article: match[2] ? `${match[1]}-${match[2]}` : match[1],
      paragraph: match[3] || undefined,
      item: match[4] || undefined,
      title: match[5].trim(),
    };
  }

  // Trailing Korean format: 개인정보 보호법 제15조
  match = trimmed.match(TRAILING_KOREAN);
  if (match) {
    return {
      valid: true,
      type: 'statute',
      title: match[1].trim(),
      article: match[3] ? `${match[2]}-${match[3]}` : match[2],
      paragraph: match[4] || undefined,
      item: match[5] || undefined,
    };
  }

  // English format: Article 15, Personal Information Protection Act (Act No. 16930)
  match = trimmed.match(ENGLISH_CITATION);
  if (match) {
    return {
      valid: true,
      type: 'statute',
      article: match[1],
      paragraph: match[2] || undefined,
      item: match[3] || undefined,
      title_en: match[4].trim(),
      law_number: match[5] || undefined,
    };
  }

  // Short format: Art. 15, PIPA
  match = trimmed.match(SHORT_CITATION);
  if (match) {
    const shortName = match[3].trim().toLowerCase();
    const resolvedTitle = SHORT_NAMES[shortName];
    return {
      valid: true,
      type: 'statute',
      article: match[1],
      paragraph: match[2] || undefined,
      title: resolvedTitle,
      title_en: resolvedTitle ? undefined : match[3].trim(),
    };
  }

  // ID-based format: act-16930, art. 15
  match = trimmed.match(ID_CITATION);
  if (match) {
    return {
      valid: true,
      type: 'statute',
      title: match[1],
      article: match[2],
      paragraph: match[3] || undefined,
    };
  }

  return {
    valid: false,
    type: 'unknown',
    error: `Could not parse Korean legal citation: "${trimmed}"`,
  };
}
