const cron = require('node-cron');

function startScheduler(ingestFn, intervalMin) {
  let running = false;
  return cron.schedule(`*/${intervalMin} * * * *`, () => {
    if (running) return;
    running = true;
    ingestFn()
      .catch(console.error)
      .finally(() => {
        running = false;
      });
  });
}

module.exports = { startScheduler };
