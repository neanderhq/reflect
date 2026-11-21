import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

export default function config(phase: string): NextConfig {
  const development = phase === PHASE_DEVELOPMENT_SERVER;
  const evalSources = development ? " 'unsafe-eval'" : '';
  return {
    output: 'standalone',
    outputFileTracingExcludes: {'/*':['./.pglite/**/*','./.test-data/**/*','./.env','./.env.*']},
    serverExternalPackages: ['pg', '@electric-sql/pglite'],
    async headers() {
      return [{
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Content-Security-Policy',
            value: `default-src 'self'; script-src 'self' 'unsafe-inline'${evalSources}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      }];
    },
  };
}
