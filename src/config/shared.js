function parsePositiveInt(value, name) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${value}`);
  }
  return n;
}

function loadSharedConfig(env = process.env) {
  const errors = [];

  if (!env.MONGO_URI || String(env.MONGO_URI).trim() === '') {
    errors.push('Missing required env var: MONGO_URI');
  }

  const portRaw = env.PORT ?? '3000';
  let port = 3000;
  try {
    port = Number.parseInt(portRaw, 10);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error('invalid port');
    }
  } catch {
    throw new Error(`PORT must be an integer in [0, 65535], got: ${portRaw}`);
  }

  const pollIntervalMin = parsePositiveInt(env.POLL_INTERVAL_MIN ?? '5', 'POLL_INTERVAL_MIN');

  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  return {
    MONGO_URI: env.MONGO_URI,
    MONGO_DB_NAME: env.MONGO_DB_NAME ? String(env.MONGO_DB_NAME) : undefined,
    PORT: port,
    POLL_INTERVAL_MIN: pollIntervalMin,
  };
}

module.exports = { loadSharedConfig };