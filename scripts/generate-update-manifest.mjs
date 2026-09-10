#!/usr/bin/env node
/**
 * STUXS Music — Release Helper: Update Manifest Generator
 *
 * Usage:
 *   node scripts/generate-update-manifest.mjs \
 *     --apk android/app/build/outputs/apk/release/app-release.apk \
 *     --username <GITHUB_USERNAME> \
 *     --repo <GITHUB_RELEASE_REPO> \
 *     --tag v2.0 \
 *     --filename STUXS-Music-2.0.apk \
 *     [--version 2.0] [--code 5] [--out docs/update.json]
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      options[key] = val;
    }
  }
  return options;
}

const opts = parseArgs();
const apkPath = opts.apk || 'android/app/build/outputs/apk/release/app-release-unsigned.apk';

if (!fs.existsSync(apkPath)) {
  console.error(`APK file not found: ${apkPath}`);
  process.exit(1);
}

const buf = fs.readFileSync(apkPath);
const size = buf.length;
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

const username = opts.username || 'aayushpatil826-creator';
const repo = opts.repo || 'STUXS-Music';
const tag = opts.tag || '<RELEASE_TAG>';
const filename = opts.filename || path.basename(apkPath);
const version = opts.version || '2.0';
const code = parseInt(opts.code, 10) || 5;

const manifest = {
  latestVersion: version,
  latestVersionCode: code,
  minimumSupportedVersionCode: 1,
  releaseDate: new Date().toISOString().split('T')[0],
  apkUrl: `https://github.com/${username}/${repo}/releases/download/${tag}/${filename}`,
  apkSize: size,
  sha256: sha256,
  mandatory: false,
  title: `STUXS Music ${version}`,
  releaseNotes: [
    'Smooth playlist scrolling with zero layout shifts and async artwork rendering',
    'Real Indian Trending charts powered by JioSaavn and Gaana',
    'Strict STUXS catalog exclusion from trending candidate pool',
    'Home Carousel and Dedicated See All Trending parity',
    'Native Media3 playback performance optimizations'
  ]
};

const outPath = opts.out || 'docs/update.json';
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));

console.log('Generated update manifest:');
console.log(JSON.stringify(manifest, null, 2));
console.log(`Saved to: ${outPath}`);
