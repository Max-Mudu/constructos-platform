/**
 * Expo config plugin: set `android:gwpAsanMode` on the <application> element.
 *
 * Why this exists
 * ---------------
 * Since Android 14, apps that leave `android:gwpAsanMode` unset get
 * "Recoverable GWP-ASan" on roughly 1% of launches. When GWP-ASan frees a
 * sampled allocation it records a backtrace with bionic's frame-pointer
 * walker (`android_unsafe_frame_pointer_chase`).
 *
 * Hermes compiles `eval()`d source (react-native-worklets evaluates worklet
 * code this way in release builds, on the UI thread) on a separate fiber
 * stack (hermes::StackExecutor, boost.context). The x86_64 Hermes library is
 * built without frame pointers, so rbp holds unrelated data. The walker's
 * only upper bound is the thread's real stack top, which sits far above
 * the fiber stack, so the walk follows that data into a guard page and the
 * process dies with SIGSEGV about 3 s after launch.
 *
 * The crash is inside the platform's diagnostic unwinder, not in app memory
 * handling. Opting the app out of GWP-ASan removes that code path. The app
 * ships no first-party native code that GWP-ASan reports would help debug.
 *
 * Evidence and reproduction counts are in the Android startup crash report
 * referenced in the pull request that introduced this plugin.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const VALID_MODES = ['always', 'never', 'default'];

/**
 * Pure helper: returns the manifest with android:gwpAsanMode set on
 * <application>. Exported for unit tests.
 */
function setGwpAsanMode(androidManifest, mode) {
  if (!VALID_MODES.includes(mode)) {
    throw new Error(
      `withAndroidGwpAsanMode: mode must be one of ${VALID_MODES.join(', ')} (got ${JSON.stringify(mode)})`,
    );
  }
  const manifest = androidManifest && androidManifest.manifest;
  const apps = manifest && manifest.application;
  if (!Array.isArray(apps) || apps.length === 0) {
    throw new Error('withAndroidGwpAsanMode: AndroidManifest has no <application> element');
  }
  for (const app of apps) {
    app.$ = app.$ || {};
    app.$['android:gwpAsanMode'] = mode;
  }
  return androidManifest;
}

function withAndroidGwpAsanMode(config, props) {
  const mode = (props && props.mode) || 'never';
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults = setGwpAsanMode(cfg.modResults, mode);
    return cfg;
  });
}

module.exports = withAndroidGwpAsanMode;
module.exports.setGwpAsanMode = setGwpAsanMode;
module.exports.VALID_MODES = VALID_MODES;
