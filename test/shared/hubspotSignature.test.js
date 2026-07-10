import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isValidSignature } = require('../src/shared/hubspotSignature');

const APP_SECRET = 'test-app-secret';

function signV1(body) {
  return crypto.createHash('sha256').update(APP_SECRET + body).digest('hex');
}

function signV3({ method, url, body, timestamp }) {
  return crypto
    .createHmac('sha256', APP_SECRET)
    .update(method + url + body + timestamp)
    .digest('base64');
}

describe('shared/hubspotSignature.isValidSignature', () => {
  describe('v1 (legacy)', () => {
    it('accepts a correct v1 signature', () => {
      const body = '[{"objectId":"t1"}]';
      expect(
        isValidSignature({ appSecret: APP_SECRET, rawBody: body, signatureV1: signV1(body) })
      ).toBe(true);
    });

    it('rejects an incorrect v1 signature', () => {
      const body = '[{"objectId":"t1"}]';
      expect(
        isValidSignature({ appSecret: APP_SECRET, rawBody: body, signatureV1: 'deadbeef' })
      ).toBe(false);
    });

    it('rejects a v1 signature when appSecret is wrong', () => {
      const body = '[{"objectId":"t1"}]';
      const wrong = crypto.createHash('sha256').update('other-secret' + body).digest('hex');
      expect(
        isValidSignature({ appSecret: APP_SECRET, rawBody: body, signatureV1: wrong })
      ).toBe(false);
    });
  });

  describe('v3 (current)', () => {
    const method = 'POST';
    const url = 'https://example.com/jira/webhooks/hubspot';

    it('accepts a correct v3 signature within the timestamp window', () => {
      const body = '[{"objectId":"t1"}]';
      const timestamp = String(Date.now());
      const v3 = signV3({ method, url, body, timestamp });
      expect(
        isValidSignature({ appSecret: APP_SECRET, method, url, rawBody: body, timestamp, signatureV3: v3 })
      ).toBe(true);
    });

    it('rejects a v3 signature outside the 5-minute window', () => {
      const body = '[{"objectId":"t1"}]';
      const timestamp = String(Date.now() - 10 * 60 * 1000);
      const v3 = signV3({ method, url, body, timestamp });
      expect(
        isValidSignature({ appSecret: APP_SECRET, method, url, rawBody: body, timestamp, signatureV3: v3 })
      ).toBe(false);
    });

    it('rejects a v3 signature when the body has been tampered', () => {
      const timestamp = String(Date.now());
      const v3 = signV3({ method, url, body: '[{"objectId":"t1"}]', timestamp });
      const tamperedBody = '[{"objectId":"t2"}]';
      expect(
        isValidSignature({ appSecret: APP_SECRET, method, url, rawBody: tamperedBody, timestamp, signatureV3: v3 })
      ).toBe(false);
    });

    it('rejects a v3 signature when the URL has been tampered', () => {
      const body = '[{"objectId":"t1"}]';
      const timestamp = String(Date.now());
      const v3 = signV3({ method, url, body, timestamp });
      const tamperedUrl = 'https://example.com/slack/webhooks/hubspot';
      expect(
        isValidSignature({ appSecret: APP_SECRET, method, url: tamperedUrl, rawBody: body, timestamp, signatureV3: v3 })
      ).toBe(false);
    });

    it('prefers v3 when both v3 and v1 headers are present', () => {
      const body = '[{"objectId":"t1"}]';
      const timestamp = String(Date.now());
      const v3 = signV3({ method, url, body, timestamp });
      const wrongV1 = 'deadbeef';
      expect(
        isValidSignature({
          appSecret: APP_SECRET,
          method,
          url,
          rawBody: body,
          timestamp,
          signatureV3: v3,
          signatureV1: wrongV1,
        })
      ).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns false when neither signature header is present', () => {
      expect(isValidSignature({ appSecret: APP_SECRET, rawBody: '[]' })).toBe(false);
    });

    it('returns false when v3 is present but timestamp is missing', () => {
      expect(
        isValidSignature({
          appSecret: APP_SECRET,
          method: 'POST',
          url: 'https://x',
          rawBody: '[]',
          signatureV3: 'abc',
        })
      ).toBe(false);
    });

    it('returns false when v1 signature is empty string', () => {
      expect(
        isValidSignature({ appSecret: APP_SECRET, rawBody: '[]', signatureV1: '' })
      ).toBe(false);
    });

    it('uses timingSafeEqual semantics (length-mismatched buffers do not throw)', () => {
      const body = '[{"objectId":"t1"}]';
      const v1 = signV1(body);
      const truncated = v1.slice(0, v1.length - 2);
      expect(
        isValidSignature({ appSecret: APP_SECRET, rawBody: body, signatureV1: truncated })
      ).toBe(false);
    });
  });
});