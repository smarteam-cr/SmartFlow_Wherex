const realCron = require('node-cron');

let activeHandle = null;

function startScheduler({ ingest, intervalMin, cron = realCron }) {
  if (!ingest) throw new Error('startScheduler: ingest is required');
  if (!Number.isInteger(intervalMin) || intervalMin <= 0 || intervalMin > 59) {
    throw new Error('startScheduler: intervalMin must be an integer in [1, 59]');
  }
  const expression = `*/${intervalMin} * * * *`;
  const handler = async () => {
    try {
      await ingest.run({ now: new Date() });
    } catch (err) {
      console.error('ingest.run failed:', err);
    }
  };
  activeHandle = cron.schedule(expression, handler);
  return activeHandle;
}

function stopScheduler() {
  if (activeHandle && typeof activeHandle.stop === 'function') {
    activeHandle.stop();
    activeHandle = null;
  }
}

module.exports = { startScheduler, stopScheduler };
