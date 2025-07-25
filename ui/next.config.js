/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Custom app directory for our UI
  distDir: '.next',
}

module.exports = nextConfig