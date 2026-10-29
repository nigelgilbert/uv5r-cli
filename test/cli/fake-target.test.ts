import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/** Each verb runs as its own process, as the bench-operator harness spawns it. */
const ROOT = new URL('../../', import.meta.url).pathname;
const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  endMs: number;
}

/** One PTT file read taken while a key ran: the parsed file, or the raw text when it failed to parse. */
interface Sample {
  at: number;
  file?: Record<string, unknown>;
  torn?: string;
}

/** Return the harness env for a new run directory: state, PTT file, run id and a config path that does not exist. */
function harnessEnv(fault?: string): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), 'uv5r-target-'));
  dirs.push(dir);
  return {
    UV5R_FAKE_STATE: join(dir, 'state.json'),
    TINYSA_SIM_PTT: join(dir, 'ptt.json'),
    BENCH_RUN_ID: 'run-7',
    UV5R_CONFIG: join(dir, 'uv5r.json'),
    ...(fault === undefined ? {} : { UV5R_FAKE_FAULT: fault }),
  };
}

/** Run `node src/cli/main.ts ...args` from the repo root with `vars` over a clean env. */
function uv5r(args: string[], vars: NodeJS.ProcessEnv): Promise<Run> {
  const { UV5R_TARGET: _t, UV5R_FAKE_STATE: _s, UV5R_FAKE_FAULT: _f, TINYSA_SIM_PTT: _p, BENCH_RUN_ID: _r, ...base } = process.env;
  const start = Date.now();
  const child = spawn(process.execPath, ['src/cli/main.ts', ...args], { cwd: ROOT, env: { ...base, ...vars } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
  return new Promise((resolve) => child.on('close', (code) => resolve({ code, stdout, stderr, ms: Date.now() - start, endMs: Date.now() })));
}

/** Run `key --seconds S` and read the PTT file every 50 ms until the process exits. */
async function key(seconds: number, vars: NodeJS.ProcessEnv): Promise<{ run: Run; samples: Sample[] }> {
  const samples: Sample[] = [];
  const poll = setInterval(() => {
    let text: string;
    try {
      text = readFileSync(vars.TINYSA_SIM_PTT!, 'utf8');
    } catch {
      return;
    }
    try {
      samples.push({ at: Date.now(), file: JSON.parse(text) as Record<string, unknown> });
    } catch {
      samples.push({ at: Date.now(), torn: text });
    }
  }, 50);
  const run = await uv5r(['key', '--seconds', String(seconds), '--target', 'fake', '--json'], vars);
  clearInterval(poll);
  return { run, samples };
}

const status = (vars: NodeJS.ProcessEnv) => uv5r(['status', '--target', 'fake', '--json'], vars);
const tune = (mhz: string, vars: NodeJS.ProcessEnv, ...flags: string[]) => uv5r(['tune', mhz, '--channel', '3', ...flags, '--target', 'fake', '--json'], vars);
const pttFile = (vars: NodeJS.ProcessEnv) => JSON.parse(readFileSync(vars.TINYSA_SIM_PTT!, 'utf8')) as Record<string, unknown>;
const until = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms - Date.now())));

describe.concurrent('uv5r --target fake across processes', () => {
  it('carries tune, status and key through the state and PTT files', { timeout: 60_000 }, async () => {
    const vars = harnessEnv();
    const tuneA = await tune('446.00625', vars, '--low-power');
    expect(tuneA.code, tuneA.stderr).toBe(0);

    // A second process right after the tune reads MR mode after the handshake retry.
    const b2b = await status(vars);
    expect(b2b.code, b2b.stderr).toBe(0);
    expect(JSON.parse(b2b.stdout)).toMatchObject({ workmode: 'channel' });

    const k1 = await key(1, vars);
    expect(k1.run.code, k1.run.stderr).toBe(0);
    const held = JSON.parse(k1.run.stdout) as { assertedAtMs: number; releasedAtMs: number };
    const after = pttFile(vars);
    expect(Object.keys(after)).toEqual(['run_id', 'written_ms', 'ptt', 'ptt_on_ms', 'ptt_off_ms', 'freq_hz', 'power']);
    expect(after).toMatchObject({ run_id: 'run-7', ptt: false, freq_hz: 446_006_250, power: 'low' });
    expect(after.ptt_on_ms).toBeLessThanOrEqual(held.assertedAtMs);
    expect(after.ptt_off_ms).toBeLessThanOrEqual(held.releasedAtMs);
    expect(k1.samples.filter((s) => s.torn !== undefined)).toEqual([]);

    // A status 2.5 s after the last one needs no retry and leaves the PTT file alone.
    await until(b2b.endMs + 2700);
    const alone = await status(vars);
    expect(alone.code, alone.stderr).toBe(0);
    expect(pttFile(vars)).toEqual(after);
    expect(b2b.ms - alone.ms).toBeGreaterThan(2500);
    expect(b2b.ms - alone.ms).toBeLessThan(4500);

    // Tune B more than 3.2 s after A, key at once: A is on the air. Key after 3.2 s more: B.
    await until(alone.endMs + 2700);
    const tuneB = await tune('145.5', vars);
    expect(tuneB.code, tuneB.stderr).toBe(0);
    const k2 = await key(1, vars);
    expect(k2.run.code, k2.run.stderr).toBe(0);
    expect(pttFile(vars)).toMatchObject({ freq_hz: 446_006_250, power: 'low' });
    expect(k2.samples.filter((s) => s.torn !== undefined)).toEqual([]);

    await until(tuneB.endMs + 3200);
    const k3 = await key(5, vars);
    expect(k3.run.code, k3.run.stderr).toBe(0);
    expect(pttFile(vars)).toMatchObject({ ptt: false, freq_hz: 145_500_000, power: 'high' });
    expect(k3.samples.filter((s) => s.torn !== undefined)).toEqual([]);
    const beats = [...new Set(k3.samples.filter((s) => s.file?.ptt === true).map((s) => s.file!.written_ms as number))];
    expect(beats.length).toBeGreaterThanOrEqual(9);
    const gaps = beats.slice(1).map((w, i) => w - beats[i]!);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(600);
  });

  it('name-not-taken fails the tune on the name and keeps frequency and power', { timeout: 30_000 }, async () => {
    const vars = harnessEnv('name-not-taken');
    const tuned = await uv5r(['tune', '446.00625', '--channel', '1', '--low-power', '--target', 'fake', '--json'], vars);
    expect(tuned.code).toBe(5);
    const error = JSON.parse(tuned.stderr) as { reason: string; message: string };
    expect(error.reason).toBe('verification-failed');
    expect(error.message).toMatch(/name did not take the write$/);
    const read = await uv5r(['read', '1', '--target', 'fake', '--json'], vars);
    expect(read.code, read.stderr).toBe(0);
    expect(JSON.parse(read.stdout)).toMatchObject({ rxMhz: '446.00625', txMhz: '446.00625', power: 'low' });
  });

  it('tune-wrong-freq leaves another txMhz for the read after the tune', { timeout: 30_000 }, async () => {
    const vars = harnessEnv('tune-wrong-freq');
    const tuned = await uv5r(['tune', '446.00625', '--channel', '1', '--low-power', '--target', 'fake', '--json'], vars);
    expect(tuned.code).toBe(5);
    expect((JSON.parse(tuned.stderr) as { message: string }).message).toMatch(/name did not take the write$/);
    const read = await uv5r(['read', '1', '--target', 'fake', '--json'], vars);
    expect(read.code, read.stderr).toBe(0);
    expect(JSON.parse(read.stdout)).toMatchObject({ rxMhz: '446.00625', power: 'low' });
    expect((JSON.parse(read.stdout) as { txMhz: string }).txMhz).not.toBe('446.00625');
  });

  it('tune-delay:4000 returns the tune about 4 s later', { timeout: 30_000 }, async () => {
    const plain = await tune('446.00625', harnessEnv());
    const delayed = await tune('446.00625', harnessEnv('tune-delay:4000'));
    expect(plain.code, plain.stderr).toBe(0);
    expect(delayed.code, delayed.stderr).toBe(0);
    expect(delayed.ms - plain.ms).toBeGreaterThan(3500);
    expect(delayed.ms - plain.ms).toBeLessThan(5000);
  });

  it('exits 2 naming UV5R_FAKE_STATE when UV5R_TARGET=fake and the variable is unset', { timeout: 15_000 }, async () => {
    const { UV5R_FAKE_STATE: _, ...vars } = harnessEnv();
    const run = await uv5r(['status', '--json'], { ...vars, UV5R_TARGET: 'fake' });
    expect(run.code).toBe(2);
    expect(JSON.parse(run.stderr)).toMatchObject({ reason: 'invalid-argument', variable: 'UV5R_FAKE_STATE' });
  });
});
