import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CORE = new URL('../../src/core/', import.meta.url);
const SPECIFIER = /\b(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

describe('core imports', () => {
  it('imports nothing from cli', () => {
    const files = readdirSync(CORE).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(new URL(file, CORE), 'utf8');
      const specifiers = [...text.matchAll(SPECIFIER)].map((m) => m[1] ?? m[2]);
      expect(specifiers.filter((s) => s?.includes('cli/')), file).toEqual([]);
    }
  });
});
