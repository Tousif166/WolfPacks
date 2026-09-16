/**
 * Fails the build if a server-only secret has been put into `.env`.
 *
 * WHY THIS GUARD EXISTS
 * ---------------------
 * `android/app/build.gradle` applies react-native-config's dotenv.gradle, which compiles every key
 * in `.env` into the Android build. Anything in that file ships inside the APK and is extractable —
 * verified on this project, where GROQ_API_KEY was recovered from the release bundle.
 *
 * A service-role key bypasses Row Level Security entirely, so leaking one hands out full read/write
 * access to every user's data. The mistake is easy to make (it looks like just another Supabase key)
 * and completely invisible once made, because the app keeps working. Hence a check rather than a
 * comment.
 *
 * Server-only credentials belong in `.env.tooling.local` — see `.env.tooling.local.example`.
 *
 * Run: node scripts/check-env-safety.js   (or `npm run check:env`)
 * Exit code 1 on any finding, so it can gate a build or a commit hook.
 */

const fs = require('fs');
const path = require('path');
// Imported explicitly rather than used as a global: this repo's eslint config targets React Native,
// where Buffer is not a defined global.
const { Buffer } = require('buffer');

const REPO = path.resolve(__dirname, '..');
// Defaults to the repo's .env. An explicit path can be passed so this can be exercised against a
// fixture without ever writing to the real .env.
const ENV_FILE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(REPO, '.env');

/** Key NAMES that must never appear in .env, with why. */
const FORBIDDEN_KEYS = [
  ['SUPABASE_SERVICE_ROLE_KEY', 'bypasses Row Level Security for every table'],
  ['SUPABASE_SECRET_KEY', 'bypasses Row Level Security for every table'],
  ['SERVICE_ROLE_KEY', 'bypasses Row Level Security for every table'],
  ['SUPABASE_DB_PASSWORD', 'grants direct Postgres access'],
  ['SUPABASE_ACCESS_TOKEN', 'grants management-API access to your whole account'],
  ['DATABASE_URL', 'usually embeds the Postgres password'],
];

/**
 * Value SHAPES that give away a server-only credential even under an innocent key name.
 * Someone pasting a service-role key as `SUPABASE_KEY=` would defeat a name-only check.
 */
const FORBIDDEN_VALUE_PATTERNS = [
  [/^sb_secret_/, 'Supabase secret key (sb_secret_ prefix)'],
  [/^sbp_/, 'Supabase personal access token (sbp_ prefix)'],
  [/^postgres(ql)?:\/\/[^@]*:[^@]+@/, 'Postgres connection string containing a password'],
];

/** A Supabase JWT whose payload declares the service_role. */
function isServiceRoleJwt(value) {
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    return payload.role === 'service_role';
  } catch {
    return false; // not a decodable JWT; other checks still apply
  }
}

if (!fs.existsSync(ENV_FILE)) {
  console.log('check-env-safety: no .env file, nothing to check.');
  process.exit(0);
}

const findings = [];
const lines = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);

lines.forEach((raw, i) => {
  const line = raw.trim();
  if (!line || line.startsWith('#')) return;

  const eq = line.indexOf('=');
  if (eq === -1) return;

  const key = line.slice(0, eq).trim().toUpperCase();
  const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');

  const lineNo = i + 1;

  const forbidden = FORBIDDEN_KEYS.find(([k]) => key === k);
  if (forbidden) {
    findings.push({ lineNo, key, reason: forbidden[1] });
  }

  // Ignore obvious placeholders so a fresh copy of .env.example never trips this.
  const isPlaceholder = !value || /^YOUR_|^your-|^<|^changeme$/i.test(value);
  if (isPlaceholder) return;

  FORBIDDEN_VALUE_PATTERNS.forEach(([re, why]) => {
    if (re.test(value)) findings.push({ lineNo, key, reason: why });
  });

  if (isServiceRoleJwt(value)) {
    findings.push({ lineNo, key, reason: 'JWT with "role":"service_role" in its payload' });
  }
});

if (findings.length === 0) {
  console.log('check-env-safety: OK — no server-only secrets found in .env');
  process.exit(0);
}

console.error('');
console.error('=============================================================');
console.error(' SERVER-ONLY SECRET FOUND IN .env — REFUSING TO CONTINUE');
console.error('=============================================================');
console.error('');
console.error('Every key in .env is compiled into the Android build by');
console.error('react-native-config and is extractable from the shipped APK.');
console.error('');

// Deduplicate: a single line can trip both a name and a value rule.
const seen = new Set();
findings.forEach(({ lineNo, key, reason }) => {
  const id = `${lineNo}:${key}:${reason}`;
  if (seen.has(id)) return;
  seen.add(id);
  console.error(`  .env line ${lineNo}  ${key}`);
  console.error(`      -> ${reason}`);
});

console.error('');
console.error('Move these to .env.tooling.local (gitignored, and NOT read by the');
console.error('Android build). See .env.tooling.local.example.');
console.error('');
console.error('If one of these has already shipped in an APK, rotate it in the');
console.error('Supabase dashboard — assume it is compromised.');
console.error('');

process.exit(1);
