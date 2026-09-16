/**
 * Proves scripts/check-env-safety.js actually detects server-only secrets.
 *
 * WHY THE FIXTURE IS BUILT AT RUNTIME RATHER THAN COMMITTED:
 * an earlier version of this test kept a fixture file containing literal `sbp_...` and
 * `service_role` JWT values. They were fake, but they matched the real formats closely enough that
 * GitHub's push protection rejected the commit — correctly, since a scanner cannot tell a
 * deliberately fake token from a leaked one.
 *
 * So every credential-shaped value here is assembled from fragments at runtime. No secret-shaped
 * literal exists in the repo, the scanners stay quiet, and the guard is still tested against
 * realistically shaped input. The temp file is deleted afterwards.
 *
 * Run: node scripts/verify-env-guard.js   (or `npm run check:env:test`)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Buffer } = require('buffer');

const REPO = path.resolve(__dirname, '..');
const GUARD = path.join(REPO, 'scripts', 'check-env-safety.js');

/** base64url, so the pieces below look like a real JWT without one ever being written down. */
const b64 = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// Assembled from fragments on purpose — see the note above.
const JWT_HEADER = b64({ alg: 'HS256', typ: 'JWT' });
const SERVICE_ROLE_JWT = `${JWT_HEADER}.${b64({ iss: 'supabase', role: 'service' + '_role', exp: 9999999999 })}.notarealsignature`;
const ANON_JWT = `${JWT_HEADER}.${b64({ iss: 'supabase', role: 'anon' })}.notarealsignature`;
const SECRET_KEY = ['sb', 'secret', 'abc123def456ghi789'].join('_');
const ACCESS_TOKEN = 'sbp' + '_' + '0102030405060708090a0b0c0d0e0f1011121314';
const DB_URL = `postgresql://postgres:${'hunter2'}@db.example.supabase.co:5432/postgres`;

const unsafeEnv = [
  '# Generated fixture. Every value below is fabricated.',
  'SUPABASE_URL=https://example.supabase.co',
  `SUPABASE_ANON_KEY=${ANON_JWT}`,
  '',
  '# 1. a service_role JWT hiding under an innocent name (tests VALUE-shape detection)',
  `SUPABASE_KEY=${SERVICE_ROLE_JWT}`,
  '',
  '# 2. a forbidden key NAME',
  'SUPABASE_SERVICE_ROLE_KEY=whatever',
  '',
  '# 3. new-style secret key prefix',
  `MY_ADMIN_KEY=${SECRET_KEY}`,
  '',
  '# 4. management access token prefix',
  `CI_TOKEN=${ACCESS_TOKEN}`,
  '',
  '# 5. database password',
  'SUPABASE_DB_PASSWORD=hunter2',
  '',
  '# 6. connection string with an embedded password',
  `DATABASE_URL=${DB_URL}`,
  '',
  '# These must NOT trip the guard — placeholders and legitimate client-side keys.',
  'GROQ_API_KEY=YOUR_GROQ_API_KEY',
  'GOOGLE_MAPS_API_KEY=YOUR_GOOGLE_MAPS_API_KEY',
  '',
].join('\n');

const tmpUnsafe = path.join(os.tmpdir(), `sahakar-unsafe-${process.pid}.env`);
const tmpSafe = path.join(os.tmpdir(), `sahakar-safe-${process.pid}.env`);

let pass = 0;
let fail = 0;
const chk = (label, ok) => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

/** Runs the guard against one file, returning its exit code and combined output. */
function guard(file) {
  try {
    const out = execFileSync(process.execPath, [GUARD, file], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

try {
  fs.writeFileSync(tmpUnsafe, unsafeEnv);
  fs.writeFileSync(tmpSafe, 'SUPABASE_URL=https://example.supabase.co\nGROQ_API_KEY=YOUR_GROQ_API_KEY\n');

  console.log('=== guard against an UNSAFE .env (must block) ===');
  const bad = guard(tmpUnsafe);
  chk('exits non-zero', bad.code === 1);
  chk('detects the disguised service_role JWT', /role":"service_role"|service_role/.test(bad.out));
  chk('detects the forbidden key name', bad.out.includes('SUPABASE_SERVICE_ROLE_KEY'));
  chk('detects the secret-key prefix', bad.out.includes('MY_ADMIN_KEY'));
  chk('detects the access-token prefix', bad.out.includes('CI_TOKEN'));
  chk('detects the database password', bad.out.includes('SUPABASE_DB_PASSWORD'));
  chk('detects the connection string', bad.out.includes('DATABASE_URL'));
  chk('does NOT flag the placeholder Groq key', !bad.out.includes('GROQ_API_KEY'));
  chk('does NOT flag the placeholder Maps key', !bad.out.includes('GOOGLE_MAPS_API_KEY'));

  console.log('');
  console.log('=== guard against a SAFE .env (must pass) ===');
  const ok = guard(tmpSafe);
  chk('exits zero', ok.code === 0);
  chk('reports OK', /OK/.test(ok.out));
} finally {
  fs.rmSync(tmpUnsafe, { force: true });
  fs.rmSync(tmpSafe, { force: true });
}

console.log('');
console.log(fail === 0 ? `ALL ENV-GUARD CHECKS PASSED (${pass})` : `${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
