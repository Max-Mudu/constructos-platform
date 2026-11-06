// Learn more: https://docs.expo.dev/guides/monorepos/
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// This app shares an npm workspace with packages/web, which stays on React 18.
// npm therefore keeps react@18 at the repository root and installs this app's
// React 19 / React Native under packages/mobile/node_modules. A dependency that
// npm hoisted to the root (for example zustand) would otherwise resolve the
// root react@18 and put a second React copy in the bundle. Resolve these
// singletons as if they were imported from this package, so the bundle always
// uses the versions declared in packages/mobile/package.json.
const SINGLETONS = ['react', 'react-native'];
const projectOrigin = path.join(__dirname, 'package.json');

function isSingleton(moduleName) {
  return SINGLETONS.some((name) => moduleName === name || moduleName.startsWith(`${name}/`));
}

const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolveRequest ?? context.resolveRequest;
  if (isSingleton(moduleName)) {
    return resolve({ ...context, originModulePath: projectOrigin }, moduleName, platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
