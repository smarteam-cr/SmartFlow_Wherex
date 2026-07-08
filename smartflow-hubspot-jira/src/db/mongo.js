const { MongoClient } = require('mongodb');

let client;
let db;

const WATERMARK_ID = 'jira_ingest';

async function connect(uri, dbName) {
  client = new MongoClient(uri);
  await client.connect();
  db = dbName ? client.db(dbName) : client.db();
  await db
    .collection('processed_issues')
    .createIndex({ project: 1, issueKey: 1 }, { unique: true });
  return db;
}

async function close() {
  if (client) {
    await client.close();
    client = undefined;
    db = undefined;
  }
}

async function ping() {
  if (!db) throw new Error('mongo not connected');
  await db.command({ ping: 1 });
}

async function getWatermark() {
  if (!db) throw new Error('mongo not connected');
  const doc = await db.collection('watermark').findOne({ _id: WATERMARK_ID });
  return doc ? doc.ts : null;
}

async function setWatermark(ts) {
  if (!db) throw new Error('mongo not connected');
  await db
    .collection('watermark')
    .updateOne(
      { _id: WATERMARK_ID },
      { $set: { ts, updatedAt: new Date() } },
      { upsert: true }
    );
}

async function isProcessed(project, issueKey) {
  if (!db) throw new Error('mongo not connected');
  const doc = await db
    .collection('processed_issues')
    .findOne({ project, issueKey });
  return Boolean(doc);
}

async function markProcessed(project, issueKey, taskId) {
  if (!db) throw new Error('mongo not connected');
  await db
    .collection('processed_issues')
    .insertOne({ project, issueKey, taskId, createdAt: new Date() });
}

async function __reset() {
  if (!db) return;
  await db.collection('watermark').deleteMany({});
  await db.collection('processed_issues').deleteMany({});
}

module.exports = {
  connect,
  close,
  ping,
  getWatermark,
  setWatermark,
  isProcessed,
  markProcessed,
  __reset,
};
