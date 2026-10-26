import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hides the floating Next.js dev badge that overlapped the bottom-left of
  // the UI. Development only — it never renders in a production build.
  devIndicators: false,
};

export default nextConfig;
