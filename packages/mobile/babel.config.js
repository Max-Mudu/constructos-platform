module.exports = function(api) {
  api.cache(true);

  // babel-preset-expo (SDK 54+) adds the react-native-worklets plugin
  // automatically when that package is installed, so it is not listed here.
  return {
    presets: ['babel-preset-expo'],
  };
};
