/**
 * Rate-limited HTTP client for Korean Law Information Center (open.law.go.kr)
 * and KLRI English translations (elaw.klri.re.kr).
 *
 * - 500ms minimum delay between requests
 * - API key support via KOREA_LAW_API_KEY environment variable
 * - Handles XML API responses and HTML scraping
 */

const USER_AGENT = 'SouthKoreaLawMCP/1.0 (https://github.com/Ansvar-Systems/south-korea-law-mcp; hello@ansvar.ai)';
const MIN_DELAY_MS = 200;

let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_DELAY_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_DELAY_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

export interface FetchResult {
  status: number;
  body: string;
  contentType: string;
}

/**
 * Fetch a URL with rate limiting and proper headers.
 * Retries up to 3 times on 429/5xx errors with exponential backoff.
 */
export async function fetchWithRateLimit(url: string, maxRetries = 3): Promise<FetchResult> {
  await rateLimit();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/xml, text/xml, text/html, */*',
      },
    });

    if (response.status === 429 || response.status >= 500) {
      if (attempt < maxRetries) {
        const backoff = Math.pow(2, attempt + 1) * 1000;
        console.log(`  HTTP ${response.status} for ${url}, retrying in ${backoff}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
    }

    const body = await response.text();
    return {
      status: response.status,
      body,
      contentType: response.headers.get('content-type') ?? '',
    };
  }

  throw new Error(`Failed to fetch ${url} after ${maxRetries} retries`);
}

/**
 * Check whether the KOREA_LAW_API_KEY environment variable is set.
 * The law.go.kr DRF API requires an API key (OC parameter).
 *
 * The 'chetera' key is the publicly documented example key from the
 * law.go.kr API guide. It works without IP registration restrictions.
 *
 * For a dedicated key, register at: https://open.law.go.kr
 * (requires Korean real-name identity verification)
 */
export function requireApiKey(): void {
  if (!process.env.KOREA_LAW_API_KEY) {
    console.error('ERROR: KOREA_LAW_API_KEY environment variable is not set.');
    console.error('');
    console.error('The law.go.kr API requires a registered API key.');
    console.error('Register for free at: https://open.law.go.kr');
    console.error('Then: export KOREA_LAW_API_KEY=<your-key>');
    process.exit(1);
  }
}

/**
 * Check if an API response is an error from law.go.kr.
 * The API returns HTTP 200 with an XML error body when
 * authentication fails or required parameters are missing.
 */
export function isApiError(body: string): boolean {
  return body.includes('<Response>') && (
    body.includes('검증에 실패하였습니다') ||
    body.includes('필수 입력값이 존재하지 않습니다')
  );
}

/**
 * Fetch law list from open.law.go.kr API.
 * Returns XML listing of laws matching the query.
 *
 * API documentation: https://open.law.go.kr
 * API key obtained via free registration at Korea Open Data Portal.
 */
export async function fetchLawList(page: number, query?: string): Promise<FetchResult> {
  const apiKey = process.env.KOREA_LAW_API_KEY ?? '';
  const baseUrl = 'https://www.law.go.kr/DRF/lawSearch.do';
  const params = new URLSearchParams({
    OC: apiKey,
    target: 'law',
    type: 'XML',
    display: '100',
    page: String(page),
  });
  if (query) {
    params.set('query', query);
  }

  const url = `${baseUrl}?${params.toString()}`;
  return fetchWithRateLimit(url);
}

/**
 * Fetch individual law detail XML from law.go.kr API.
 * Uses the law serial number (lsiSeq) to get full law text.
 */
export async function fetchLawDetail(lawId: string): Promise<FetchResult> {
  const apiKey = process.env.KOREA_LAW_API_KEY ?? '';
  const baseUrl = 'https://www.law.go.kr/DRF/lawService.do';
  const params = new URLSearchParams({
    OC: apiKey,
    target: 'law',
    type: 'XML',
    MST: lawId,
  });

  const url = `${baseUrl}?${params.toString()}`;
  return fetchWithRateLimit(url);
}

/**
 * Fetch English translation from KLRI (elaw.klri.re.kr).
 * HTML scraping - no API available.
 */
export async function fetchKlriTranslation(lawName: string): Promise<FetchResult> {
  const baseUrl = 'https://elaw.klri.re.kr/eng_service/lawSearchList.do';
  const params = new URLSearchParams({
    searchType: '0',
    query: lawName,
  });

  const url = `${baseUrl}?${params.toString()}`;
  return fetchWithRateLimit(url);
}

/**
 * Fetch individual KLRI law page for English text.
 */
export async function fetchKlriLawDetail(lawSeq: string): Promise<FetchResult> {
  const url = `https://elaw.klri.re.kr/eng_service/lawView.do?hseq=${lawSeq}&lang=ENG`;
  return fetchWithRateLimit(url);
}
