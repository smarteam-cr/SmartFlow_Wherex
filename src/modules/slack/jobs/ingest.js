function createIngestJob({ channel, store, slack, hubspot, pollIntervalMin } = {}) {
  if (!channel) throw new Error('createIngestJob: channel is required');
  if (!slack) throw new Error('createIngestJob: slack is required');
  if (!hubspot) throw new Error('createIngestJob: hubspot is required');
  if (!store) throw new Error('createIngestJob: store is required');
  if (!Number.isInteger(pollIntervalMin) || pollIntervalMin <= 0) {
    throw new Error('createIngestJob: pollIntervalMin must be a positive integer');
  }

  async function run({ now = new Date() } = {}) {
    const watermark = await store.getWatermark();
    const oldest = watermark || (now.getTime() / 1000 - pollIntervalMin * 60).toFixed(6);
    const latest = (now.getTime() / 1000).toFixed(6);

    const messages = await slack.getMessages(channel, oldest, latest);

    const result = {
      created: 0,
      skipped: 0,
      errors: [],
      watermark,
    };

    if (messages.length === 0) return result;

    let maxTs = watermark;

    for (const msg of messages) {
      if (await store.isProcessed(channel, msg.ts)) {
        maxTs = maxTs && maxTs > msg.ts ? maxTs : msg.ts;
        result.skipped += 1;
        continue;
      }

      const existingTicket = await hubspot.findTicketBySlackTs(msg.ts);
      let ticketId;
      if (existingTicket) {
        ticketId = existingTicket.id;
      } else {
        const created = await hubspot.createTicket(msg, channel);
        ticketId = created.id;
        result.created += 1;
      }

      try {
        await store.markProcessed(channel, msg.ts, ticketId);
      } catch (err) {
        result.skipped += 1;
        result.errors.push({ channel, ts: msg.ts, error: `dedup race: ${err.message}` });
        continue;
      }
      maxTs = maxTs && maxTs > msg.ts ? maxTs : msg.ts;
    }

    if (maxTs) await store.setWatermark(maxTs);
    result.watermark = maxTs;
    return result;
  }

  return { run };
}

module.exports = { createIngestJob };
module.exports.createIngestJob = createIngestJob;