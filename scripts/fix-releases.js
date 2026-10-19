#!/usr/bin/env node
/**
 * Post-build cleanup for Squirrel's RELEASES manifest.
 *
 * Squirrel writes RELEASES as UTF-8 with a BOM and CRLF line endings. Uploading that
 * verbatim works for Squirrel's own reader, but a BOM in the first token (the package
 * SHA-1) is a common source of "update not detected" issues with other tooling, so we
 * normalise every generated manifest to plain ASCII with LF endings.
 *
 * Runs automatically after `make` / `make:prod` / `make:staging` / `make:local`.
 */
const fs = require('fs');
const path = require('path');

const BOM = '\uFEFF';

function findReleases(dir, found = []) {
  if (!fs.existsSync(dir)) return found;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findReleases(full, found);
    } else if (entry.name === 'RELEASES') {
      found.push(full);
    }
  }

  return found;
}

function cleanFile(file) {
  const raw = fs.readFileSync(file, 'utf8');

  let clean = raw.startsWith(BOM) ? raw.slice(1) : raw;
  clean = clean.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!clean.endsWith('\n')) clean += '\n';

  if (clean === raw) {
    console.log(`[fix-releases] already clean: ${file}`);
    return false;
  }

  fs.writeFileSync(file, clean, { encoding: 'utf8' });
  console.log(`[fix-releases] normalised: ${file}`);
  return true;
}

const makeDir = path.join(__dirname, '..', 'out', 'make');
const files = findReleases(makeDir);

if (files.length === 0) {
  console.log(`[fix-releases] no RELEASES file found under ${makeDir} (nothing to do)`);
  process.exit(0);
}

files.forEach(cleanFile);
