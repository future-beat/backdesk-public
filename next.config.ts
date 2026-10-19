import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root to this repo. Without it Turbopack walks upward,
    // finds an unrelated package-lock.json in the home directory, and infers a
    // root outside the git repository.
    root: path.resolve(__dirname),
  },
  experimental: {
    serverActions: {
      // The public audit form's optional Job List upload (09-03, LAND-02).
      // Server Actions default to a 1 MB body, which rejects every real export;
      // Vercel Functions reject any body over 4.5 MB with a 413 raised before
      // the action runs, so the ceiling is not ours to raise. 4,400 kB is the
      // 4 MiB app cap (AUDIT_CSV_MAX_BYTES) plus room for the 10-20 KB that
      // multipart/form-data adds around it, and still under the platform's
      // limit — so a file this app accepts is a file the platform will carry,
      // and an oversized one meets OUR sentence rather than Vercel's error page.
      bodySizeLimit: '4400kb',
    },
  },
};

export default nextConfig;
