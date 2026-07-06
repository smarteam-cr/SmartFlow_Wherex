const cron = require('node-cron');

function startScheduler(ingestFn, intervalMin) {
  return cron.schedule(`*/${intervalMin} * * * *`, () => {
    ingestFn().catch(console.error);
  });
}

module.exports = { startScheduler };
