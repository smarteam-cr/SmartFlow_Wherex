const { MongoClient } = require('mongodb');

let client;
let db;

const WATERMARK_ID = 'slack_ingest';

async function connect(uri, dbName) {
  client = new MongoClient(uri);
  await client.connect();
  db = dbName ? client.db(dbName) : client.db();
  await db
    .collection('processed_messages')
    .createIndex({ channel: 1, ts: 1 }, { unique: true });
  return db;
}

async function close() {
  if (client) await client.close();
}

async function getWatermark() {
  const doc = await db.collection('watermark').findOne({ _id: WATERMARK_ID });
  return doc ? doc.ts : null;
}

async function setWatermark(ts) {
  await db
    .collection('watermark')
    .updateOne(
      { _id: WATERMARK_ID },
      { $set: { ts, updatedAt: new Date() } },
      { upsert: true }
    );
}

async function isProcessed(channel, ts) {
  const doc = await db.collection('processed_messages').findOne({ channel, ts });
  return Boolean(doc);
}

async function markProcessed(channel, ts, ticketId) {
  await db
    .collection('processed_messages')
    .insertOne({ channel, ts, ticketId, createdAt: new Date() });
}

async function __reset() {
  await db.collection('watermark').deleteMany({});
  await db.collection('processed_messages').deleteMany({});
}

module.exports = {
  connect,
  close,
  getWatermark,
  setWatermark,
  isProcessed,
  markProcessed,
  __reset,
};
