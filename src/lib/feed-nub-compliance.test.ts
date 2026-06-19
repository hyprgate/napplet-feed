import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceExtensions = new Set(['.ts', '.svelte']);

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(path));
      continue;
    }
    if (!sourceExtensions.has(path.slice(path.lastIndexOf('.')))) continue;
    if (path.endsWith('.test.ts')) continue;
    files.push(path);
  }
  return files;
}

describe('Feed NUB data retrieval compliance', () => {
  it('does not use one-shot relay queries or direct network retrieval in runtime source', () => {
    const offenders: string[] = [];

    for (const file of collectSourceFiles(srcDir)) {
      const source = readFileSync(file, 'utf8');
      if (/\brelay\.query\b/.test(source)) offenders.push(`${file}: relay.query`);
      if (/\bnew\s+RelayPool\b/.test(source)) offenders.push(`${file}: direct RelayPool`);
      if (/\bfetch\s*\(/.test(source)) offenders.push(`${file}: fetch`);
      if (/\bnew\s+WebSocket\s*\(/.test(source)) offenders.push(`${file}: WebSocket`);
    }

    expect(offenders).toEqual([]);
  });
});
