#!/usr/bin/env node
/**
 * Thin wrapper around the locally downloaded Supabase CLI binary.
 *
 * WHY A WRAPPER RATHER THAN A DIRECT PATH IN package.json:
 * npm runs scripts through cmd.exe on Windows, which will not resolve a forward-slash path like
 * `tools/supabase/supabase.exe`. Hardcoding backslashes instead would break on macOS/Linux. Doing
 * the resolution in Node keeps one script that works everywhere.
 *
 * The binary is NOT committed (54 MB, and platform-specific) — `tools/` is gitignored. If it is
 * missing, this prints the exact command to fetch it rather than failing cryptically.
 *
 * Usage:  npm run supabase -- <args>
 *   e.g.  npm run supabase -- --version
 *         npm run supabase -- login
 *         npm run supabase -- link --project-ref <ref>
 *         npm run supabase -- db push
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const CLI_VERSION = '2.117.0';
const TOOLING_ENV = path.join(REPO, '.env.tooling.local');

/**
 * Loads `.env.tooling.local` into this process's environment.
 *
 * WHY: the Supabase CLI reads SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD from the environment.
 * Sourcing them from a gitignored file means they never appear on a command line (so never in shell
 * history, never in a process list, and never pasted into a chat), and `supabase login` becomes
 * unnecessary — which matters because that flow is interactive and cannot be automated.
 *
 * Values already set in the real environment win, so CI can override without editing the file.
 * Empty values are skipped so a half-filled template doesn't shadow a working env var.
 */
function loadToolingEnv() {
  if (!fs.existsSync(TOOLING_ENV)) return [];

  const loaded = [];
  fs.readFileSync(TOOLING_ENV, 'utf8').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;

    const eq = line.indexOf('=');
    if (eq === -1) return;

    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!value) return;
    if (process.env[key]) return;

    process.env[key] = value;
    loaded.push(key);
  });
  return loaded;
}

const binary = process.platform === 'win32'
  ? path.join(REPO, 'tools', 'supabase', 'supabase.exe')
  : path.join(REPO, 'tools', 'supabase', 'supabase');

if (!fs.existsSync(binary)) {
  const asset = process.platform === 'win32'
    ? `supabase_${CLI_VERSION}_windows_amd64.zip`
    : `supabase_${CLI_VERSION}_${process.platform}_amd64.tar.gz`;

  console.error('');
  console.error(`Supabase CLI not found at ${binary}`);
  console.error('');
  console.error('It is a ~54 MB platform binary, deliberately not committed. Fetch it with:');
  console.error('');
  console.error(`  curl.exe -L --retry 8 --retry-all-errors -o tools\\supabase-cli.zip \\`);
  console.error(`    https://github.com/supabase/cli/releases/download/v${CLI_VERSION}/${asset}`);
  console.error('  Expand-Archive tools\\supabase-cli.zip tools\\supabase -Force');
  console.error('');
  console.error('(The npm package `supabase` also works, but its postinstall download stalled on');
  console.error(' this machine — curl with --retry was reliable.)');
  console.error('');
  process.exit(1);
}

const loaded = loadToolingEnv();

// Report only the NAMES that were picked up, never the values.
if (loaded.length) {
  console.error(`[supabase-cli] loaded from .env.tooling.local: ${loaded.join(', ')}`);
}
if (!process.env.SUPABASE_ACCESS_TOKEN) {
  console.error(
    '[supabase-cli] no SUPABASE_ACCESS_TOKEN found — most commands will fail.\n' +
      '               Create one at https://supabase.com/dashboard/account/tokens\n' +
      '               and paste it into .env.tooling.local',
  );
}

const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (err) => {
  console.error(`Failed to run the Supabase CLI: ${err.message}`);
  process.exit(1);
});
