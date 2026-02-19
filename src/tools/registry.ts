/**
 * Tool registry for South Korea Law MCP Server.
 * Shared between stdio (index.ts) and HTTP (api/mcp.ts) entry points.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import Database from '@ansvar/mcp-sqlite';

import { searchLegislation, SearchLegislationInput } from './search-legislation.js';
import { getProvision, GetProvisionInput } from './get-provision.js';
import { listSources } from './list-sources.js';
import { validateCitationTool, ValidateCitationInput } from './validate-citation.js';
import { buildLegalStance, BuildLegalStanceInput } from './build-legal-stance.js';
import { formatCitationTool, FormatCitationInput } from './format-citation.js';
import { checkCurrency, CheckCurrencyInput } from './check-currency.js';
import { getEUBasis, GetEUBasisInput } from './get-eu-basis.js';
import { getKoreanImplementations, GetKoreanImplementationsInput } from './get-korean-implementations.js';
import { searchEUImplementations, SearchEUImplementationsInput } from './search-eu-implementations.js';
import { getProvisionEUBasis, GetProvisionEUBasisInput } from './get-provision-eu-basis.js';
import { validateEUCompliance, ValidateEUComplianceInput } from './validate-eu-compliance.js';
import { getAbout, type AboutContext } from './about.js';
export type { AboutContext } from './about.js';

const ABOUT_TOOL: Tool = {
  name: 'about',
  description:
    'Server metadata, dataset statistics, freshness, and provenance. ' +
    'Call this to verify data coverage, currency, and content basis before relying on results.',
  inputSchema: { type: 'object', properties: {} },
};

export const TOOLS: Tool[] = [
  {
    name: 'search_legislation',
    description:
      'Search South Korean statutes and regulations by keyword. Returns provision-level results with BM25 relevance ranking. ' +
      'Supports natural language queries in both Korean (e.g., "개인정보 보호") and English (e.g., "personal information protection"). ' +
      'Also supports FTS5 syntax (AND, OR, NOT, "phrase", prefix*). ' +
      'Results include: document ID, title (Korean + English), provision reference, snippet with >>>highlight<<< markers, and relevance score. ' +
      'Use document_id to filter within a single statute. Use status to filter by in_force/amended/repealed. ' +
      'Default limit is 10 (max 50). For broad legal research, prefer build_legal_stance instead.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query in Korean or English. Supports natural language or FTS5 syntax. Example: "개인정보" OR "personal data"',
        },
        document_id: {
          type: 'string',
          description: 'Filter to a specific statute by ID (e.g., "act-16930") or title (e.g., "개인정보 보호법")',
        },
        status: {
          type: 'string',
          enum: ['in_force', 'amended', 'repealed'],
          description: 'Filter by legislative status. Omit to search all statuses.',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 10, max: 50). Lower values save tokens.',
          default: 10,
          minimum: 1,
          maximum: 50,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_provision',
    description:
      'Retrieve the full text of a specific provision (article) from a Korean statute, or all provisions if no article is specified. ' +
      'Korean provisions use article notation: 제1조, 제15조. Pass law_identifier as either the internal ID (e.g., "act-16930"), ' +
      'the Korean title (e.g., "개인정보 보호법"), or the English title (e.g., "Personal Information Protection Act"). ' +
      'Returns: document ID, title (Korean + English), status, article number, chapter, full text (Korean + English where available), ' +
      'and citation URL to law.go.kr. ' +
      'Korean articles use 제N조 format. Paragraphs use ①②③ circled numbers. Items use 1. 2. 3. ' +
      'WARNING: Omitting article returns ALL provisions (capped at 200) for the statute.',
    inputSchema: {
      type: 'object',
      properties: {
        law_identifier: {
          type: 'string',
          description: 'Statute identifier: internal ID (e.g., "act-16930"), Korean title (e.g., "개인정보 보호법"), or English title (e.g., "Personal Information Protection Act"). Fuzzy title matching is supported.',
        },
        article: {
          type: 'string',
          description: 'Article number (e.g., "1", "15", "15-2"). Matched against provision_ref and section columns.',
        },
      },
      required: ['law_identifier'],
    },
  },
  {
    name: 'list_sources',
    description:
      'Returns metadata about all data sources backing this server, including jurisdiction, authoritative source details, ' +
      'database tier, schema version, build date, record counts, and known limitations. ' +
      'Call this first to understand data coverage and freshness before relying on other tools.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'validate_citation',
    description:
      'Validate a Korean legal citation against the database. Returns whether the cited statute and provision exist. ' +
      'Use this as a zero-hallucination check before presenting legal references to users. ' +
      'Supported formats: "제15조 개인정보 보호법", "Article 15, Personal Information Protection Act", "Art. 15, PIPA", "act-16930, art. 15". ' +
      'Returns: valid (boolean), parsed components, formatted citations (Korean + English), warnings about repealed/amended status.',
    inputSchema: {
      type: 'object',
      properties: {
        citation: {
          type: 'string',
          description: 'Korean legal citation to validate. Examples: "제15조 개인정보 보호법", "Article 15, Personal Information Protection Act (Act No. 16930)"',
        },
      },
      required: ['citation'],
    },
  },
  {
    name: 'build_legal_stance',
    description:
      'Build a comprehensive set of citations for a legal question by searching across all Korean statutes simultaneously. ' +
      'Returns aggregated results from legislation search, cross-referenced with EU law where applicable. ' +
      'Best for broad legal research questions like "What Korean laws govern personal data processing?" ' +
      'Supports queries in both Korean and English. ' +
      'For targeted lookups of a known provision, use get_provision instead.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Legal question or topic to research in Korean or English (e.g., "개인정보 처리 의무" or "personal data processing obligations")',
        },
        document_id: {
          type: 'string',
          description: 'Optionally limit search to one statute by ID or title',
        },
        limit: {
          type: 'number',
          description: 'Max results per category (default: 5, max: 20)',
          default: 5,
          minimum: 1,
          maximum: 20,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'format_citation',
    description:
      'Format a Korean legal citation per standard legal conventions. ' +
      'Formats: "korean" -> "제15조 개인정보 보호법", "full" -> "Article 15, Personal Information Protection Act", ' +
      '"short" -> "Art. 15, PIPA", "pinpoint" -> "제15조제1항". ' +
      'Does NOT validate existence -- use validate_citation for that.',
    inputSchema: {
      type: 'object',
      properties: {
        citation: {
          type: 'string',
          description: 'Citation string to format (e.g., "제15조 개인정보 보호법" or "Article 15, PIPA")',
        },
        format: {
          type: 'string',
          enum: ['korean', 'full', 'short', 'pinpoint'],
          description: 'Output format. "korean" (default): 제N조 format. "full": formal English. "short": abbreviated. "pinpoint": article reference only.',
          default: 'korean',
        },
      },
      required: ['citation'],
    },
  },
  {
    name: 'check_currency',
    description:
      'Check whether a Korean statute or provision is currently in force, amended, or repealed. ' +
      'Returns: is_current (boolean), status, dates (issued, in-force), law number, and warnings. ' +
      'Essential before citing legislation -- repealed acts should not be cited as current law.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: {
          type: 'string',
          description: 'Statute identifier (e.g., "act-16930") or title (e.g., "개인정보 보호법" or "Personal Information Protection Act")',
        },
        provision_ref: {
          type: 'string',
          description: 'Optional provision reference to check a specific article (e.g., "15")',
        },
      },
      required: ['document_id'],
    },
  },
  {
    name: 'get_eu_basis',
    description:
      'Get EU legal basis (directives and regulations) for a Korean statute. Returns all EU instruments that the Korean statute ' +
      'references or has conceptual alignment with, particularly GDPR alignment for PIPA. ' +
      'South Korea does not have an EU adequacy decision, but PIPA is substantially aligned with GDPR. ' +
      'Example: PIPA -> references GDPR (Regulation 2016/679).',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: {
          type: 'string',
          description: 'Korean statute identifier (e.g., "act-16930") or title (e.g., "개인정보 보호법")',
        },
        include_articles: {
          type: 'boolean',
          description: 'Include specific EU article references in the response (default: false)',
          default: false,
        },
        reference_types: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['implements', 'supplements', 'applies', 'references', 'complies_with', 'derogates_from', 'amended_by', 'repealed_by', 'cites_article'],
          },
          description: 'Filter by reference type (e.g., ["references"]). Omit to return all types.',
        },
      },
      required: ['document_id'],
    },
  },
  {
    name: 'get_korean_implementations',
    description:
      'Find Korean statutes that implement or reference a specific EU directive or regulation. ' +
      'Input the EU document ID in "type:year/number" format (e.g., "regulation:2016/679" for GDPR). ' +
      'Returns matching Korean statutes with implementation status.',
    inputSchema: {
      type: 'object',
      properties: {
        eu_document_id: {
          type: 'string',
          description: 'EU document ID in format "type:year/number" (e.g., "regulation:2016/679" for GDPR)',
        },
        primary_only: {
          type: 'boolean',
          description: 'Return only primary implementing statutes (default: false)',
          default: false,
        },
        in_force_only: {
          type: 'boolean',
          description: 'Return only statutes currently in force (default: false)',
          default: false,
        },
      },
      required: ['eu_document_id'],
    },
  },
  {
    name: 'search_eu_implementations',
    description:
      'Search for EU directives and regulations that have been referenced by Korean statutes. ' +
      'Search by keyword (e.g., "data protection", "privacy"), filter by type (directive/regulation), ' +
      'or year range. Returns EU documents with counts of Korean statutes referencing them.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keyword search across EU document titles and short names (e.g., "data protection")',
        },
        type: {
          type: 'string',
          enum: ['directive', 'regulation'],
          description: 'Filter by EU document type',
        },
        year_from: { type: 'number', description: 'Filter: EU documents from this year onwards' },
        year_to: { type: 'number', description: 'Filter: EU documents up to this year' },
        has_korean_implementation: {
          type: 'boolean',
          description: 'If true, only return EU documents that have at least one Korean referencing statute',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20, max: 100)',
          default: 20,
          minimum: 1,
          maximum: 100,
        },
      },
    },
  },
  {
    name: 'get_provision_eu_basis',
    description:
      'Get EU legal basis for a specific provision within a Korean statute, with article-level precision. ' +
      'Example: PIPA Article 15 -> references GDPR Article 6 (lawful processing). ' +
      'Use this for pinpoint EU compliance checks at the provision level. ' +
      'If no provision_ref is provided, returns all EU references for the statute.',
    inputSchema: {
      type: 'object',
      properties: {
        law_identifier: {
          type: 'string',
          description: 'Korean statute identifier (e.g., "act-16930") or title (e.g., "개인정보 보호법")',
        },
        provision_ref: {
          type: 'string',
          description: 'Provision reference / article number (e.g., "15", "art-15")',
        },
      },
      required: ['law_identifier'],
    },
  },
  {
    name: 'validate_eu_compliance',
    description:
      'Check EU compliance status for a Korean statute or provision. Detects references to EU directives/regulations ' +
      'and reports alignment status. Note: South Korea does not have an EU GDPR adequacy decision. ' +
      'Returns compliance status: compliant, partial, unclear, or not_applicable.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: {
          type: 'string',
          description: 'Korean statute identifier (e.g., "act-16930") or title (e.g., "개인정보 보호법")',
        },
        provision_ref: {
          type: 'string',
          description: 'Optional: check a specific provision (e.g., "15")',
        },
        eu_document_id: {
          type: 'string',
          description: 'Optional: check compliance with a specific EU document (e.g., "regulation:2016/679")',
        },
      },
      required: ['document_id'],
    },
  },
];

export function buildTools(context?: AboutContext): Tool[] {
  return context ? [...TOOLS, ABOUT_TOOL] : TOOLS;
}

export function registerTools(
  server: Server,
  db: InstanceType<typeof Database>,
  context?: AboutContext,
): void {
  const allTools = buildTools(context);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: allTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: unknown;

      switch (name) {
        case 'search_legislation':
          result = await searchLegislation(db, args as unknown as SearchLegislationInput);
          break;
        case 'get_provision':
          result = await getProvision(db, args as unknown as GetProvisionInput);
          break;
        case 'list_sources':
          result = await listSources(db);
          break;
        case 'validate_citation':
          result = await validateCitationTool(db, args as unknown as ValidateCitationInput);
          break;
        case 'build_legal_stance':
          result = await buildLegalStance(db, args as unknown as BuildLegalStanceInput);
          break;
        case 'format_citation':
          result = await formatCitationTool(args as unknown as FormatCitationInput);
          break;
        case 'check_currency':
          result = await checkCurrency(db, args as unknown as CheckCurrencyInput);
          break;
        case 'get_eu_basis':
          result = await getEUBasis(db, args as unknown as GetEUBasisInput);
          break;
        case 'get_korean_implementations':
          result = await getKoreanImplementations(db, args as unknown as GetKoreanImplementationsInput);
          break;
        case 'search_eu_implementations':
          result = await searchEUImplementations(db, args as unknown as SearchEUImplementationsInput);
          break;
        case 'get_provision_eu_basis':
          result = await getProvisionEUBasis(db, args as unknown as GetProvisionEUBasisInput);
          break;
        case 'validate_eu_compliance':
          result = await validateEUCompliance(db, args as unknown as ValidateEUComplianceInput);
          break;
        case 'about':
          if (context) {
            result = getAbout(db, context);
          } else {
            return {
              content: [{ type: 'text', text: 'About tool not configured.' }],
              isError: true,
            };
          }
          break;
        default:
          return {
            content: [{ type: 'text', text: `Error: Unknown tool "${name}".` }],
            isError: true,
          };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });
}
