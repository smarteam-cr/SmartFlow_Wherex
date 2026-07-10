const realCron = require('node-cron');

function createScheduler({ cron = realCron } = {}) {
  const handles = new Map();

  function registerJob({ name, ingest, intervalMin } = {}) {
    if (!name || typeof name !== 'string' || name.trim() === '') {
      throw new Error('registerJob: name is required');
    }
    if (!ingest) throw new Error('registerJob: ingest is required');
    if (!Number.isInteger(intervalMin) || intervalMin <= 0 || intervalMin > 59) {
      throw new Error('registerJob: intervalMin must be an integer in [1, 59]');
    }
    if (handles.has(name)) {
      throw new Error(`registerJob: job '${name}' already registered`);
    }

    const expression = `*/${intervalMin} * * * *`;
    let running = false;

    const handler = async () => {
      if (running) return;
      running = true;
      try {
        await ingest.run({ now: new Date() });
      } catch (err) {
        console.error(`[scheduler:${name}] ingest.run failed:`, err);
      } finally {
        running = false;
      }
    };

    const handle = cron.schedule(expression, handler);
    handles.set(name, handle);
    return handle;
  }

  function stopJob(name) {
    const h = handles.get(name);
    if (!h) return false;
    if (typeof h.stop === 'function') h.stop();
    handles.delete(name);
    return true;
  }

  function stopAll() {
    for (const h of handles.values()) {
      if (typeof h.stop === 'function') h.stop();
    }
    handles.clear();
  }

  function list() {
    return Array.from(handles.keys());
  }

  return { registerJob, stopJob, stopAll, list };
}

module.exports = { createScheduler };