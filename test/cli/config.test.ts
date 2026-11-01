import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, readStation, resolveConfigPath } from '../../src/cli/config.ts';
import { UsageError } from '../../src/core/index.ts';

/** Write `text` to a config file in a fresh temp dir and return its path. */
function configFile(text: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'uv5r.json');
  writeFileSync(file, text);
  return file;
}

/** Return the UsageError `readStation` throws for `path`. */
function failure(path: string, required: boolean): UsageError {
  try {
    readStation(path, { required });
  } catch (err) {
    if (err instanceof UsageError) return err;
    throw err;
  }
  throw new Error('readStation accepted the file');
}

describe('resolveConfigPath', () => {
  it('takes --config first', () => {
    expect(resolveConfigPath('a.json', { UV5R_CONFIG: 'b.json' })).toEqual({ path: 'a.json', required: true });
  });

  it('takes UV5R_CONFIG without --config', () => {
    expect(resolveConfigPath(undefined, { UV5R_CONFIG: 'b.json' })).toEqual({ path: 'b.json', required: true });
  });

  it('falls back to uv5r.json at the repo root', () => {
    const repoDefault = fileURLToPath(new URL('../../uv5r.json', import.meta.url));
    expect(DEFAULT_CONFIG).toBe(repoDefault);
    expect(resolveConfigPath(undefined, {})).toEqual({ path: repoDefault, required: false });
    expect(resolveConfigPath(undefined, { UV5R_CONFIG: '' })).toEqual({ path: repoDefault, required: false });
  });
});

describe('readStation', () => {
  it('reads the station and ignores unknown keys', () => {
    const file = configFile(JSON.stringify({ callsign: 'kj7abc', outputDevice: 'AIOC Audio', grid: 'DN45' }));
    expect(readStation(file, { required: true })).toEqual({ callsign: 'KJ7ABC', outputDevice: 'AIOC Audio' });
  });

  it('reads the committed example', () => {
    const example = fileURLToPath(new URL('../../uv5r.example.json', import.meta.url));
    expect(readStation(example, { required: true })).toEqual({
      callsign: 'KJ7ABC',
      outputDevice: 'AIOC Audio',
      inputDevice: 'AIOC Audio',
      model: 'models/ggml-base.en-q5_1.bin',
      voice: 'Samantha',
      leadMs: 300,
      tailMs: 400,
      maxSeconds: 30,
    });
  });

  it('returns an empty station for a missing file at the default path', () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'uv5r.json');
    expect(readStation(missing, { required: false })).toEqual({});
  });

  it('exits 2 for a missing file named by --config or UV5R_CONFIG', () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'uv5r.json');
    const err = failure(missing, true);
    expect(err.reason).toBe('invalid-argument');
    expect(err.detail.file).toBe(missing);
  });

  it.each([['{"callsign": "KJ7ABC",'], [''], ['not json']])('exits 2 on the malformed file %j', (text) => {
    const file = configFile(text);
    for (const required of [true, false]) {
      const err = failure(file, required);
      expect(err.reason).toBe('invalid-argument');
      expect(err.message).toContain('is not JSON');
      expect(err.detail.file).toBe(file);
    }
  });

  it('exits 2 on a key of the wrong type and names the field and file', () => {
    const file = configFile(JSON.stringify({ callsign: 7 }));
    const err = failure(file, false);
    expect(err.reason).toBe('invalid-argument');
    expect(err.detail).toMatchObject({ field: 'callsign', file });
  });
});
