# South Korea Law MCP — Project Guide

## Overview
MCP server providing South Korean legislation via Model Context Protocol. Data sourced from Korean Law Information Center (law.go.kr) and KLRI English translations (elaw.klri.re.kr). Strategy B deployment (runtime DB download on Vercel cold start).

## Architecture
- **Dual transport**: stdio (`src/index.ts`) + Streamable HTTP (`api/mcp.ts`)
- **Shared tool registry**: `src/tools/registry.ts` — both transports use identical tools
- **Database**: SQLite + FTS5, built by `scripts/build-db.ts` from seed JSON
- **Ingestion**: `scripts/ingest.ts` fetches from open.law.go.kr API (Korean Law Information Center)
- **Languages**: Korean (ko) primary, English (en) via KLRI translations

## Key Conventions
- All tool implementations return `ToolResponse<T>` with `results` + `_metadata`
- Database queries MUST use parameterized statements (never string interpolation)
- FTS5 queries go through `buildFtsQueryVariants()` for sanitization
- Statute IDs resolved via `resolveExistingStatuteId()` (exact match, then Korean title LIKE, then English title LIKE, then law_number)
- Journal mode must be DELETE (not WAL) for WASM/serverless compatibility
- Article references support both `art-N` and `제N조` formats

## Korean Legal Structure
- 편(pyeon/part) > 장(jang/chapter) > 절(jeol/section) > 조(jo/article) > 항(hang/paragraph) > 호(ho/item)
- Articles: 제N조 (e.g., 제1조, 제15조)
- Paragraphs: ①, ②, ③ (circled numbers)
- Items: 1., 2., 3. (Arabic with period)

## Commands
- `npm test` — run unit + integration tests (vitest)
- `npm run test:contract` — run golden contract tests
- `npm run test:coverage` — coverage report
- `npm run build` — compile TypeScript
- `npm run validate` — full test suite (unit + contract)
- `npm run dev` — stdio server in dev mode
- `npm run ingest` — fetch legislation from upstream (requires KOREA_LAW_API_KEY)
- `npm run build:db` — rebuild SQLite from seed JSON

## Environment Variables
- `SOUTH_KOREA_LAW_DB_PATH` — custom database path (overrides default)
- `KOREA_LAW_API_KEY` — API key for open.law.go.kr (required for ingestion)
- `SOUTH_KOREA_LAW_DB_URL` — custom database download URL for Vercel

## Testing
- Unit tests in `tests/` (in-memory test DB)
- Golden contract tests in `__tests__/contract/` driven by `fixtures/golden-tests.json`
- Drift detection via `fixtures/golden-hashes.json`
- Always run `npm run validate` before committing

## File Structure
- `src/tools/*.ts` — one file per MCP tool (13 tools)
- `src/utils/*.ts` — shared utilities (FTS, metadata, statute ID resolution, date handling)
- `src/citation/*.ts` — citation parsing, formatting, validation (Korean + English formats)
- `scripts/` — ingestion pipeline and maintenance scripts
- `scripts/lib/` — fetcher (law.go.kr API + KLRI scraper) and parser (XML + HTML)
- `api/` — Vercel serverless functions (health + MCP endpoint)
- `fixtures/` — golden tests and drift hashes

## Git Workflow
- **Never commit directly to `main`.** Always create a feature branch and open a Pull Request.
- Branch protection requires: verified signatures, PR review, and status checks to pass.
- Use conventional commit prefixes: `feat:`, `fix:`, `chore:`, `docs:`, etc.
