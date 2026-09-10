export interface StreamValidationResult {
  valid: boolean;
  status?: number;
  contentType?: string;
  contentLength?: number;
  finalUrl?: string;
  error?: string;
  durationMs?: number;
}

/**
 * Robust HTTP Audio Stream Validator
 * Performs a fast Range check to verify that a remote audio stream is alive,
 * returns HTTP 200/206, and serves genuine audio bytes before giving it to HTML5 Audio.
 */
export async function validateAudioStreamUrl(
  url: string,
  timeoutMs = 4500
): Promise<StreamValidationResult> {
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return { valid: false, error: 'Empty or invalid URL' };
  }

  const cleanUrl = url.trim();

  // Local/Blob sources are always considered valid
  if (cleanUrl.startsWith('blob:') || cleanUrl.startsWith('data:') || cleanUrl.startsWith('file:')) {
    return {
      valid: true,
      status: 200,
      contentType: 'audio/local',
      finalUrl: cleanUrl,
    };
  }

  const startTime = performance.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Use Range: bytes=0-1024 for instant header + first chunk validation without downloading full file
    const res = await fetch(cleanUrl, {
      method: 'GET',
      headers: {
        Range: 'bytes=0-1024',
        Accept: 'audio/*, video/mp4, application/octet-stream, */*',
      },
      signal: controller.signal,
    });

    clearTimeout(timer);
    const durationMs = Math.round(performance.now() - startTime);

    const status = res.status;
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
    const finalUrl = res.url || cleanUrl;

    // Reject HTTP error codes (403 Forbidden, 404 Not Found, 410 Gone, 500+ Server Errors)
    if (status === 404 || status === 403 || status === 410 || status >= 500) {
      return {
        valid: false,
        status,
        contentType,
        contentLength,
        finalUrl,
        durationMs,
        error: `HTTP ${status} stream unavailable on CDN`,
      };
    }

    // Success response: 200 (OK) or 206 (Partial Content)
    const isSuccessStatus = status === 200 || status === 206;
    const isHtmlOrJson = contentType.includes('text/html') || contentType.includes('application/json') || contentType.includes('text/xml');

    if (!isSuccessStatus || isHtmlOrJson) {
      return {
        valid: false,
        status,
        contentType,
        contentLength,
        finalUrl,
        durationMs,
        error: isHtmlOrJson ? `CDN returned non-audio response: ${contentType}` : `Unexpected HTTP status ${status}`,
      };
    }

    return {
      valid: true,
      status,
      contentType,
      contentLength,
      finalUrl,
      durationMs,
    };
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - startTime);
    return {
      valid: false,
      durationMs,
      error: err?.name === 'AbortError' ? 'Stream validation timed out' : (err?.message || 'Network request failed'),
    };
  }
}
