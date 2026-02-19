# South Korea Law MCP

[![npm version](https://img.shields.io/npm/v/@ansvar/south-korea-law-mcp)](https://www.npmjs.com/package/@ansvar/south-korea-law-mcp)
[![CI](https://github.com/Ansvar-Systems/south-korea-law-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Ansvar-Systems/south-korea-law-mcp/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Ansvar-Systems/south-korea-law-mcp/badge)](https://securityscorecards.dev/viewer/?uri=github.com/Ansvar-Systems/south-korea-law-mcp)

An MCP (Model Context Protocol) server providing full-text search and article-level retrieval of South Korean legislation. Covers the Personal Information Protection Act (PIPA, 2011, amended 2023), Network Act (Act on Promotion of ICT Network Utilization and Information Protection), Credit Information Act (amended 2020 with MyData), Electronic Government Act, Framework Act on Intelligent Informatization, and IT Network Act. All data is sourced from the official Korean Law Information Center (law.go.kr) maintained by the Ministry of Government Legislation, with English translations from the Korea Legislation Research Institute (elaw.klri.re.kr).

## Data Sources

| Source | Authority | Method | Update Frequency | License | Coverage |
|--------|-----------|--------|-----------------|---------|----------|
| [Korean Law Information Center](https://www.law.go.kr) | Ministry of Government Legislation | API | On change | Government Open Data | All Korean statutes, presidential decrees, ministerial ordinances |
| [KLRI English Translations](https://elaw.klri.re.kr) | Korea Legislation Research Institute | HTML Scrape | On change | Government Open Data (Reference) | Official English translations of 700+ laws |
| [PIPC](https://www.pipc.go.kr) | Personal Information Protection Commission | HTML Scrape | On change | Government Public Data | PIPA guidelines, enforcement actions |

> Full provenance metadata: [`sources.yml`](./sources.yml)

## Laws Covered

| Law | Korean Name | Key Topic |
|-----|------------|-----------|
| **Personal Information Protection Act (PIPA)** | 개인정보 보호법 | Personal data protection (one of world's strictest) |
| **Network Act** | 정보통신망 이용촉진 및 정보보호 등에 관한 법률 | ICT network security, information protection |
| **Credit Information Act** | 신용정보의 이용 및 보호에 관한 법률 | Financial data, MyData, credit information |
| **Electronic Government Act** | 전자정부법 | Digital government services, e-government |
| **Framework Act on Intelligent Informatization** | 지능정보화 기본법 | AI governance, intelligent information services |
| **IT Network Act** | 정보통신망법 | Network infrastructure, cybersecurity |
| **Constitution (selected provisions)** | 대한민국헌법 | Fundamental rights, Article 17 (right to privacy) |

Additionally includes key PIPC guidelines and supplementary materials:

- PIPA Standard Guidelines (개인정보 처리 표준지침)
- PIPC enforcement actions and penalty decisions
- Cross-border transfer standard contractual clauses

## Quick Start

### npx (no install)

```bash
npx @ansvar/south-korea-law-mcp
```

### npm install

```bash
npm install -g @ansvar/south-korea-law-mcp
south-korea-law-mcp
```

### Claude Desktop Configuration

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "south-korea-law": {
      "command": "npx",
      "args": ["-y", "@ansvar/south-korea-law-mcp"]
    }
  }
}
```

### Cursor Configuration

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "south-korea-law": {
      "command": "npx",
      "args": ["-y", "@ansvar/south-korea-law-mcp"]
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `search_legislation` | Full-text search across all South Korean laws. Supports Korean and English queries. Returns matching provisions with law name, article number, and relevance score. |
| `get_provision` | Retrieve a specific article/provision by law identifier and article number. Returns full text (Korean + English where available), citation URL, and metadata. |
| `get_provision_eu_basis` | Cross-reference lookup showing the relationship between Korean laws and their EU equivalents (e.g., PIPA vs GDPR). |
| `validate_citation` | Validate a legal citation against the database. Checks law name, article number, and returns canonical citation format. |
| `check_statute_currency` | Check whether a law or provision is the current version. Returns adoption date, effective date, and amendment history. |
| `list_laws` | List all laws in the database with metadata: official name (Korean + English), law number, effective date, status, and article count. |

## Deployment Tiers

| Tier | Content | Database Size | Platform |
|------|---------|---------------|----------|
| **Free** | All major statutes + English translations + EU cross-references | ~80-150 MB | Vercel (bundled) or local |
| **Professional** | + Presidential decrees + ministerial ordinances + PIPC guidelines + enforcement decisions | ~400 MB-700 MB | Azure Container Apps / Docker / local |

### Deployment Strategy: MEDIUM - Dual Tier, Bundled Free

The free-tier database containing major statutes and English translations is estimated at 80-150 MB, within the Vercel 250 MB bundle limit. The free-tier database is bundled directly with the Vercel deployment. The professional tier with full presidential decrees, ministerial ordinances, and PIPC guidelines requires local Docker or Azure Container Apps deployment.

### Capability Detection

Both tiers use the same codebase. At startup, the server detects available SQLite tables and gates tools accordingly:

```
Free tier:     core_legislation, eu_references, english_translations
Professional:  core_legislation, eu_references, english_translations, presidential_decrees, ministerial_ordinances, pipc_guidelines, enforcement_decisions
```

Tools that require professional capabilities return an upgrade message on the free tier.

## Database Size Estimates

| Component | Estimated Size | Notes |
|-----------|---------------|-------|
| Major statutes (법률) | ~30-50 MB | Key data protection, ICT, corporate statutes in Korean |
| English translations (KLRI) | ~20-40 MB | Official KLRI translations of major laws |
| EU cross-references | ~5-10 MB | PIPA-GDPR, Network Act-NIS2 mappings |
| FTS5 indexes | ~25-50 MB | Full-text search indexes for Korean text |
| **Free tier total** | **~80-150 MB** | |
| Presidential decrees (대통령령) | ~100-200 MB | Implementing decrees for major statutes |
| Ministerial ordinances (부령) | ~100-200 MB | Ministry-level regulations |
| PIPC guidelines and enforcement | ~30-50 MB | Interpretive standards, penalty decisions |
| **Professional tier total** | **~400 MB-700 MB** | |

## Data Freshness

- **SLO:** 30 days maximum data age
- **Automated checks:** Weekly upstream change detection
- **Drift detection:** Nightly hash verification of 6 stable provisions (Constitution Art. 17, PIPA Art. 1, Network Act Art. 1, Credit Information Act Art. 1, Electronic Government Act Art. 1, Framework Act on Intelligent Informatization Art. 1)
- **Health endpoint:** Returns `status: stale` when data exceeds 30-day SLO

## Language Support

The primary language is **Korean (ko)**, which is the sole legally binding version. Official English translations are available from the Korea Legislation Research Institute (elaw.klri.re.kr). These translations are reference translations and are not legally authoritative.

The search tool supports queries in both Korean and English, with Korean queries using proper morphological analysis for accurate results.

## Contributing

Contributions are welcome. Please read [SECURITY.md](./SECURITY.md) before submitting issues or pull requests.

For data accuracy issues (wrong text, missing articles, stale provisions), use the [data error report template](https://github.com/Ansvar-Systems/south-korea-law-mcp/issues/new?template=data-error.md).

## License

Apache-2.0

The law text itself is public domain under South Korean government open data policy. This project's code and database structure are licensed under Apache-2.0.
