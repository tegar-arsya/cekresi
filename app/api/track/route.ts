import { NextResponse } from 'next/server';

const BINDERBYTE_API_KEY = process.env.BINDERBYTE_API_KEY || process.env.NEXT_PUBLIC_BINDERBYTE_API_KEY;
const IN_PROCESS_CACHE_TTL_MS = 10 * 60 * 1000;
const DELIVERED_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 25000;
const UPSTREAM_MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1200;

type TrackPayload = Record<string, unknown> & {
  status?: number;
  message?: string;
  upstreamStatus?: number;
  retryable?: boolean;
  cached?: boolean;
  attempts?: number;
};

type CacheEntry = {
  expiresAt: number;
  payload: TrackPayload;
};

const successCache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, Promise<TrackPayload>>();

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const normalizeAwb = (awb: string) => awb.trim().toUpperCase();

const isSuccessPayload = (payload: TrackPayload) => payload.status === 200 || payload.status === 201;

const getPayloadCacheTtl = (payload: TrackPayload) => {
  const summary = (payload.data as { summary?: { status?: string } } | undefined)?.summary;
  const status = summary?.status?.toUpperCase();

  if (status === 'DELIVERED') {
    return DELIVERED_CACHE_TTL_MS;
  }

  return IN_PROCESS_CACHE_TTL_MS;
};

const isRetryableResponse = (responseStatus: number, payload: TrackPayload) => {
  if (responseStatus === 429 || responseStatus >= 500) {
    return true;
  }

  // Binderbyte/POS can occasionally return 400 for a valid resi and succeed shortly after.
  // Try it once more, then stop so invalid resi do not burn repeated quota.
  return responseStatus === 400 && typeof payload.message === 'string';
};

const parsePayload = async (response: Response): Promise<TrackPayload> => {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text || 'Respons API tidak valid' };
  }
};

const fetchBinderbyte = async (awb: string) => {
  const binderbyteUrl = new URL('https://api.binderbyte.com/v1/track');
  binderbyteUrl.searchParams.set('api_key', BINDERBYTE_API_KEY || '');
  binderbyteUrl.searchParams.set('courier', 'pos');
  binderbyteUrl.searchParams.set('awb', awb);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(binderbyteUrl, {
      signal: controller.signal,
      cache: 'no-store'
    });
    const payload = await parsePayload(response);

    return {
      ...payload,
      upstreamStatus: response.status,
      retryable: isRetryableResponse(response.status, payload)
    };
  } catch (error) {
    return {
      status: 500,
      message: error instanceof Error ? error.message : 'Gagal menghubungi API tracking',
      retryable: true
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

const getFreshCachedPayload = (awb: string) => {
  const cached = successCache.get(awb);

  if (!cached) {
    return null;
  }

  if (Date.now() > cached.expiresAt) {
    successCache.delete(awb);
    return null;
  }

  return {
    ...cached.payload,
    cached: true,
    retryable: false
  };
};

const trackWithRetry = async (awb: string): Promise<TrackPayload> => {
  const cached = getFreshCachedPayload(awb);

  if (cached) {
    return cached;
  }

  const pending = pendingRequests.get(awb);

  if (pending) {
    return pending;
  }

  const requestPromise = (async () => {
    let latestPayload: TrackPayload = {
      status: 500,
      message: 'Gagal mengambil data tracking',
      retryable: true
    };

    for (let attempt = 1; attempt <= UPSTREAM_MAX_ATTEMPTS; attempt += 1) {
      latestPayload = await fetchBinderbyte(awb);

      if (isSuccessPayload(latestPayload)) {
        const payload = {
          ...latestPayload,
          cached: false,
          retryable: false,
          attempts: attempt
        };

        successCache.set(awb, {
          expiresAt: Date.now() + getPayloadCacheTtl(payload),
          payload
        });

        return payload;
      }

      if (!latestPayload.retryable || attempt === UPSTREAM_MAX_ATTEMPTS) {
        break;
      }

      await delay(RETRY_DELAY_MS * attempt);
    }

    return {
      ...latestPayload,
      cached: false,
      attempts: UPSTREAM_MAX_ATTEMPTS
    };
  })();

  pendingRequests.set(awb, requestPromise);

  try {
    return await requestPromise;
  } finally {
    pendingRequests.delete(awb);
  }
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const awb = normalizeAwb(searchParams.get('awb') || '');

  if (!BINDERBYTE_API_KEY) {
    return NextResponse.json({
      status: 500,
      message: 'API Key tidak ditemukan',
      retryable: false
    });
  }

  if (!awb) {
    return NextResponse.json({
      status: 400,
      message: 'Nomor resi tidak boleh kosong',
      retryable: false
    });
  }

  const payload = await trackWithRetry(awb);

  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 'no-store'
    }
  });
}
