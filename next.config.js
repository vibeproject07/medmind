const { PHASE_DEVELOPMENT_SERVER } = require('next/constants')

/** @type {import('next').NextConfig} */
module.exports = (phase) => {
  const nextConfig = {
    // Keep dev assets separate from production builds. Sharing `.next` lets a
    // build replace chunks while the dev server still references them.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
    reactStrictMode: true,
    experimental: {
      serverActions: {
        bodySizeLimit: '50mb',
      },
    },
    // Replit/containers: evita ENOSPC do inotify (Watchpack)
    webpack: (config, { dev }) => {
      if (dev) {
        config.watchOptions = {
          ...(config.watchOptions || {}),
          poll: 1000,
          aggregateTimeout: 300,
          ignored: ['**/node_modules/**', '**/.git/**', '**/.next-dev/**'],
        };
      }
      return config;
    },
  }

  return nextConfig
}

