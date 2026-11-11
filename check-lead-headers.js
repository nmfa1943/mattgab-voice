// Runs the leadApiHeaders function copied from server.js between the
// leadApiHeaders markers, and checks the postLeadToDashboard wiring.
// No network, no secrets: the sample key exists only inside this process.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

function loadLeadApiHeaders() {
  const match = src.match(/\/\/ --- BEGIN leadApiHeaders[^\n]*\n([\s\S]*?)\n\/\/ --- END leadApiHeaders ---/);
  assert.ok(match, 'leadApiHeaders markers not found in server.js');
  return new Function(`${match[1]}\nreturn leadApiHeaders;`)();
}

const leadApiHeaders = loadLeadApiHeaders();
const SAMPLE_KEY = 'unit-test-key';

test('X-API-Key is absent when AI_LEAD_KEY is unset', () => {
  for (const unset of [undefined, null, '']) {
    const headers = leadApiHeaders(unset);
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(Object.hasOwn(headers, 'X-API-Key'), false);
    assert.deepEqual(Object.keys(headers), ['Content-Type']);
  }
});

test('X-API-Key is attached when AI_LEAD_KEY is set', () => {
  const headers = leadApiHeaders(SAMPLE_KEY);
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers['X-API-Key'], SAMPLE_KEY);
  assert.deepEqual(Object.keys(headers).sort(), ['Content-Type', 'X-API-Key']);
});

test('postLeadToDashboard wires the env vars and does not log the key or a non-2xx body', () => {
  assert.match(src, /const LEAD_API_URL\s+=\s+process\.env\.LEAD_API_URL \|\| 'https:\/\/mattgabmanagement\.com\/lead-api\.php'/);
  assert.match(src, /const AI_LEAD_KEY\s+=\s+process\.env\.AI_LEAD_KEY;/);
  assert.match(src, /fetch\(LEAD_API_URL,\s*\{[^}]*headers:\s*leadApiHeaders\(AI_LEAD_KEY\)/s);
  const failBranch = src.match(/if \(!res\.ok\) \{([\s\S]*?)\n    \}/);
  assert.ok(failBranch, 'non-2xx branch missing');
  assert.match(failBranch[1], /console\.error\('Lead POST HTTP status:', res\.status\)/);
  assert.doesNotMatch(failBranch[1], /res\.(json|text)|JSON\.stringify|AI_LEAD_KEY|X-API-Key/);
  assert.doesNotMatch(src, /console\.(log|error|info|warn|debug)\([^;\n]*AI_LEAD_KEY/);
});
