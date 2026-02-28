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
      'entry', 'law',
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
    const lawType = extractText(entry['법령구분명'] ?? entry['법령종류'] ?? entry.lawType ?? '') ?? 'statute';

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
 *
 * XML structure:
 *   <법령 법령키="...">
 *     <기본정보>
 *       <법령명_한글>...</법령명_한글>
 *       <법종구분>법률</법종구분>
 *       ...
 *     </기본정보>
 *     <조문>
 *       <조문단위 조문키="...">
 *         <조문번호>1</조문번호>
 *         <조문여부>조문</조문여부>  (조문=article, 전문=section header)
 *         <조문제목>...</조문제목>
 *         <조문내용>...</조문내용>
 *         <항><항내용>...</항내용></항>
 *       </조문단위>
 *     </조문>
 *   </법령>
 */
export function parseLawXml(xml: string, lawId: string): ParsedLaw {
  const parsed = parser.parse(xml);

  const root = parsed['법령'] ?? parsed.law ?? parsed;

  // Metadata is nested under 기본정보
  const info = root['기본정보'] ?? root;

  const title = extractText(info['법령명_한글'] ?? info['법령명한글'] ?? root['법령명_한글'] ?? root['법령명']) ?? '';
  const titleEn = extractText(info['법령명_영문'] ?? info['법령명영문'] ?? root['법령명_영문']) ?? '';
  const lawNumber = extractText(info['공포번호'] ?? info['법령번호'] ?? root['공포번호']) ?? '';
  const promulgationDate = extractText(info['공포일자'] ?? root['공포일자']) ?? '';
  const enforcementDate = extractText(info['시행일자'] ?? root['시행일자']) ?? '';
  const lawTypeNode = info['법종구분'] ?? root['법종구분'] ?? {};
  const lawType = extractText(lawTypeNode) ?? '';

  const type = inferDocumentType(lawType);
  const shortName = buildShortName(title);

  const provisions: ParsedProvision[] = [];

  // Articles are nested under 조문 > 조문단위
  const joMun = root['조문'];
  const articleUnits = joMun?.['조문단위'] ?? root['조문단위'] ?? [];
  const articleList = Array.isArray(articleUnits) ? articleUnits : [articleUnits].filter(Boolean);

  for (const article of articleList) {
    if (!article) continue;

    // Skip section/chapter headers (전문) — only parse actual articles (조문)
    const articleType = extractText(article['조문여부']) ?? '';
    if (articleType === '전문') continue;

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

        // Parse sub-items (목)
        const subItems = item['목'] ?? [];
        const subList = Array.isArray(subItems) ? subItems : [subItems].filter(Boolean);
        for (const sub of subList) {
          if (!sub) continue;
          const subContent = extractText(sub['목내용'] ?? sub) ?? '';
          if (subContent.trim()) {
            fullContent += '\n    ' + subContent;
          }
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
    id: `act-${lawId}`,
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
