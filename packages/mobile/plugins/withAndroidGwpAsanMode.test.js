// Run: node --test plugins/   (from packages/mobile)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const plugin = require('./withAndroidGwpAsanMode');
const { setGwpAsanMode } = plugin;

const PLUGIN_PATH = './plugins/withAndroidGwpAsanMode';

function sampleManifest() {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [{ $: { 'android:name': '.MainApplication' }, activity: [] }],
    },
  };
}

test('setGwpAsanMode sets android:gwpAsanMode on <application> and keeps other attributes', () => {
  const out = setGwpAsanMode(sampleManifest(), 'never');
  const app = out.manifest.application[0];
  assert.equal(app.$['android:gwpAsanMode'], 'never');
  assert.equal(app.$['android:name'], '.MainApplication');
});

test('setGwpAsanMode creates the attribute bag when <application> has none', () => {
  const m = { manifest: { application: [{}] } };
  assert.equal(setGwpAsanMode(m, 'never').manifest.application[0].$['android:gwpAsanMode'], 'never');
});

test('setGwpAsanMode rejects unknown modes and manifests without <application>', () => {
  assert.throws(() => setGwpAsanMode(sampleManifest(), 'off'), /mode must be one of/);
  assert.throws(() => setGwpAsanMode({ manifest: {} }, 'never'), /no <application>/);
});

test('plugin registers an android manifest mod that applies the mode (default: never)', async () => {
  const config = plugin({ name: 'x', slug: 'x' }, undefined);
  const mod = config.mods && config.mods.android && config.mods.android.manifest;
  assert.equal(typeof mod, 'function', 'expected an android.manifest mod');
  const result = await mod({ ...config, modResults: sampleManifest(), modRequest: { platform: 'android' } });
  assert.equal(result.modResults.manifest.application[0].$['android:gwpAsanMode'], 'never');
});

test('app.json registers the plugin with mode "never"', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'));
  const entry = appJson.expo.plugins.find(
    (p) => (Array.isArray(p) ? p[0] : p) === PLUGIN_PATH,
  );
  assert.ok(entry, `app.json expo.plugins must include ${PLUGIN_PATH}`);
  assert.ok(Array.isArray(entry), 'plugin entry must pass options');
  assert.equal(entry[1].mode, 'never');
});
