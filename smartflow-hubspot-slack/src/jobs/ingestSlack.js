function createIngestJob({ channel, mongo, slack, hubspot, pollIntervalMin }) {
  return async function ingest() {
    const watermark = await mongo.getWatermark();
    const now = (Date.now() / 1000).toFixed(6);
    const oldest = watermark || (Date.now() / 1000 - pollIntervalMin * 60).toFixed(6);
    const latest = now;

    const messages = await slack.getMessages(channel, oldest, latest);
    if (messages.length === 0) return;

    let maxTs = watermark;

    for (const msg of messages) {
      if (await mongo.isProcessed(channel, msg.ts)) {
        maxTs = maxTs && maxTs > msg.ts ? maxTs : msg.ts;
        continue;
      }

      const existingTicket = await hubspot.findTicketBySlackTs(msg.ts);
      let ticketId;
      if (existingTicket) {
        ticketId = existingTicket.id;
      } else {
        const created = await hubspot.createTicket(msg, channel);
        ticketId = created.id;
      }

      await mongo.markProcessed(channel, msg.ts, ticketId);
      maxTs = maxTs && maxTs > msg.ts ? maxTs : msg.ts;
    }

    if (maxTs) await mongo.setWatermark(maxTs);
  };
}

module.exports = { createIngestJob };
