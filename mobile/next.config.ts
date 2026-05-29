import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // next-pwa는 Turbopack과 충돌 — 수동 PWA(manifest.json + sw.js)로 처리
};

export default nextConfig;
