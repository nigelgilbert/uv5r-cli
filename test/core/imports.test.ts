import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../../src/', import.meta.url);
const TEST = new URL('../', import.meta.url);
const INDEX = new URL('core/index.ts', SRC).href;
const FAKE = new URL('core/fake.ts', TEST).href;
const SPECIFIER = /\b(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)|\bimport\s*['"`]([^'"`]+)['"`]/g;

function readSpecifiers(dir: URL): { file: URL; specifiers: string[] }[] {
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
  expect(files.length).toBeGreaterThan(0);
  return files.map((f) => {
    const file = new URL(f, dir);
    const text = readFileSync(file, 'utf8');
    const specifiers = [...text.matchAll(SPECIFIER)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
    return { file, specifiers };
  });
}

describe('core imports', () => {
  it('imports nothing from cli', () => {
    for (const { file, specifiers } of readSpecifiers(new URL('core/', SRC))) {
      expect(specifiers.filter((s) => s.includes('cli/')), file.pathname).toEqual([]);
    }
  });

  it('cli imports core only through index.ts', () => {
    for (const dir of [new URL('cli/', SRC), new URL('cli/', TEST)]) {
      for (const { file, specifiers } of readSpecifiers(dir)) {
        const stray = specifiers.filter((s) => s.includes('core/') && ![INDEX, FAKE].includes(new URL(s, file).href));
        expect(stray, file.pathname).toEqual([]);
      }
    }
  });
});
