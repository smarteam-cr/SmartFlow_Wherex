function isRetryableDefault(err) {
  if (!err) return false;
  if (typeof err.status === 'number') {
    if (err.status === 429) return true;
    if (err.status >= 500 && err.status <= 599) return true;
    return false;
  }
  return true;
}

async function withRetry(fn, { retries = 3, baseMs = 200, isRetryable, sleepFn = defaultSleep } = {}) {
  if (!Number.isInteger(retries) || retries < 0) {
    throw new Error('withRetry: retries must be a non-negative integer');
  }
  const retryable = isRetryable || isRetryableDefault;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      if (!retryable(err)) break;
      const delay = err && typeof err.retryAfterMs === 'number' ? err.retryAfterMs : baseMs * Math.pow(2, attempt);
      await sleepFn(delay);
    }
  }

  throw lastErr;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = withRetry;
module.exports.withRetry = withRetry;
module.exports.isRetryableDefault = isRetryableDefault;