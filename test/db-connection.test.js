import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let mongod;
let connection;

describe('db/connection', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    connection = require('../src/db/connection');
  });

  afterAll(async () => {
    if (connection && typeof connection.close === 'function') {
      await connection.close();
    }
    if (mongod) await mongod.stop();
  });

  beforeEach(async () => {
    if (connection && typeof connection.close === 'function') {
      await connection.close();
    }
  });

  it('connects to MongoDB and returns the database handle', async () => {
    const db = await connection.connect(mongod.getUri(), 'test_connection');
    expect(db).toBeDefined();
    expect(db.databaseName).toBe('test_connection');
  });

  it('connects without dbName (uses database from URI path)', async () => {
    const db = await connection.connect(mongod.getUri());
    expect(db).toBeDefined();
    expect(typeof db.databaseName).toBe('string');
  });

  it('exposes getDb() returning the same handle after connect', async () => {
    await connection.connect(mongod.getUri(), 'test_getdb');
    const db = connection.getDb();
    expect(db).toBeDefined();
    expect(db.databaseName).toBe('test_getdb');
  });

  it('ping() succeeds when connected', async () => {
    await connection.connect(mongod.getUri(), 'test_ping');
    await expect(connection.ping()).resolves.toBeUndefined();
  });

  it('ping() throws when not connected', async () => {
    await expect(connection.ping()).rejects.toThrow(/not connected/i);
  });

  it('close() is a no-op when never connected', async () => {
    const fresh = require('../src/db/connection');
    delete require.cache[require.resolve('../src/db/connection')];
    const freshConn = require('../src/db/connection');
    await expect(freshConn.close()).resolves.toBeUndefined();
  });

  it('close() after connect does not throw and allows re-connect', async () => {
    await connection.connect(mongod.getUri(), 'test_close_reconnect');
    await expect(connection.close()).resolves.toBeUndefined();
    const db = await connection.connect(mongod.getUri(), 'test_close_reconnect_2');
    expect(db.databaseName).toBe('test_close_reconnect_2');
  });

  it('connect() with an invalid URI rejects', async () => {
    await expect(connection.connect('not-a-valid-uri', 'junk')).rejects.toThrow();
  });

  it('after close, getDb() throws because there is no active db', async () => {
    await connection.connect(mongod.getUri(), 'test_getdb_after_close');
    await connection.close();
    expect(() => connection.getDb()).toThrow(/not connected/i);
  });
});