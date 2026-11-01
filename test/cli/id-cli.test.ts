import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cli, type OpenTransport } from '../../src/cli/main.ts';
import { FakeRadio } from '../core/fake.ts';
import { fakeSpeechDeps, fakeSynthesize } from '../tts/fakes.ts';

const ID = 'This is Kilo, Juliett, Seven, Alfa, Bravo, Charlie';

/** Write a station config holding `json` and return its path. */
function config(json: object): string {
  const file = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'uv5r.json');
  writeFileSync(file, JSON.stringify(json));
  return file;
}

const STATION = config({ callsign: 'KJ7ABC' });

function opener(radio = new FakeRadio()): OpenTransport & { calls: number } {
  const open = Object.assign(
    async () => {
      open.calls++;
      return radio;
    },
    { calls: 0 },
  );
  return open;
}

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => stdout.push(String(chunk)) > 0);
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => stderr.push(String(chunk)) > 0);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

const outJson = () => JSON.parse(stdout.join('').trim()) as Record<string, unknown>;
const errJson = () => JSON.parse(stderr.join('').trim()) as Record<string, unknown>;

describe('id', () => {
  it('speaks the phonetic callsign alone and keys PTT around it', async () => {
    const radio = new FakeRadio();
    const synth = fakeSynthesize();
    await cli(['id', '--config', config({ callsign: 'KJ7ABC', tailMs: 0 }), '--json'], opener(radio), fakeSpeechDeps({ synthesize: synth }));
    expect(process.exitCode).toBe(0);
    expect(synth.calls.map((c) => c.text)).toEqual([ID]);
    const result = outJson();
    expect(Object.keys(result)).toEqual(['text', 'spoken', 'identified', 'seconds', 'peakDbfs', 'rmsDbfs', 'device', 'voice', 'leadMs', 'tailMs', 'maxSeconds', 'pttAsserted', 'released']);
    expect(result).toMatchObject({ text: ID, spoken: ID, identified: true, pttAsserted: true, released: true });
    expect(radio.pttLog).toEqual([true, false]);
  });

  it('exits 2 with station-unconfigured before open without a callsign', async () => {
    const open = opener();
    await cli(['id', '--config', config({}), '--json'], open, fakeSpeechDeps());
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'station-unconfigured' });
    expect(open.calls).toBe(0);
  });

  it('caps the utterance at the default maxSeconds of 30', async () => {
    const open = opener();
    await cli(['id', '--config', STATION, '--json'], open, fakeSpeechDeps({ synthesize: fakeSynthesize({ seconds: 30 }) }));
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'utterance-too-long', maxSeconds: 30 });
    expect(open.calls).toBe(0);
  });

  it('caps the utterance at the config maxSeconds', async () => {
    const open = opener();
    await cli(['id', '--config', config({ callsign: 'KJ7ABC', maxSeconds: 3 }), '--json'], open, fakeSpeechDeps({ synthesize: fakeSynthesize({ seconds: 3 }) }));
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'utterance-too-long', maxSeconds: 3 });
    expect(open.calls).toBe(0);
  });

  it.each([
    ['--voice', 'Daniel', 'voice'],
    ['--lead', '500', 'leadMs'],
    ['--tail', '0', 'tailMs'],
  ])('exits 2 on %s naming the config field %s', async (flag, value, field) => {
    const open = opener();
    await cli(['id', flag, value, '--config', STATION, '--json'], open, fakeSpeechDeps());
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument', flag: flag.slice(2), message: expect.stringContaining(`${field} in the station config`) });
    expect(open.calls).toBe(0);
  });

  it.each([['--clear', '1'], ['--max-seconds', '10'], ['--rehearse'], ['--out', 'tx.wav']])('takes no %s', async (flag, ...value) => {
    await cli(['id', '--config', STATION, flag, ...value, '--json'], opener(), fakeSpeechDeps());
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument', flag: flag.slice(2) });
  });

  it('takes no text', async () => {
    await cli(['id', 'hello', '--config', STATION, '--json'], opener(), fakeSpeechDeps());
    expect(process.exitCode).toBe(2);
    expect(errJson().message).toContain('unexpected argument');
  });
});
