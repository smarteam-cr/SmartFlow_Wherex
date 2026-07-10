const { getDb } = require('../../db/connection');

const WATERMARK_ID = 'slack_ingest';
const COLLECTION = 'processed_messages';

async function ensureIndexes() {
  const db = getDb();
  await db.collection(COLLECTION).createIndex(
    { channel: 1, ts: 1 },
    { unique: true }
  );
}

async function getWatermark() {
  const db = getDb();
  const doc = await db.collection('watermark').findOne({ _id: WATERMARK_ID });
  return doc ? doc.ts : null;
}

async function setWatermark(ts) {
  const db = getDb();
  await db.collection('watermark').updateOne(
    { _id: WATERMARK_ID },
    { $set: { ts, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function isProcessed(channel, ts) {
  const db = getDb();
  const doc = await db.collection(COLLECTION).findOne({ channel, ts });
  return Boolean(doc);
}

async function markProcessed(channel, ts, ticketId) {
  const db = getDb();
  await db.collection(COLLECTION).insertOne({ channel, ts, ticketId, createdAt: new Date() });
}

async function __reset() {
  const db = getDb();
  await db.collection('watermark').deleteMany({});
  await db.collection(COLLECTION).deleteMany({});
}

module.exports = {
  ensureIndexes,
  getWatermark,
  setWatermark,
  isProcessed,
  markProcessed,
  __reset,
};