const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Force CJS field resolution order so zustand's .mjs ESM builds (which use
// import.meta.env for Redux DevTools mode detection) are never picked.
// Metro must resolve the CommonJS build instead.
config.resolver.unstable_enablePackageExports = false;

// Alias zustand's ESM entry points to their CJS equivalents
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'zustand/middleware': path.resolve(__dirname, 'node_modules/zustand/middleware'),
  'zustand/react':     path.resolve(__dirname, 'node_modules/zustand/react'),
  'zustand':           path.resolve(__dirname, 'node_modules/zustand/index'),
};

// Keep react-devtools-core stubbed on web
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web') {
    const fromDevtools = context.originModulePath?.includes('react-devtools-core') ?? false;
    const isDevtools = moduleName.includes('react-devtools-core');
    if (isDevtools || fromDevtools) {
      return { type: 'empty' };
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
