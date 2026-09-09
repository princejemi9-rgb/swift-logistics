const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const port = 3900 + Math.floor(Math.random() * 800);
let server, dataDirectory;
const api = async (route, options = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, options);
  const body = await response.json();
  return { response, body };
};
const cookieFrom = response => response.headers.get('set-cookie').split(';')[0];

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { const { body } = await api('/api/health'); if (body.status === 'ok') return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server did not start.');
}

(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), 'swift-logistics-test-'));
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDirectory } });
  await waitForServer();
  const email = `test-${Date.now()}@example.test`;
  let result = await api('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test Customer', email, password: 'safe-test-password' }) });
  assert.equal(result.response.status, 201); const cookie = cookieFrom(result.response);
  result = await api('/api/shipments', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ senderName: 'Test Customer', senderEmail: email, origin: 'Lagos', recipientName: 'Recipient', recipientPhone: '08000000000', destination: 'Abuja', contents: 'Documents', weight: 1, service: 'Priority' }) });
  assert.equal(result.response.status, 201); const trackingNumber = result.body.id;
  result = await api(`/api/shipments/${trackingNumber}`); assert.equal(result.response.status, 200); assert.equal(result.body.id, trackingNumber);
  result = await api('/api/shipments', { headers: { Cookie: cookie } }); assert.equal(result.response.status, 200); assert.equal(result.body.length, 1);
  result = await api('/api/support-tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test Customer', email, topic: 'Tracking issue', message: 'Please check my package.' }) });
  assert.equal(result.response.status, 201);
  console.log('Smoke test passed: authentication, shipments, tracking, history, and support.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { server?.kill(); if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true }); });
