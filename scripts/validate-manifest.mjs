#!/usr/bin/env node
/**
 * Manifest validator: enforces least-privilege & structural expectations.
 * Exits non‑zero on violation (CI will fail).
 */
import fs from 'fs';

const ALLOWED_PERMISSIONS = new Set([
  'activeTab',
  'scripting',
  'downloads',
  'storage'
]);

const ALLOWED_HOST_PATTERNS = [
  'https://generativelanguage.googleapis.com/*',
  'https://inference.do-ai.run/*'
];

const REQUIRED_FIELDS = ['manifest_version', 'name', 'version', 'action', 'background'];

function fail(msg) {
  console.error('[manifest:invalid]', msg);
  process.exit(1);
}

function warn(msg) {
  console.warn('[manifest:warn]', msg);
}

function main() {
  const path = 'manifest.json';
  if (!fs.existsSync(path)) fail('manifest.json not found');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (e) {
    fail('manifest.json parse error: ' + e.message);
  }

  // Basic required fields
  for (const f of REQUIRED_FIELDS) {
    if (!(f in manifest)) fail(`Missing required field: ${f}`);
  }
  if (manifest.manifest_version !== 3) fail('manifest_version must be 3');

  // Permissions
  const perms = manifest.permissions || [];
  for (const p of perms) {
    if (!ALLOWED_PERMISSIONS.has(p)) {
      fail(`Disallowed permission detected: ${p}`);
    }
  }

  // Host permissions allowlist
  const hostPerms = manifest.host_permissions || [];
  for (const hp of hostPerms) {
    if (!ALLOWED_HOST_PATTERNS.includes(hp)) {
      fail(`Host permission not in allowlist: ${hp}`);
    }
  }

  // Background service worker should point to dist/background.js after swap
  if (!manifest.background ||
      !manifest.background.service_worker ||
      !/^dist\/background\.js$/.test(manifest.background.service_worker)) {
    fail('background.service_worker must be "dist/background.js" post-swap');
  }

  // Content scripts should reference dist/content.js
  const cs = manifest.content_scripts || [];
  if (!cs.length) fail('No content_scripts entry');
  const first = cs[0];
  if (!first.js || !first.js.includes('dist/content.js')) {
    fail('content script must include "dist/content.js"');
  }

  // Popup HTML must remain popup.html
  if (!manifest.action || manifest.action.default_popup !== 'popup.html') {
    fail('action.default_popup must be popup.html');
  }

  // CSP sanity
  if (manifest.content_security_policy?.extension_pages) {
    const csp = manifest.content_security_policy.extension_pages;
    if (/unsafe-inline/.test(csp) || /unsafe-eval/.test(csp)) {
      fail('CSP must not contain unsafe-inline or unsafe-eval');
    }
  } else {
    warn('No extension_pages CSP found');
  }

  console.log('[manifest:ok] Validation passed');
}

main();
