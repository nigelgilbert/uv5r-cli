import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { numberFlag, parseDecimal } from '../../src/cli/args.ts';
import { checkTenHz, parseFrequency, UsageError } from '../../src/core/index.ts';

function cli(...argv: string[]) {
  const r = spawnSync(process.execPath, ['src/cli/main.ts', ...argv], {
    cwd: process.cwd(),
    env: { ...process.env, UV5R_TARGET: '/dev/null-nonexistent' },
    encoding: 'utf8',
  });
  const body = JSON.parse(r.stderr.trim()) as { reason: string; message: string };
  return { status: r.status, body };
}

describe('parseDecimal', () => {
  it('accepts plain decimals with sign, exponent and surrounding space', () => {
    expect(parseDecimal('5', 'x')).toBe(5);
    expect(parseDecimal('-0.6', 'x')).toBe(-0.6);
    expect(parseDecimal('154.68e6', 'x')).toBe(154_680_000);
    expect(parseDecimal(' 7 ', 'x')).toBe(7);
  });

  it('rejects empty, hex, Infinity and trailing junk', () => {
    for (const text of ['', ' ', '0x5', 'Infinity', '5px']) {
      expect(() => parseDecimal(text, 'x')).toThrow(UsageError);
    }
    expect(() => parseDecimal('0x5', 'channel')).toThrow('channel needs a number; got "0x5"');
  });
});

describe('numberFlag', () => {
  it('rejects a hex value', () => {
    expect(() => numberFlag(new Map([['channel', '0x5']]), 'channel')).toThrow(UsageError);
  });
});

describe('parseFrequency', () => {
  it('rejects hex', () => {
    expect(() => parseFrequency('0x9')).toThrow(UsageError);
  });

  it('rejects a part finer than 10 Hz, including sub-Hz digits', () => {
    expect(() => parseFrequency('146.820005')).toThrow('finer than 10 Hz');
    expect(() => parseFrequency('146.8200001')).toThrow('finer than 10 Hz');
    expect(parseFrequency('462.5625')).toBe(462_562_500);
  });
});

describe('checkTenHz', () => {
  it('returns signed multiples of 10 and rejects finer offsets', () => {
    expect(checkTenHz(-0.6 * 1_000_000, 'offset')).toBe(-600_000);
    expect(checkTenHz(5 * 1_000_000, 'offset')).toBe(5_000_000);
    expect(() => checkTenHz(-0.6000049 * 1_000_000, 'offset -0.6000049')).toThrow('offset -0.6000049 is finer than 10 Hz');
    expect(() => checkTenHz(-0.6000001 * 1_000_000, 'offset')).toThrow(UsageError);
  });
});

describe('CLI number and file errors', () => {
  it('exits 2 on an empty channel', () => {
    const { status, body } = cli('read', '', '--json');
    expect(status).toBe(2);
    expect(body.reason).toBe('invalid-argument');
  });

  it('exits 2 on a hex channel', () => {
    const { status, body } = cli('read', '0x5', '--json');
    expect(status).toBe(2);
    expect(body.reason).toBe('invalid-argument');
  });

  it('exits 2 when the restore image is missing', () => {
    const { status, body } = cli('restore', '/nonexistent/x.img', '--force', '--json');
    expect(status).toBe(2);
    expect(body.reason).toBe('invalid-argument');
    expect(body.message).toContain('cannot read');
  });

  it.each([
    ['dump', 'radio.img'],
    ['tune', '146.82', '5', '--channel', '7'],
    ['read', '5', '6'],
  ])('exits 2 on an extra positional for %s without a device', (...argv) => {
    const { status, body } = cli(...argv, '--json');
    expect(status).toBe(2);
    expect(body.message).toContain('unexpected argument');
  });

  it('exits 2 on a short restore image without a device', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'short.img');
    writeFileSync(file, new Uint8Array(100));
    const { status, body } = cli('restore', file, '--force', '--json');
    expect(status).toBe(2);
    expect(body.message).toContain('image too short');
  });

  it('exits 2 on an offset finer than 10 Hz and reaches the transport with a valid negative one', () => {
    expect(cli('tune', '146.82', '--channel', '5', '--offset', '-0.6000049', '--json').status).toBe(2);
    const ok = cli('tune', '146.82', '--channel', '5', '--offset', '-0.6', '--json');
    expect(ok.status).toBe(3);
    expect(ok.body.reason).toBe('device-unavailable');
  });

  it('exits 2 on a non-ASCII name without a device', () => {
    const { status, body } = cli('tune', '146.82', '--channel', '5', '--name', 'CAFÉ', '--json');
    expect(status).toBe(2);
    expect(body.reason).toBe('invalid-argument');
  });

  it('exits 0 with the whole help JSON on a pipe', () => {
    const r = spawnSync(process.execPath, ['src/cli/main.ts', 'help'], { cwd: process.cwd(), encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).exitCodes['128+signal']).toBe('interrupted by SIGINT, SIGTERM, SIGHUP or SIGTSTP: key, say and id release PTT and sweep prints its summary');
  });
});
