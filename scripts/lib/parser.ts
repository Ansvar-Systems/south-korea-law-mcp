/**
 * XML parser for Korean legislation from law.go.kr API.
 *
 * Parses the XML format returned by the Korean Law Information Center API
 * into structured seed JSON. Uses fast-xml-parser.
 *
 * Korean law structure:
 *   편(pyeon/part) > 장(jang/chapter) > 절(jeol/section) > 관(gwan/subsection) >
 *   조(jo/article) > 항(hang/paragraph) > 호(ho/item) > 목(mok/sub-item)
 *
 * Article numbering:
 *   - Articles: 제N조 (e.g., 제1조, 제15조)
 *   - Bis articles: 제N조의M (e.g., 제15조의2)
 *   - Paragraphs: ①, ②, ③ (circled numbers)
 *   - Items: 1., 2., 3. (Arabic with period)
 */

import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => {
    return [
      '조문단위', '항', '호', '목',
      'entry', 'law', '법령',
    ].includes(name);
  },
  trimValues: true,
  parseAttributeValue: false,
});

// ─────────────────────────────────────────────────────────────────────────────
// Law List Parsing (from lawSearch API)
// ─────────────────────────────────────────────────────────────────────────────

export interface LawIndexEntry {
  title: string;
  lawId: string;
  lawNumber: string;
  promulgationDate: string;
  enforcementDate: string;
  lawType: string;
  url: string;
}

export interface LawListResult {
  entries: LawIndexEntry[];
  totalCount: number;
  hasNextPage: boolean;
}

/**
 * Parse a law list XML response from the law.go.kr API.
 */
export function parseLawList(xml: string): LawListResult {
  const parsed = parser.parse(xml);
  const root = parsed.LawSearch ?? parsed;

  const totalCount = parseInt(String(root.totalCnt ?? root.전체건수 ?? '0'), 10);
  const rawEntries = root.law ?? root.법령 ?? [];
  const entryList = Array.isArray(rawEntries) ? rawEntries : [rawEntries].filter(Boolean);

  const entries: LawIndexEntry[] = [];

  for (const entry of entryList) {
    if (!entry) continue;

    const title = extractText(entry['법령명한글'] ?? entry.lawNameKorean ?? entry['법령명']) ?? '';
    const lawId = extractText(entry['법령일련번호'] ?? entry.lawId ?? entry['MST'] ?? entry['법령ID']) ?? '';
    const lawNumber = extractText(entry['법령번호'] ?? entry.lawNumber ?? entry['공포번호']) ?? '';
    const promulgationDate = extractText(entry['공포일자'] ?? entry.promulgationDate) ?? '';
    const enforcementDate = extractText(entry['시행일자'] ?? entry.enforcementDate) ?? '';
    const lawType = extractText(entry['법령종류'] ?? entry.lawType ?? '') ?? 'statute';

    if (!title) continue;

    entries.push({
      title: title.replace(/\s+/g, ' ').trim(),
      lawId,
      lawNumber,
      promulgationDate,
      enforcementDate,
      lawType,
      url: `https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=${lawId}`,
    });
  }

  const pageSize = 100;
  const hasNextPage = entries.length >= pageSize && entries.length < totalCount;

  return { entries, totalCount, hasNextPage };
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual Law Parsing (from lawService API)
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedProvision {
  provision_ref: string;
  section: string;
  title: string;
  content: string;
}

export interface ParsedLaw {
  id: string;
  type: 'statute' | 'presidential_decree' | 'ministerial_ordinance';
  title: string;
  title_en: string;
  short_name: string;
  law_number: string;
  status: 'in_force' | 'amended' | 'repealed';
  issued_date: string;
  in_force_date: string;
  url: string;
  provisions: ParsedProvision[];
}

/**
 * Parse an individual law XML document from the law.go.kr API.
 */
export function parseLawXml(xml: string, lawId: string): ParsedLaw {
  const parsed = parser.parse(xml);

  const root = parsed['법령'] ?? parsed.law ?? parsed;

  const title = extractText(root['법령명_한글'] ?? root['법령명한글'] ?? root.lawNameKorean ?? root['법령명']) ?? '';
  const titleEn = extractText(root['법령명_영문'] ?? root['법령명영문'] ?? root.lawNameEnglish) ?? '';
  const lawNumber = extractText(root['법령번호'] ?? root.lawNumber ?? root['공포번호']) ?? '';
  const promulgationDate = extractText(root['공포일자'] ?? root.promulgationDate) ?? '';
  const enforcementDate = extractText(root['시행일자'] ?? root.enforcementDate) ?? '';
  const lawType = extractText(root['법령종류'] ?? root.lawType) ?? '';

  const type = inferDocumentType(lawType);
  const shortName = buildShortName(title);

  const provisions: ParsedProvision[] = [];

  // Parse articles (조문)
  const articles = root['조문'] ?? root['조문단위'] ?? root.articles ?? [];
  const articleList = Array.isArray(articles) ? articles : [articles].filter(Boolean);

  for (const article of articleList) {
    if (!article) continue;

    const articleNumber = extractText(article['조문번호'] ?? article.articleNumber) ?? '';
    const articleTitle = extractText(article['조문제목'] ?? article.articleTitle) ?? '';
    const articleContent = extractText(article['조문내용'] ?? article.articleContent) ?? '';

    if (!articleNumber && !articleContent) continue;

    const cleanNumber = articleNumber.replace(/[제조]/g, '').trim();
    const provisionRef = `art-${cleanNumber}`;

    let fullContent = articleContent;

    // Parse paragraphs (항)
    const paragraphs = article['항'] ?? [];
    const paraList = Array.isArray(paragraphs) ? paragraphs : [paragraphs].filter(Boolean);

    for (const para of paraList) {
      if (!para) continue;
      const paraContent = extractText(para['항내용'] ?? para.paragraphContent ?? para) ?? '';
      if (paraContent.trim()) {
        fullContent += '\n' + paraContent;
      }

      // Parse items (호)
      const items = para['호'] ?? [];
      const itemList = Array.isArray(items) ? items : [items].filter(Boolean);
      for (const item of itemList) {
        if (!item) continue;
        const itemContent = extractText(item['호내용'] ?? item.itemContent ?? item) ?? '';
        if (itemContent.trim()) {
          fullContent += '\n  ' + itemContent;
        }
      }
    }

    if (fullContent.trim()) {
      provisions.push({
        provision_ref: provisionRef,
        section: `제${cleanNumber}조`,
        title: articleTitle,
        content: fullContent.replace(/\s+/g, ' ').trim(),
      });
    }
  }

  return {
    id: `act-${lawNumber || lawId}`,
    type,
    title,
    title_en: titleEn,
    short_name: shortName,
    law_number: lawNumber,
    status: 'in_force',
    issued_date: formatDate(promulgationDate),
    in_force_date: formatDate(enforcementDate),
    url: `https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=${lawId}`,
    provisions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractText(node: unknown): string | undefined {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if ('#text' in obj) return String(obj['#text']);
    for (const key of Object.keys(obj)) {
      if (!key.startsWith('@_')) {
        const val = extractText(obj[key]);
        if (val) return val;
      }
    }
  }
  return undefined;
}

function inferDocumentType(lawType: string): 'statute' | 'presidential_decree' | 'ministerial_ordinance' {
  if (/대통령령/.test(lawType)) return 'presidential_decree';
  if (/부령|총리령/.test(lawType)) return 'ministerial_ordinance';
  return 'statute';
}

function buildShortName(title: string): string {
  // Common abbreviations for Korean laws
  const abbrevs: Record<string, string> = {
    '개인정보 보호법': 'PIPA',
    '정보통신망 이용촉진 및 정보보호 등에 관한 법률': 'Network Act',
    '신용정보의 이용 및 보호에 관한 법률': 'Credit Information Act',
    '전자정부법': 'E-Government Act',
    '지능정보화 기본법': 'Intelligent Informatization Act',
  };
  return abbrevs[title] ?? title.substring(0, 30).trim();
}

function formatDate(dateStr: string): string {
  if (!dateStr || dateStr.length < 8) return dateStr;
  // Korean dates are often YYYYMMDD
  const clean = dateStr.replace(/[^0-9]/g, '');
  if (clean.length === 8) {
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  }
  return dateStr;
}
