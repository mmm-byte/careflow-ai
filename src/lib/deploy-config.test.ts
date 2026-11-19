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

test('vercel.json points the output directory at the Next.js build directory', () => {
  // Vercel's Next.js builder resolves the directory it reads build manifests
  // from as `config.outputDirectory || '.next'`. It detects the static export
  // separately, by reading `.next/export-detail.json`, and then uploads the
  // exported files from `out/`.
  //
  // The output directory therefore has to stay `.next`. Pointing it at `out`
  // breaks the build with NEXT_NO_ROUTES_MANIFEST, because the manifests stay
  // in `.next` while the exported files live in `out`.
  //
  // The value is set explicitly rather than left unset, because the Project
  // Settings dashboard may still hold a stale "out" value from before the
  // static export was configured. `vercel.json` takes precedence over the
  // dashboard, so stating `.next` here overrides that stale setting and makes
  // the build reproducible from a fresh import.
  assert.equal(
    vercelConfig.outputDirectory,
    '.next',
    '"outputDirectory" must be ".next" so the builder reads the manifests it needs',
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
