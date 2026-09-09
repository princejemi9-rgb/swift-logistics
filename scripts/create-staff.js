const { DatabaseSync } = require('node:sqlite');
const { randomUUID, scryptSync } = require('node:crypto');
const path = require('node:path');

const [name, email, password] = process.argv.slice(2);
if (!name || !email || !password || password.length < 8) {
  console.error('Usage: node scripts/create-staff.js "Name" email@example.com "password-at-least-8-chars"');
  process.exit(1);
}
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'swift-logistics.db'));
const salt = randomUUID(); const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
try { db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(randomUUID(), name.trim(), email.trim().toLowerCase(), passwordHash, 'staff', new Date().toISOString()); console.log(`Staff account created for ${email.trim().toLowerCase()}.`); }
catch { console.error('That email already has an account.'); process.exit(1); }
