# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-02-22
### Added
- `data/census.json` — golden standard census file (jurisdiction KR, law.go.kr portal)
- Remote `streamable-http` transport in `server.json` (`https://south-korea-law-mcp.vercel.app/mcp`)
- Keywords in `server.json` for MCP Registry discovery

### Changed
- `server.json` now uses `packages` format with dual transport (stdio + streamable-http)
- Bumped version to 1.1.0

## [1.0.0] - 2026-02-20
### Added
- Initial release of South Korea Law MCP
- `search_legislation` tool for full-text search across all Korean statutes (Korean + English)
- `get_provision` tool for retrieving specific articles/provisions
- `get_provision_eu_basis` tool for EU cross-references (PIPA-GDPR context)
- `validate_citation` tool for legal citation validation
- `check_statute_currency` tool for checking statute amendment status
- `list_laws` tool for browsing available legislation
- Coverage of PIPA (2023 amendments), Network Act, Credit Information Act (MyData), Electronic Government Act, Framework Act on Intelligent Informatization
- Official English translations from KLRI (Korea Legislation Research Institute)
- Contract tests with 12 golden test cases
- Drift detection with 6 stable provision anchors
- Health and version endpoints
- Vercel deployment (dual tier bundled free)
- npm package with stdio transport
- MCP Registry publishing

[Unreleased]: https://github.com/Ansvar-Systems/south-korea-law-mcp/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Ansvar-Systems/south-korea-law-mcp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Ansvar-Systems/south-korea-law-mcp/releases/tag/v1.0.0
