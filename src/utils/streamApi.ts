export interface OperationProgressUpdate {
  percent: number;
  stage: string;
  detail?: string;
}

export class ServerReturnedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerReturnedError';
  }
}

interface NdjsonEvent<T> {
  type?: 'progress' | 'result' | 'error';
  percent?: number;
  stage?: string;
  detail?: string;
  data?: T;
  error?: string;
}

export async function fetchNdjsonWithProgress<T>(
  url: string,
  body: Record<string, unknown>,
  onProgress: (update: OperationProgressUpdate) => void,
  signal?: AbortSignal
): Promise<T | null> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });

  const contentType = (res.headers.get('content-type') || '').toLowerCase();

  // Handle standard JSON responses (e.g., 400 validation errors or proxies without streaming)
  if (contentType.includes('application/json')) {
    let rawJson: unknown = null;
    try {
      rawJson = await res.json();
    } catch {
      rawJson = null;
    }

    if (rawJson && typeof rawJson === 'object') {
      const errMsg = (rawJson as { error?: unknown }).error;
      if (!res.ok) {
        throw new ServerReturnedError(
          typeof errMsg === 'string' && errMsg.trim()
            ? errMsg
            : `Request failed with status ${res.status}.`
        );
      }
      return rawJson as T;
    }

    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}.`);
    }
    return null;
  }

  if (!res.ok) {
    let textErr = '';
    try {
      textErr = await res.text();
      const parsed = JSON.parse(textErr) as { error?: string };
      if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
        throw new ServerReturnedError(parsed.error);
      }
    } catch (inner) {
      if (inner instanceof ServerReturnedError) {
        throw inner;
      }
    }
    throw new Error(`Request failed with status ${res.status}.`);
  }

  if (!res.body) {
    return null;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: T | null = null;

  const processLine = (rawLine: string) => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    let parsed: NdjsonEvent<T>;
    try {
      parsed = JSON.parse(trimmed) as NdjsonEvent<T>;
    } catch {
      return;
    }

    if (parsed.type === 'progress') {
      onProgress({
        percent:
          typeof parsed.percent === 'number' && Number.isFinite(parsed.percent)
            ? Math.max(0, Math.min(100, parsed.percent))
            : 0,
        stage:
          typeof parsed.stage === 'string' && parsed.stage.trim()
            ? parsed.stage
            : 'Working...',
        detail:
          typeof parsed.detail === 'string' && parsed.detail.trim()
            ? parsed.detail
            : undefined,
      });
    } else if (parsed.type === 'error') {
      throw new ServerReturnedError(
        typeof parsed.error === 'string' && parsed.error.trim()
          ? parsed.error
          : 'Operation failed.'
      );
    } else if (parsed.type === 'result') {
      finalResult = (parsed.data ?? null) as T | null;
    }
  };

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        throw new DOMException('Request aborted.', 'AbortError');
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        processLine(line);
        newlineIndex = buffer.indexOf('\n');
      }
    }
  } catch (readErr) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => {});
    }
    throw readErr;
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    processLine(buffer);
  }

  return finalResult;
}
