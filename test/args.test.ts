import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.ts';
import { UsageError } from '../src/errors.ts';

const BOOLEAN_FLAGS = new Set(['json', 'help', 'narrow', 'low-power', 'force']);

describe('parseArgs', () => {
  it('rejects a value on a boolean flag', () => {
    expect(() => parseArgs(['restore', 'x.img', '--force=no'], BOOLEAN_FLAGS)).toThrow(UsageError);
    expect(() => parseArgs(['restore', 'x.img', '--force=no'], BOOLEAN_FLAGS)).toThrow('--force takes no value');
    expect(() => parseArgs(['tune', '146.52', '--narrow=false'], BOOLEAN_FLAGS)).toThrow(UsageError);
    expect(() => parseArgs(['status', '--json='], BOOLEAN_FLAGS)).toThrow(UsageError);
  });

  it('sets a bare boolean flag to true', () => {
    expect(parseArgs(['restore', '--force'], BOOLEAN_FLAGS).flags.get('force')).toBe(true);
  });

  it('reads a value flag in both the = and the spaced form', () => {
    expect(parseArgs(['tune', '--channel=5'], BOOLEAN_FLAGS).flags.get('channel')).toBe('5');
    expect(parseArgs(['tune', '--channel', '5'], BOOLEAN_FLAGS).flags.get('channel')).toBe('5');
  });

  it('reads -h as --help', () => {
    expect(parseArgs(['tune', '-h'], BOOLEAN_FLAGS).flags.get('help')).toBe(true);
    expect(parseArgs(['tune', '-h'], BOOLEAN_FLAGS).positionals).toEqual([]);
  });

  it('rejects a flag given twice, in either form', () => {
    expect(() => parseArgs(['tune', '--channel', '1', '--channel', '2'], BOOLEAN_FLAGS)).toThrow('--channel given twice; pass it once');
    expect(() => parseArgs(['tune', '--channel=1', '--channel', '2'], BOOLEAN_FLAGS)).toThrow(UsageError);
    expect(() => parseArgs(['status', '--json', '--json'], BOOLEAN_FLAGS)).toThrow('--json given twice');
  });

  it('leaves the positional after a boolean flag in place', () => {
    const args = parseArgs(['restore', '--force', 'radio.img'], BOOLEAN_FLAGS);
    expect(args.verb).toBe('restore');
    expect(args.positionals).toEqual(['radio.img']);
    expect(args.flags.get('force')).toBe(true);
  });
});

describe('cli', () => {
  it('exits 2 with a usage error for --force=no before opening a port', () => {
    const r = spawnSync(process.execPath, ['src/main.ts', 'restore', 'x.img', '--force=no', '--json'], {
      cwd: process.cwd(),
      env: { ...process.env, UV5R_TARGET: '/dev/null-nonexistent' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    const body = JSON.parse(r.stderr.trim()) as { kind: string; message: string };
    expect(body.kind).toBe('usage');
    expect(body.message).toBe('--force takes no value');
  });
});
