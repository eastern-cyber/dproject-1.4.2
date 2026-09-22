/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  webpack: (config) => {
    const { IgnorePlugin } = require('webpack');

    // Existing: suppress thread-stream warning
    config.plugins.push(
      new IgnorePlugin({
        resourceRegExp: /[\\/]thread-stream[\\/]/,
      })
    );

    // Ignore optional x402 subpath imports from @coinbase/cdp-sdk
    config.plugins.push(
      new IgnorePlugin({
        resourceRegExp: /^@x402\/(core|evm|svm)\//,
      })
    );

    return config;
  },
};

module.exports = nextConfig;