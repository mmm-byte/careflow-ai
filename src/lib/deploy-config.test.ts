import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const readRepoFile = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)), 'utf8');

const vercelConfig = JSON.parse(readRepoFile('vercel.json')) as {
  outputDirectory?: string | null;
  buildCommand?: string;
  installCommand?: string;
  framework?: string;
};

const nextConfig = readRepoFile('next.config.ts');

test('the build is a static export', () => {
  assert.match(nextConfig, /output:\s*["']export["']/);
});

test('vercel.json does not override the output directory', () => {
  // Vercel's Next.js builder resolves the directory it reads build manifests
  // from as `config.outputDirectory || '.next'`, but it detects the static export
  // separately by reading `.next/export-detail.json`. Pointing the output
  // directory at `out` therefore breaks the build with NEXT_NO_ROUTES_MANIFEST,
  // because the manifests stay in `.next` while the exported files live in `out`.
  assert.equal(
    vercelConfig.outputDirectory,
    undefined,
    'setting "outputDirectory" breaks the Vercel build for a static export',
  );
});

test('vercel.json pins the commands the deployment needs', () => {
  assert.equal(vercelConfig.framework, 'nextjs');
  assert.equal(vercelConfig.buildCommand, 'npm run build');
  assert.equal(vercelConfig.installCommand, 'npm ci');
});

test('vercel.json skips the CUDA download that breaks the Linux install', () => {
  const config = JSON.parse(readRepoFile('vercel.json')) as {
    build?: { env?: Record<string, string> };
  };
  assert.equal(config.build?.env?.ONNXRUNTIME_NODE_INSTALL_CUDA, 'skip');
});
