const crypto = require('crypto');

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

function isValidSignature({ appSecret, method, url, rawBody, timestamp, signatureV3, signatureV1 }) {
  if (signatureV3 && timestamp) {
    if (Math.abs(Date.now() - Number(timestamp)) > SIGNATURE_MAX_AGE_MS) return false;
    const expected = crypto
      .createHmac('sha256', appSecret)
      .update(method + url + rawBody + timestamp)
      .digest('base64');
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(signatureV3);
    if (expectedBuf.length !== actualBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, actualBuf);
  }
  if (signatureV1) {
    if (!signatureV1 || signatureV1.length === 0) return false;
    const expected = crypto.createHash('sha256').update(appSecret + rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(signatureV1);
    if (expectedBuf.length !== actualBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, actualBuf);
  }
  return false;
}

module.exports = { isValidSignature, SIGNATURE_MAX_AGE_MS };