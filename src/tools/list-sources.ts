/**
 * list_sources — Returns metadata about data sources, coverage, and freshness.
 */

import type { Database } from '@ansvar/mcp-sqlite';
import { generateResponseMetadata, type ToolResponse } from '../utils/metadata.js';

export interface ListSourcesResult {
  jurisdiction: string;
  sources: Array<{
    name: string;
    authority: string;
    url: string;
    license: string;
    coverage: string;
    languages: string[];
  }>;
  database: {
    tier: string;
    schema_version: string;
    built_at: string;
    document_count: number;
    provision_count: number;
    eu_document_count: number;
  };
  limitations: string[];
}

function safeCount(db: Database, sql: string): number {
  try {
    const row = db.prepare(sql).get() as { count: number } | undefined;
    return row ? Number(row.count) : 0;
  } catch {
    return 0;
  }
}

function safeMetaValue(db: Database, key: string): string {
  try {
    const row = db.prepare('SELECT value FROM db_metadata WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function listSources(db: Database): Promise<ToolResponse<ListSourcesResult>> {
  const documentCount = safeCount(db, 'SELECT COUNT(*) as count FROM legal_documents');
  const provisionCount = safeCount(db, 'SELECT COUNT(*) as count FROM legal_provisions');
  const euDocumentCount = safeCount(db, 'SELECT COUNT(*) as count FROM eu_documents');

  return {
    results: {
      jurisdiction: 'Republic of Korea (KR)',
      sources: [
        {
          name: 'Korean Law Information Center (국가법령정보센터)',
          authority: 'Ministry of Government Legislation (법제처)',
          url: 'https://www.law.go.kr',
          license: 'Government Open Data (Korea Open Data Portal)',
          coverage: 'Korean statutes (법률), presidential decrees (대통령령), ministerial ordinances (부령). Scope: PIPA, Network Act, Credit Information Act, Electronic Government Act, Framework Act on Intelligent Informatization.',
          languages: ['ko'],
        },
        {
          name: 'KLRI English Law Translations (영문법령)',
          authority: 'Korea Legislation Research Institute (한국법제연구원)',
          url: 'https://elaw.klri.re.kr',
          license: 'Government Open Data (Reference Translations)',
          coverage: 'Official English translations of major Korean laws. Over 700 laws translated. Translations are reference-only and not legally binding.',
          languages: ['en', 'ko'],
        },
        {
          name: 'EUR-Lex',
          authority: 'Publications Office of the European Union',
          url: 'https://eur-lex.europa.eu',
          license: 'Commission Decision 2011/833/EU (reuse of EU documents)',
          coverage: 'EU directive and regulation references for cross-referencing Korean data protection law against GDPR.',
          languages: ['en'],
        },
      ],
      database: {
        tier: safeMetaValue(db, 'tier'),
        schema_version: safeMetaValue(db, 'schema_version'),
        built_at: safeMetaValue(db, 'built_at'),
        document_count: documentCount,
        provision_count: provisionCount,
        eu_document_count: euDocumentCount,
      },
      limitations: [
        `Covers ${documentCount.toLocaleString()} Korean statutes. Presidential decrees and ministerial ordinances require professional tier.`,
        'English translations from KLRI are reference-only and may lag behind Korean text amendments.',
        'Korean text is the sole legally binding version.',
        'EU cross-references focus on GDPR/PIPA alignment; indirect references may not be captured.',
        'South Korea does not have an EU GDPR adequacy decision as of 2026.',
        'Court decisions and local government ordinances are not included.',
        'Always verify against official law.go.kr publications when legal certainty is required.',
      ],
    },
    _metadata: generateResponseMetadata(db),
  };
}
