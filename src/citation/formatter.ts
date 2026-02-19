/**
 * Korean legal citation formatter.
 *
 * Formats:
 *   korean:   "제15조 개인정보 보호법"
 *   full:     "Article 15, Personal Information Protection Act"
 *   short:    "Art. 15, PIPA"
 *   pinpoint: "제15조제1항"
 */

import type { ParsedCitation, CitationFormat } from '../types/index.js';

export function formatCitation(
  parsed: ParsedCitation,
  format: CitationFormat = 'full'
): string {
  if (!parsed.valid || !parsed.article) {
    return '';
  }

  const pinpoint = buildKoreanPinpoint(parsed);

  switch (format) {
    case 'korean':
      return `${pinpoint} ${parsed.title ?? parsed.title_en ?? ''}`.trim();

    case 'full': {
      const englishPinpoint = buildEnglishPinpoint(parsed);
      const title = parsed.title_en ?? parsed.title ?? '';
      const lawNum = parsed.law_number ? ` (Act No. ${parsed.law_number})` : '';
      return `Article ${englishPinpoint}, ${title}${lawNum}`.trim();
    }

    case 'short': {
      const englishPinpoint = buildEnglishPinpoint(parsed);
      const title = parsed.title_en ?? parsed.title ?? '';
      return `Art. ${englishPinpoint}, ${title}`.trim();
    }

    case 'pinpoint':
      return pinpoint;

    default:
      return `${pinpoint} ${parsed.title ?? parsed.title_en ?? ''}`.trim();
  }
}

function buildKoreanPinpoint(parsed: ParsedCitation): string {
  let ref = `제${parsed.article}조`;
  if (parsed.paragraph) {
    ref += `제${parsed.paragraph}항`;
  }
  if (parsed.item) {
    ref += `제${parsed.item}호`;
  }
  return ref;
}

function buildEnglishPinpoint(parsed: ParsedCitation): string {
  let ref = parsed.article ?? '';
  if (parsed.paragraph) {
    ref += `(${parsed.paragraph})`;
  }
  if (parsed.item) {
    ref += `(${parsed.item})`;
  }
  return ref;
}
