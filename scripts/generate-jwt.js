#!/usr/bin/env node
/**
 * Generate a mock JWT token for testing
 * Usage: node scripts/generate-jwt.js [userId]
 */

const crypto = require('crypto');

const userId = process.argv[2] || 'usr_abc';
const secret = process.argv[3] || 'replace-me-in-ssm';

function base64url(input) {
  return Buffer.from(JSON.stringify(input))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

const header = { alg: 'HS256', typ: 'JWT' };
const now = Math.floor(Date.now() / 1000);
const payload = {
  sub: userId,
  aud: 'wdrbe-api',
  iss: 'wdrbe-local',
  iat: now,
  exp: now + 3600,
};

const encodedHeader = base64url(header);
const encodedPayload = base64url(payload);
const signature = crypto
  .createHmac('sha256', secret)
  .update(`${encodedHeader}.${encodedPayload}`)
  .digest('base64')
  .replace(/=/g, '')
  .replace(/\+/g, '-')
  .replace(/\//g, '_');

console.log(`${encodedHeader}.${encodedPayload}.${signature}`);

