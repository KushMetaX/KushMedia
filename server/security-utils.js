'use strict';

const crypto = require('crypto');

/**
 * Constant-time comparison for UTF-8 secrets when lengths match (mitigates timing probes).
 */
function timingSafeEqualString(expected, actual) {
  const a = Buffer.from(String(expected ?? ''), 'utf8');
  const b = Buffer.from(String(actual ?? ''), 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  timingSafeEqualString,
};
