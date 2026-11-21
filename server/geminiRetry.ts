export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('429') ||
        msg.includes('overloaded');

      if (!isTransient || attempt === maxAttempts) {
        break;
      }

      const delayMs = 800 * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const rawMsg = lastError instanceof Error ? lastError.message : String(lastError);
  if (rawMsg.includes('503') || rawMsg.includes('UNAVAILABLE')) {
    throw new Error('The AI service is temporarily experiencing high demand. Please retry in a few seconds.');
  }
  throw lastError instanceof Error ? lastError : new Error(rawMsg);
}
