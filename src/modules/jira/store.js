const { getDb } = require('../../db/connection');

const WATERMARK_ID = 'jira_ingest';
const COLLECTION = 'processed_issues';

async function ensureIndexes() {
  const db = getDb();
  await db.collection(COLLECTION).createIndex(
    { project: 1, issueKey: 1 },
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

async function isProcessed(project, issueKey) {
  const db = getDb();
  const doc = await db.collection(COLLECTION).findOne({ project, issueKey });
  return Boolean(doc);
}

async function markProcessed(project, issueKey, taskId) {
  const db = getDb();
  await db.collection(COLLECTION).insertOne({ project, issueKey, taskId, createdAt: new Date() });
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