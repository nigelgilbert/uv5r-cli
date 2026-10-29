import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADDR, encodeChannel } from '../../src/core/codec.ts';
import { FAKE_APPLY_MS, FakeRadio, FakeTransport, PTT_HEARTBEAT_MS, parseFakeFault, type FakeState, type PttFile } from '../../src/core/fake.ts';
import { SETTLE_MS, type Session } from '../../src/core/protocol.ts';
import { readChannel, readStatus, withSession, writeChannel } from '../../src/core/radio.ts';

let dir: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  vi.useFakeTimers();
  dir = mkdtempSync(join(tmpdir(), 'uv5r-fake-'));
  env = { UV5R_FAKE_STATE: join(dir, 'state.json'), TINYSA_SIM_PTT: join(dir, 'ptt.json'), BENCH_RUN_ID: 'run-1' };
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

/** Run fake timers until `p` settles and return its result. */
async function drive<T>(p: Promise<T>): Promise<T> {
  const [value] = await Promise.all([p, vi.runAllTimersAsync()]);
  return value;
}

/** Open the fake as one process would, run `fn` in a clone session and close it. */
async function verb<T>(fn: (s: Session) => Promise<T>, name?: string, vars: NodeJS.ProcessEnv = env): Promise<{ t: FakeTransport; value: T; ms: number }> {
  const t = await FakeTransport.open({ env: vars, verb: name });
  const start = Date.now();
  try {
    const value = await drive(withSession(t, fn));
    return { t, value, ms: Date.now() - start };
  } finally {
    await t.close();
  }
}

/** Tune `slot` to `rxHz` in its own process. */
const tune = (slot: number, rxHz: number, lowPower = false) => verb((s) => writeChannel(s, slot, { rxHz, lowPower }), 'tune');

/** Key and release in one process and return the PTT file at each edge. */
async function key(vars: NodeJS.ProcessEnv = env): Promise<{ on: PttFile; off: PttFile }> {
  const t = await FakeTransport.open({ env: vars, verb: 'key' });
  await t.setPtt(true);
  const on = pttFile();
  await t.setPtt(false);
  const off = pttFile();
  await t.close();
  return { on, off };
}

const pttFile = (): PttFile => JSON.parse(readFileSync(env.TINYSA_SIM_PTT!, 'utf8')) as PttFile;
const stateFile = (): FakeState => JSON.parse(readFileSync(env.UV5R_FAKE_STATE!, 'utf8')) as FakeState;

describe('parseFakeFault', () => {
  it('parses each fault and treats unset or empty as none', () => {
    expect(parseFakeFault(undefined)).toBeUndefined();
    expect(parseFakeFault('')).toBeUndefined();
    expect(parseFakeFault('tune-delay:4000')).toEqual({ kind: 'tune-delay', ms: 4000 });
    expect(parseFakeFault('name-not-taken')).toEqual({ kind: 'name-not-taken' });
    expect(parseFakeFault('tune-wrong-freq')).toEqual({ kind: 'tune-wrong-freq' });
  });

  it.each(['tune-delay', 'tune-delay:-1', 'hang-forever'])('rejects %s naming the variable', (text) => {
    expect(() => parseFakeFault(text)).toThrow(expect.objectContaining({ kind: 'usage', message: expect.stringContaining('UV5R_FAKE_FAULT') }));
  });
});

describe('FakeTransport state file', () => {
  it('rejects an unset UV5R_FAKE_STATE naming the variable', async () => {
    await expect(FakeTransport.open({ env: {} })).rejects.toMatchObject({ kind: 'usage', message: expect.stringContaining('UV5R_FAKE_STATE'), detail: { variable: 'UV5R_FAKE_STATE' } });
  });

  it('starts a new file from the FakeRadio image in MR mode', async () => {
    const { value } = await verb(readStatus, 'status');
    expect(value.workmode).toBe('channel');
    const saved = stateFile();
    const eeprom = Buffer.from(saved.eeprom, 'base64');
    expect(eeprom[ADDR.workmode]).toBe(1);
    expect([...eeprom.subarray(0, 0x0e00)]).toEqual([...new FakeRadio().eeprom.subarray(0, 0x0e00)]);
    expect(saved).toMatchObject({ tunedSlot: null, tuneEndedMs: null, freq_hz: null, power: null });
  });

  it('keeps a tune across processes', async () => {
    await tune(3, 446_006_250, true);
    vi.advanceTimersByTime(SETTLE_MS);
    const { value } = await verb((s) => readChannel(s, 3), 'read');
    expect(value).toMatchObject({ rxHz: 446_006_250, txHz: 446_006_250, lowPower: true });
    expect(stateFile()).toMatchObject({ tunedSlot: 3 });
  });

  it('rejects a state file without a full eeprom', async () => {
    writeFileSync(env.UV5R_FAKE_STATE!, '{"eeprom":""}');
    await expect(FakeTransport.open({ env })).rejects.toMatchObject({ kind: 'usage', message: expect.stringContaining('eeprom') });
  });
});

describe('FakeTransport lead time', () => {
  it('leaves a handshake within 2.5 s of the previous verb unanswered and acks the retry', async () => {
    await tune(3, 446_006_250);
    const { value, ms } = await verb(readStatus, 'status');
    expect(value.workmode).toBe('channel');
    expect(ms).toBeGreaterThanOrEqual(SETTLE_MS);
  });

  it('acks the first handshake 2.5 s after the previous verb', async () => {
    await tune(3, 446_006_250);
    vi.advanceTimersByTime(2500);
    const { ms } = await verb(readStatus, 'status');
    expect(ms).toBeLessThan(SETTLE_MS);
  });

  it('reports the slot as it was before the first tune until the tune applies', async () => {
    const seed = new FakeRadio();
    seed.eeprom[ADDR.workmode] = 1;
    seed.eeprom.set(encodeChannel({ rxHz: 162_550_000 }), 3 * 16);
    const state: FakeState = { eeprom: Buffer.from(seed.eeprom).toString('base64'), tunedSlot: null, tuneEndedMs: null, freq_hz: null, power: null, lastCommandMs: null };
    writeFileSync(env.UV5R_FAKE_STATE!, JSON.stringify(state));
    await tune(3, 446_006_250, true);
    expect((await key()).on).toMatchObject({ freq_hz: 162_550_000, power: 'high' });
  });

  it('reports null before the first tune of an empty slot applies', async () => {
    await tune(3, 446_006_250, true);
    expect((await key()).on).toMatchObject({ freq_hz: null, power: null });
  });

  it('applies a tune FAKE_APPLY_MS after it ends and reports the previous one before', async () => {
    await tune(3, 446_006_250, true);
    vi.advanceTimersByTime(FAKE_APPLY_MS);
    expect((await key()).on).toMatchObject({ freq_hz: 446_006_250, power: 'low' });
    vi.advanceTimersByTime(2500);
    await tune(3, 145_500_000);
    expect((await key()).on).toMatchObject({ freq_hz: 446_006_250, power: 'low' });
    vi.advanceTimersByTime(FAKE_APPLY_MS - 1);
    expect((await key()).on).toMatchObject({ freq_hz: 446_006_250, power: 'low' });
    vi.advanceTimersByTime(1);
    expect((await key()).on).toMatchObject({ freq_hz: 145_500_000, power: 'high' });
  });

  it('applies a pending tune that fell due during the next tune', async () => {
    await tune(3, 446_006_250, true);
    // The second tune retries its handshake, so the first falls due before its write.
    await tune(4, 145_500_000);
    expect((await key()).on).toMatchObject({ freq_hz: 446_006_250, power: 'low' });
  });
});

describe('FakeTransport PTT file', () => {
  it('writes the seven fields at each edge', async () => {
    await tune(3, 446_006_250, true);
    vi.advanceTimersByTime(FAKE_APPLY_MS);
    const t = await FakeTransport.open({ env, verb: 'key' });
    const before = Date.now();
    await t.setPtt(true);
    const on = pttFile();
    expect(Object.keys(on)).toEqual(['run_id', 'written_ms', 'ptt', 'ptt_on_ms', 'ptt_off_ms', 'freq_hz', 'power']);
    expect(on).toEqual({ run_id: 'run-1', written_ms: before, ptt: true, ptt_on_ms: before, ptt_off_ms: null, freq_hz: 446_006_250, power: 'low' });
    vi.advanceTimersByTime(1000);
    await t.setPtt(false);
    expect(pttFile()).toEqual({ ...on, written_ms: before + 1000, ptt: false, ptt_off_ms: before + 1000 });
    await t.close();
  });

  it('sets run_id to null when BENCH_RUN_ID is unset', async () => {
    const { BENCH_RUN_ID: _, ...vars } = env;
    expect((await key(vars)).on.run_id).toBeNull();
  });

  it('rewrites written_ms every PTT_HEARTBEAT_MS while PTT is held and stops at the release', async () => {
    const t = await FakeTransport.open({ env, verb: 'key' });
    await t.setPtt(true);
    const start = pttFile().written_ms;
    for (let n = 1; n <= 4; n++) {
      vi.advanceTimersByTime(PTT_HEARTBEAT_MS);
      expect(pttFile()).toMatchObject({ ptt: true, written_ms: start + n * PTT_HEARTBEAT_MS, ptt_on_ms: start });
    }
    await t.setPtt(false);
    const off = pttFile();
    vi.advanceTimersByTime(PTT_HEARTBEAT_MS * 4);
    await t.close();
    expect(pttFile()).toEqual(off);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the heartbeat and writes ptt false in close', async () => {
    const t = await FakeTransport.open({ env, verb: 'key' });
    await t.setPtt(true);
    await t.close();
    expect(pttFile()).toMatchObject({ ptt: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves the file alone on the open and close releases of a clone verb', async () => {
    await verb(readStatus, 'status');
    expect(existsSync(env.TINYSA_SIM_PTT!)).toBe(false);
    await key();
    const after = pttFile();
    vi.advanceTimersByTime(2500);
    await verb(readStatus, 'status');
    expect(pttFile()).toEqual(after);
  });

  it('skips the file when TINYSA_SIM_PTT is unset', async () => {
    const { TINYSA_SIM_PTT: _, ...vars } = env;
    const t = await FakeTransport.open({ env: vars, verb: 'key' });
    await t.setPtt(true);
    expect(vi.getTimerCount()).toBe(0);
    await t.setPtt(false);
    await t.close();
    expect(existsSync(env.TINYSA_SIM_PTT!)).toBe(false);
  });
});

describe('FakeTransport faults', () => {
  it('name-not-taken acks the name write and drops it', async () => {
    const vars = { ...env, UV5R_FAKE_FAULT: 'name-not-taken' };
    const failed = verb((s) => writeChannel(s, 1, { rxHz: 446_006_250, lowPower: true }), 'tune', vars);
    await expect(failed).rejects.toMatchObject({ reason: 'verification-failed', message: 'channel 1 record written; name did not take the write' });
    vi.advanceTimersByTime(2500);
    const { value } = await verb((s) => readChannel(s, 1), 'read', vars);
    expect(value).toMatchObject({ rxHz: 446_006_250, txHz: 446_006_250, lowPower: true, name: '' });
  });

  it('tune-wrong-freq drops the name and leaves another TX frequency for the next read', async () => {
    const vars = { ...env, UV5R_FAKE_FAULT: 'tune-wrong-freq' };
    const failed = verb((s) => writeChannel(s, 1, { rxHz: 446_006_250, lowPower: true }), 'tune', vars);
    await expect(failed).rejects.toMatchObject({ reason: 'verification-failed', message: 'channel 1 record written; name did not take the write' });
    vi.advanceTimersByTime(FAKE_APPLY_MS);
    const { value } = await verb((s) => readChannel(s, 1), 'read', vars);
    expect(value).toMatchObject({ rxHz: 446_006_250, txHz: 447_006_250 });
    expect((await key(vars)).on).toMatchObject({ freq_hz: 447_006_250, power: 'low' });
  });

  it('tune-delay holds the handshake ack of tune only', async () => {
    const vars = { ...env, UV5R_FAKE_FAULT: 'tune-delay:4000' };
    const status = await verb(readStatus, 'status', vars);
    vi.advanceTimersByTime(2500);
    const tuned = await verb((s) => writeChannel(s, 1, { rxHz: 446_006_250 }), 'tune', vars);
    expect(tuned.t.handshakes).toHaveLength(1);
    expect(tuned.ms - status.ms).toBeGreaterThanOrEqual(4000);
    expect(tuned.ms - status.ms).toBeLessThan(5000);
  });
});
