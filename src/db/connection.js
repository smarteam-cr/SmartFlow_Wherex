const { MongoClient } = require('mongodb');

let client;
let db;

async function connect(uri, dbName) {
  if (!uri || typeof uri !== 'string' || uri.trim() === '') {
    throw new Error('db/connection.connect: uri is required');
  }
  if (client) {
    await close();
  }
  client = new MongoClient(uri);
  await client.connect();
  db = dbName ? client.db(dbName) : client.db();
  return db;
}

async function close() {
  if (client) {
    await client.close();
    client = undefined;
    db = undefined;
  }
}

function getDb() {
  if (!db) throw new Error('db/connection: not connected');
  return db;
}

async function ping() {
  const handle = getDb();
  await handle.command({ ping: 1 });
}

module.exports = {
  connect,
  close,
  ping,
  getDb,
};