/**
 * Premium tool stub for free-tier builds.
 *
 * The build pipeline (build-all.sh) overwrites this file with the real
 * implementation that detects premium tables (case_law, preparatory_works,
 * agency_guidance) and injects search tools at runtime.
 *
 * This stub exports the same signature as a no-op so that the TypeScript
 * build passes when premium-tools.ts has not been injected.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type Database from '@ansvar/mcp-sqlite';

/**
 * No-op stub. The real implementation wraps the server's ListTools and
 * CallTool handlers to add premium search tools when premium DB tables
 * are present.
 */
export function wrapWithPremiumTools(
  _server: Server,
  _db: InstanceType<typeof Database>,
): void {
  // Stub — replaced by build pipeline for premium Docker images.
}
