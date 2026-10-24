import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ADDR, SETTINGS_BASE, SETTINGS_SIZE, decodeChannel, decodeSettings, encodeChannel, encodeName, parseTone, type ChannelSpec } from '../../src/core/codec.ts';
import { BaofengError } from '../../src/core/errors.ts';
import { MAGICS, magicByName } from '../../src/core/ident.ts';
import { SETTLE_MS, Session, attempt, hex } from '../../src/core/protocol.ts';
import {
  SCAN_SILENT_PAUSE_MS,
  channelPayload,
  eraseChannel,
  identify,
  readChannel,
  readSettings,
  readStatus,
  withSession,
  writeChannel,
  type IdentifyAttempt,
  type SessionOptions,
} from '../../src/core/radio.ts';
import { FakeRadio } from './fake.ts';

const NO_HANDSHAKE_REMEDY = 'ask the human to check the radio is on and the cable is seated; if both hold, run uv5r identify and export the UV5R_MAGIC line it prints';

/** Write channel `n` in a new session, as the tune verb does. */
const tune = (radio: FakeRadio, n: number, spec: ChannelSpec) => withSession(radio, (s) => writeChannel(s, n, spec));

/** Drop the clone session and start a new one, as the next CLI invocation does after the reload. */
async function nextSession(radio: FakeRadio): Promise<Session> {
  radio.dropSession();
  const s = new Session(radio);
  await s.start();
  return s;
}

describe('erase', () => {
  it('clears the record and name so the channel reads empty in the next session', async () => {
    const radio = new FakeRadio();
    await tune(radio, 127, { rxHz: 435_725_000, name: 'JUNK' });
    radio.dropSession();
    await withSession(radio, (s) => eraseChannel(s, 127));
    const s = await nextSession(radio);
    expect(await readChannel(s, 127)).toBeUndefined();
    expect(radio.eeprom.subarray(0x1000 + 127 * 16, 0x1000 + 128 * 16).every((b) => b === 0xff)).toBe(true);
  });
  it('reports an acked but ignored name erase as a verification failure after the record erase', async () => {
    const radio = new FakeRadio();
    await tune(radio, 127, { rxHz: 435_725_000, name: 'JUNK' });
    radio.dropSession();
    radio.writesIgnoredBelow = 0x1000 + 127 * 16;
    radio.writesIgnoredAbove = 0x1000 + 128 * 16;
    await expect(withSession(radio, (s) => eraseChannel(s, 127))).rejects.toMatchObject({
      kind: 'device-state',
      reason: 'verification-failed',
      message: 'channel 127 record erased; name did not take the erase',
      detail: { wrote: expect.stringMatching(/^ff( ff){15}$/), read: expect.stringMatching(/^4a 55 4e 4b/) },
    });
    expect(radio.eeprom.subarray(127 * 16, 128 * 16).every((b) => b === 0xff)).toBe(true);
  });
  it('throws the timeout unchanged when the name read-back times out after the record erase verified', async () => {
    const radio = new FakeRadio();
    await tune(radio, 127, { rxHz: 435_725_000, name: 'JUNK' });
    radio.dropSession();
    radio.silentReadAt = 0x1000 + 127 * 16;
    const err = await withSession(radio, (s) => eraseChannel(s, 127)).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'timeout', reason: 'serial-timeout' });
    expect((err as BaofengError).detail).not.toHaveProperty('recordWritten');
    expect(radio.eeprom.subarray(127 * 16, 128 * 16).every((b) => b === 0xff)).toBe(true);
  });
});

/** Run fake timers alongside `p` and return its result, or its rejection as the value. */
async function settled<T>(p: Promise<T>): Promise<T | BaofengError> {
  const caught = p.catch((err: unknown) => err as BaofengError);
  await vi.runAllTimersAsync();
  return caught;
}

/** Return every single-byte write after the 02 that asks for the ident. */
function writesAfterIdentRequest(write: MockInstance<FakeRadio['write']>): number[][] {
  const calls = write.mock.calls.map(([bytes]) => [...bytes]);
  const at = calls.findIndex((b) => b.length === 1 && b[0] === 0x02);
  return at < 0 ? [] : calls.slice(at + 1);
}

describe('session', () => {
  it('handshakes and reads the firmware string', async () => {
    const radio = new FakeRadio();
    const s = new Session(radio);
    const id = await s.start();
    expect(id.firmware).toBe('HN5RV011');
    expect(id.droppedByte).toBe(true);
    expect(radio.ptt).toBe(false);
  });
  it('retries an unanswered handshake once', async () => {
    const radio = new FakeRadio();
    radio.handshakesIgnored = 1;
    const id = await new Session(radio).start();
    expect(id.firmware).toBe('HN5RV011');
  });
  it('raises device-state after two unanswered handshakes', async () => {
    const radio = new FakeRadio();
    radio.handshakesIgnored = 2;
    await expect(new Session(radio).start()).rejects.toMatchObject({ kind: 'device-state', reason: 'session-unavailable' });
  });
});

describe('handshake', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Record the time of every magic the radio matched. */
  function attemptTimes(radio: FakeRadio): number[] {
    const times: number[] = [];
    const seen = radio.handshakes.length;
    const write = radio.write.bind(radio);
    vi.spyOn(radio, 'write').mockImplementation((bytes) => {
      write(bytes);
      if (radio.handshakes.length > seen + times.length) times.push(Date.now());
    });
    return times;
  }

  it('accepts an 8-byte ident with magic 291 and reports the magic, firmware and family', async () => {
    const radio = new FakeRadio();
    const id = await settled(new Session(radio).start());
    expect(id).toMatchObject({
      bytes: radio.ident,
      firmware: 'HN5RV011',
      firmwareHex: '48 4e 35 52 56 30 31 31 ff ff ff ff ff ff',
      droppedByte: true,
      magic: '291',
      family: 'uv5r',
      flags: { basetype: 'HN5RV01', orig: false, dtmfTable: '0123456789ABCD*#' },
    });
    expect(radio.handshakes).toEqual(['50 bb ff 20 12 07 25']);
  });

  it('collapses a 12-byte ident to 8 bytes with magic 291', async () => {
    const radio = new FakeRadio();
    radio.identReply = Uint8Array.from([0xaa, 0x01, 0x01, 0x36, 0x01, 0x74, 0x01, 0x04, 0x00, 0x05, 0x20, 0xdd]);
    const id = await settled(new Session(radio).start());
    expect(id).toMatchObject({ bytes: Uint8Array.from([0xaa, 0x36, 0x74, 0x04, 0x00, 0x05, 0x20, 0xdd]), magic: '291' });
  });

  it('reads the ident in one bounded read of up to 14 bytes', async () => {
    const radio = new FakeRadio();
    const read = vi.spyOn(radio, 'read');
    await settled(new Session(radio).start());
    expect(read.mock.calls[1]).toEqual([14, 300]);
  });

  it('fails with radio-unsupported naming a UV-5X3-type radio on a 14-byte ident with magic 291, once and with no closing 06', async () => {
    const radio = new FakeRadio();
    radio.identReply = Uint8Array.from([0xaa, 0x30, 0x76, 0x04, 0x00, 0x05, 0x20, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0xdd]);
    const write = vi.spyOn(radio, 'write');
    const err = await settled(new Session(radio).start());
    expect(err).toBeInstanceOf(BaofengError);
    expect((err as BaofengError).toJSON()).toMatchObject({
      reason: 'radio-unsupported',
      message: expect.stringContaining('UV-5X3-type radio'),
      remedy: 'report the radio name to the human; this CLI speaks the classic UV-5R protocol',
      retry: 'no',
      radio: 'UV-5X3-type radio',
      magic: '291',
    });
    expect((err as BaofengError).kind).toBe('device-state');
    expect(radio.handshakes).toHaveLength(1);
    expect(writesAfterIdentRequest(write)).toEqual([]);
  });

  it('fails with protocol-reply-invalid and the bytes in got on a 9-byte ident with magic 291, once', async () => {
    const radio = new FakeRadio();
    radio.identReply = Uint8Array.from([0xaa, 0x30, 0x76, 0x04, 0x00, 0x05, 0x20, 0x00, 0xdd]);
    const err = await settled(new Session(radio).start());
    expect((err as BaofengError).toJSON()).toMatchObject({ reason: 'protocol-reply-invalid', got: 'aa 30 76 04 00 05 20 00 dd', magic: '291' });
    expect(radio.handshakes).toHaveLength(1);
  });

  it('names a wrong ack byte in got and the message after two attempts with magic 291', async () => {
    const radio = new FakeRadio();
    radio.ackByte = 0x15;
    const err = await settled(new Session(radio).start());
    expect((err as BaofengError).toJSON()).toMatchObject({
      reason: 'session-unavailable',
      message: 'radio answered the clone handshake with 15 in place of 06; check the radio is on and the cable is seated',
      remedy: NO_HANDSHAKE_REMEDY,
      retry: 'after-remedy',
      got: '15',
    });
    expect(radio.handshakes).toHaveLength(2);
  });

  it('runs the second attempt SETTLE_MS after a silent first one with magic 291', async () => {
    const radio = new FakeRadio();
    radio.handshakesIgnored = 1;
    const times = attemptTimes(radio);
    const id = await settled(new Session(radio).start());
    expect(id).toMatchObject({ magic: '291', firmware: 'HN5RV011' });
    expect(times).toHaveLength(2);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(SETTLE_MS);
  });

  it('keeps an empty got and the remedy after two silent attempts with magic 291', async () => {
    const radio = new FakeRadio();
    radio.handshakesIgnored = 2;
    const err = await settled(new Session(radio).start());
    expect((err as BaofengError).toJSON()).toMatchObject({
      reason: 'session-unavailable',
      message: 'radio did not answer the clone handshake; check the radio is on and the cable is seated',
      remedy: NO_HANDSHAKE_REMEDY,
      retry: 'after-remedy',
      got: '',
    });
    expect(radio.handshakes).toHaveLength(2);
  });

  it('fails at once with the wait remedy when the radio refuses the closing 06 with magic 291', async () => {
    const radio = new FakeRadio();
    const read = radio.read.bind(radio);
    let reads = 0;
    vi.spyOn(radio, 'read').mockImplementation(async (n, ms) => (++reads === 3 ? new Uint8Array() : read(n, ms)));
    const err = await settled(new Session(radio).start());
    expect((err as BaofengError).toJSON()).toMatchObject({ reason: 'session-unavailable', message: 'radio refused the clone session', remedy: 'wait 3 s and rerun the command', got: '' });
    expect(radio.handshakes).toHaveLength(1);
  });

  it('opens the session with magic UV82 when the radio acks only UV82', async () => {
    const radio = new FakeRadio();
    const uv82 = magicByName('UV82');
    radio.magics = [uv82.bytes];
    const id = await settled(new Session(radio).start(uv82));
    expect(id).toMatchObject({ magic: 'UV82', family: 'uv-82x3' });
    expect(radio.handshakes).toEqual(['50 bb ff 20 13 01 05']);
  });

  it('stops after the ident without the closing 06 when attempt runs without confirm, magic 291', async () => {
    const radio = new FakeRadio();
    const write = vi.spyOn(radio, 'write');
    const outcome = await settled(attempt(radio, magicByName('291'), { confirm: false }));
    expect(outcome).toEqual({ kind: 'ident', bytes: radio.ident });
    expect(writesAfterIdentRequest(write)).toEqual([]);
  });

  it('reports a silent attempt as silent with magic ORIG on a radio that acks only 291', async () => {
    const radio = new FakeRadio();
    expect(await settled(attempt(radio, magicByName('ORIG'), { confirm: true }))).toEqual({ kind: 'silent' });
  });
});

describe('identify', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Fake time one attempt that gets no 06 costs: seven magic bytes 10 ms apart; the fake answers reads at once. */
  const SEND_MS = 70;
  /** Fake time the three post-ident reads cost: 50 ms after each. */
  const FINISH_MS = 150;
  const NINE_BYTES = Uint8Array.from([0xaa, 0x30, 0x76, 0x04, 0x00, 0x05, 0x20, 0x00, 0xdd]);

  /** Run identify on `radio` under fake timers and return its result or error, each attempt with its time, and the elapsed time. */
  async function scan(radio: FakeRadio, options: SessionOptions = {}) {
    const attempts: Array<IdentifyAttempt & { at: number }> = [];
    const start = Date.now();
    const result = await settled(identify(radio, (a) => attempts.push({ ...a, at: Date.now() - start }), options));
    return { result, attempts, names: attempts.map((a) => `${a.name} ${a.outcome}`), elapsed: Date.now() - start };
  }

  /** Return a fake radio that acks only the magic `name`. */
  function radioAcking(name: string): FakeRadio {
    const radio = new FakeRadio();
    radio.magics = [MAGICS.find((m) => m.name === name)!.bytes];
    return radio;
  }

  it('stops at the first magic on the bench radio with pin null and one attempt reported', async () => {
    const { result, attempts } = await scan(new FakeRadio());
    expect(result).toEqual({
      magic: '291',
      ident: 'aa 30 76 04 00 05 20 dd',
      firmware: 'HN5RV011',
      firmwareHex: '48 4e 35 52 56 30 31 31 ff ff ff ff ff ff',
      family: 'uv5r',
      flags: { basetype: 'HN5RV01', orig: false, voiceBool: false, band220: false, triPower: false, dtmfTable: '0123456789ABCD*#' },
      droppedByte: true,
      pin: null,
    });
    expect(attempts).toEqual([{ name: '291', baud: 9600, outcome: 'ident', at: SEND_MS }]);
  });

  it('opens with the second magic after the first is silent twice, and the elapsed time is the attempt costs plus the pauses', async () => {
    const { result, attempts, names, elapsed } = await scan(radioAcking('ORIG'));
    expect(result).toMatchObject({ magic: 'ORIG', family: 'uv5r', pin: 'UV5R_MAGIC=ORIG' });
    expect(names).toEqual(['291 silent', '291 silent', 'ORIG ident']);
    expect(attempts[1]!.at - attempts[0]!.at).toBe(SETTLE_MS + SEND_MS);
    expect(attempts[2]!.at - attempts[1]!.at).toBe(SCAN_SILENT_PAUSE_MS + SEND_MS);
    expect(elapsed).toBe(3 * SEND_MS + SETTLE_MS + SCAN_SILENT_PAUSE_MS + FINISH_MS);
  });

  it('pauses SETTLE_MS after an invalid ident on the first magic and moves on with no second attempt', async () => {
    const radio = new FakeRadio();
    radio.identReply = NINE_BYTES;
    const { attempts, names } = await scan(radio);
    expect(names.slice(0, 2)).toEqual(['291 invalid', 'ORIG silent']);
    expect(attempts[1]!.at - attempts[0]!.at).toBe(SETTLE_MS + SEND_MS);
  });

  it('reports protocol-reply-invalid with the bytes when an invalid ident is followed by silence', async () => {
    const radio = new FakeRadio();
    radio.identReply = NINE_BYTES;
    const { result, names } = await scan(radio);
    expect(names).toHaveLength(8);
    expect(result).toBeInstanceOf(BaofengError);
    expect((result as BaofengError).toJSON()).toMatchObject({
      reason: 'protocol-reply-invalid',
      message: expect.stringContaining('unknown UV-5R variant'),
      magic: '291',
      got: 'aa 30 76 04 00 05 20 00 dd',
    });
  });

  it('reports radio-unsupported naming the UV-6 on a UV6 ack, with no closing 06 and no block read', async () => {
    const radio = radioAcking('UV6');
    const write = vi.spyOn(radio, 'write');
    const { result, names } = await scan(radio);
    expect(names).toEqual(['291 silent', '291 silent', 'ORIG silent', 'UV82 silent', 'A58 silent', 'UV5G silent', 'F11 silent', 'UV6 ident']);
    expect((result as BaofengError).toJSON()).toMatchObject({
      reason: 'radio-unsupported',
      message: expect.stringContaining('UV-6'),
      retry: 'no',
      radio: 'Baofeng UV-6',
      magic: 'UV6',
      got: 'aa 30 76 04 00 05 20 dd',
    });
    expect(writesAfterIdentRequest(write)).toEqual([]);
    expect(write.mock.calls.some(([bytes]) => bytes[0] === 0x53)).toBe(false);
  });

  it('ends the scan with radio-unsupported on a 14-byte ident on the second magic', async () => {
    const radio = radioAcking('ORIG');
    radio.identReply = Uint8Array.from([0xaa, ...new Array(12).fill(0x30), 0xdd]);
    const write = vi.spyOn(radio, 'write');
    const { result, names } = await scan(radio);
    expect(names).toEqual(['291 silent', '291 silent', 'ORIG foreign']);
    expect((result as BaofengError).toJSON()).toMatchObject({ reason: 'radio-unsupported', radio: 'UV-5X3-type radio', magic: 'ORIG' });
    expect(writesAfterIdentRequest(write)).toEqual([]);
  });

  it('gives session-unavailable with an empty answers and a remedy without identify on silence everywhere', async () => {
    const radio = new FakeRadio();
    radio.magics = [];
    const { result, names, elapsed } = await scan(radio);
    expect(names).toEqual(['291', '291', 'ORIG', 'UV82', 'A58', 'UV5G', 'F11', 'UV6', 'UV6_ORIG'].map((n) => `${n} silent`));
    expect(elapsed).toBe(9 * SEND_MS + SETTLE_MS + 7 * SCAN_SILENT_PAUSE_MS);
    const json = (result as BaofengError).toJSON();
    expect(json).toMatchObject({ reason: 'session-unavailable', retry: 'after-remedy', answers: [] });
    expect(json.remedy).not.toContain('identify');
  });

  it('lists a wrong ack by magic name and byte in answers when silence follows, after a SCAN_SILENT_PAUSE_MS pause', async () => {
    const radio = radioAcking('UV82');
    radio.ackByte = 0x15;
    const { result, attempts, names } = await scan(radio);
    expect(names.slice(2, 5)).toEqual(['ORIG silent', 'UV82 wrong-ack', 'A58 silent']);
    expect(attempts[4]!.at - attempts[3]!.at).toBe(SCAN_SILENT_PAUSE_MS + SEND_MS);
    expect((result as BaofengError).toJSON()).toMatchObject({
      reason: 'session-unavailable',
      message: expect.stringContaining('UV82 wrong-ack 15'),
      answers: [{ magic: 'UV82', outcome: 'wrong-ack', got: '15' }],
    });
  });

  it('lists a refused closing 06 in answers and pauses SETTLE_MS before the next magic', async () => {
    const radio = new FakeRadio();
    const read = radio.read.bind(radio);
    let reads = 0;
    vi.spyOn(radio, 'read').mockImplementation(async (n, ms) => (++reads === 3 ? new Uint8Array() : read(n, ms)));
    const { result, attempts, names } = await scan(radio);
    expect(names.slice(0, 2)).toEqual(['291 refused', 'ORIG silent']);
    expect(attempts[1]!.at - attempts[0]!.at).toBe(SETTLE_MS + SEND_MS);
    expect((result as BaofengError).toJSON()).toMatchObject({ reason: 'session-unavailable', answers: [{ magic: '291', outcome: 'refused', got: '' }] });
  });

  it('tries a stale pinned ORIG first and reports pin UV5R_MAGIC=291 when only 291 acks', async () => {
    const { result, names } = await scan(new FakeRadio(), { magic: magicByName('ORIG') });
    expect(names).toEqual(['ORIG silent', 'ORIG silent', '291 ident']);
    expect(result).toMatchObject({ magic: '291', pin: 'UV5R_MAGIC=291' });
  });

  it('reports pin null when the pinned magic answers first', async () => {
    const { result, names } = await scan(radioAcking('UV82'), { magic: magicByName('UV82') });
    expect(names).toEqual(['UV82 ident']);
    expect(result).toMatchObject({ magic: 'UV82', family: 'uv-82x3', pin: null });
  });

  it('ends with the block-read error when a post-ident read fails', async () => {
    const radio = new FakeRadio();
    radio.silentReadAt = 0x1ec0;
    const { result } = await scan(radio);
    expect(result).toMatchObject({ reason: 'serial-timeout' });
  });
});

describe('channels', () => {
  it('writes and reads back a channel and its name', async () => {
    const radio = new FakeRadio();
    const s = new Session(radio);
    await s.start();
    await writeChannel(s, 5, { rxHz: 154_680_000, name: 'SHERIFF' });
    const ch = await readChannel(s, 5);
    expect(ch).toMatchObject({ rxHz: 154_680_000, txHz: 154_680_000, name: 'SHERIFF' });
    expect([...radio.eeprom.subarray(5 * 16, 5 * 16 + 16)]).toEqual([...encodeChannel({ rxHz: 154_680_000 })]);
  });
  it('reports an ignored write as a device-state error', async () => {
    const radio = new FakeRadio();
    radio.writesIgnoredBelow = 0;
    radio.writesIgnoredAbove = 0x2000;
    const s = new Session(radio);
    await s.start();
    await expect(writeChannel(s, 5, { rxHz: 154_680_000 })).rejects.toMatchObject({
      kind: 'device-state',
      reason: 'verification-failed',
      message: 'channel 5 did not take the write',
      remedy: 'read channel 5, then rerun the write',
    });
  });
  it('reports an acked but ignored name write as a verification failure after the record write', async () => {
    const radio = new FakeRadio();
    radio.writesIgnoredBelow = 0x1000 + 5 * 16;
    radio.writesIgnoredAbove = 0x1000 + 6 * 16;
    const s = new Session(radio);
    await s.start();
    const err = await writeChannel(s, 5, { rxHz: 154_680_000, name: 'SHERIFF' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BaofengError);
    expect((err as BaofengError).toJSON()).toMatchObject({
      reason: 'verification-failed',
      message: 'channel 5 record written; name did not take the write',
      remedy: 'read channel 5; rerun the write to fix the name',
      retry: 'after-remedy',
    });
    expect((err as BaofengError).detail).not.toHaveProperty('recordWritten');
    expect(radio.writes).toEqual([5 * 16, 0x1000 + 5 * 16]);
  });
  it('throws the timeout unchanged when the name read-back times out after the record verified', async () => {
    const radio = new FakeRadio();
    radio.silentReadAt = 0x1000 + 5 * 16;
    const s = new Session(radio);
    await s.start();
    const err = await writeChannel(s, 5, { rxHz: 154_680_000, name: 'SHERIFF' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BaofengError);
    expect((err as BaofengError).toJSON()).toMatchObject({ reason: 'serial-timeout' });
    expect((err as BaofengError).detail).not.toHaveProperty('recordWritten');
    expect([...radio.eeprom.subarray(5 * 16, 6 * 16)]).toEqual([...encodeChannel({ rxHz: 154_680_000 })]);
    expect(radio.writes).toEqual([5 * 16, 0x1000 + 5 * 16]);
  });
  it('writes the name only after the record reads back', async () => {
    const radio = new FakeRadio();
    radio.writesIgnoredBelow = 0;
    radio.writesIgnoredAbove = 0x2000;
    const s = new Session(radio);
    await s.start();
    await expect(writeChannel(s, 5, { rxHz: 154_680_000 })).rejects.toMatchObject({ reason: 'verification-failed', message: 'channel 5 did not take the write' });
    expect(radio.writes).toEqual([5 * 16]);
  });
  it('builds the channel payload with the documented keys in order', () => {
    const ch = decodeChannel(encodeChannel({ rxHz: 146_820_000, txHz: 146_220_000, txTone: parseTone('82.5') }), encodeName('RPT'))!;
    const payload = channelPayload(3, ch);
    expect(Object.keys(payload)).toEqual(['channel', 'rxMhz', 'txMhz', 'txTone', 'rxTone', 'bandwidth', 'power', 'name']);
    expect(payload).toEqual({
      channel: 3,
      rxMhz: '146.82',
      txMhz: '146.22',
      txTone: '82.5',
      rxTone: 'none',
      bandwidth: 'wide',
      power: 'high',
      name: 'RPT',
    });
    expect(Object.keys(channelPayload(4, undefined))).toEqual(['channel', 'empty']);
    expect(channelPayload(4, { malformed: true, raw: 'ff' })).toEqual({ channel: 4, malformed: true, raw: 'ff' });
  });
  it('reads a record with malformed TX BCD as malformed with its raw bytes', async () => {
    const radio = new FakeRadio();
    const mem = encodeChannel({ rxHz: 162_550_000 });
    mem.set([0xff, 0x00, 0x00, 0x00], 4);
    radio.eeprom.set(mem, 0x0000 + 6 * 16);
    const s = new Session(radio);
    await s.start();
    expect(await readChannel(s, 6)).toEqual({ malformed: true, raw: hex(mem) });
  });
  it('reads a record with a 0xFF first byte as empty whatever follows', async () => {
    const radio = new FakeRadio();
    radio.eeprom.set([0xff, 0x00, 0x00, 0x00, 0x12], 0x0000 + 6 * 16);
    const s = new Session(radio);
    await s.start();
    expect(await readChannel(s, 6)).toBeUndefined();
  });
  it('reports a TX-inhibited record with a null txMhz', async () => {
    const radio = new FakeRadio();
    const mem = encodeChannel({ rxHz: 162_550_000 });
    mem.set([0xff, 0xff, 0xff, 0xff], 4);
    radio.eeprom.set(mem, 0x0000 + 7 * 16);
    radio.eeprom.set(encodeName('WX'), 0x1000 + 7 * 16);
    const s = new Session(radio);
    await s.start();
    const ch = await readChannel(s, 7);
    expect(ch).toMatchObject({ rxHz: 162_550_000, txHz: null, name: 'WX' });
    expect(channelPayload(7, ch)).toMatchObject({ channel: 7, rxMhz: '162.55', txMhz: null, name: 'WX' });
  });
});

describe('tune', () => {
  it('writes the record and name and nothing in the settings page', async () => {
    const radio = new FakeRadio();
    const ch = await tune(radio, 5, { rxHz: 162_550_000, name: 'WX' });
    expect(ch).toMatchObject({ rxHz: 162_550_000, name: 'WX' });
    expect(radio.writes).toEqual([5 * 16, 0x1000 + 5 * 16]);
    expect(radio.writes.some((a) => a >= 0x0e40 && a <= 0x0e7f)).toBe(false);
  });
  it('leaves the channel in place after the reload', async () => {
    const radio = new FakeRadio();
    await tune(radio, 5, { rxHz: 162_550_000 });
    const ch = await readChannel(await nextSession(radio), 5);
    expect(ch).toMatchObject({ rxHz: 162_550_000, name: '162.55' });
  });
});

describe('tune over an existing slot', () => {
  it('keeps BCL, PTT-ID and S-code from the record it replaces', async () => {
    const radio = new FakeRadio();
    const old = encodeChannel({ rxHz: 146_520_000 });
    old[12] = 0x05;
    old[15] = 0x40 | 0x08 | 0x04 | 0x02;
    radio.eeprom.set(old, 5 * 16);
    await tune(radio, 5, { rxHz: 146_820_000, txHz: 146_220_000 });
    const mem = radio.eeprom.subarray(5 * 16, 6 * 16);
    expect(mem[12]! & 0x0f).toBe(5);
    expect(mem[15]! & 0x08).toBe(0x08);
    expect(mem[15]! & 0x03).toBe(2);
    expect(await readChannel(await nextSession(radio), 5)).toMatchObject({ rxHz: 146_820_000, txHz: 146_220_000, bcl: true, scan: true });
  });
  it('writes scan on and BCL off over an erased slot', async () => {
    const radio = new FakeRadio();
    const ch = await tune(radio, 5, { rxHz: 146_520_000 });
    expect(ch).toMatchObject({ scan: true, bcl: false });
    expect(radio.eeprom[5 * 16 + 15]! & 0x0f).toBe(0x04);
  });
  it('writes a receive-only channel with the TX-inhibit marker', async () => {
    const radio = new FakeRadio();
    const ch = await tune(radio, 5, { rxHz: 155_475_000, rxOnly: true });
    expect(ch.txHz).toBeNull();
    expect([...radio.eeprom.subarray(5 * 16 + 4, 5 * 16 + 8)]).toEqual([0xff, 0xff, 0xff, 0xff]);
  });
  it('replaces the TX-inhibit marker with a TX frequency when rxOnly is unset', async () => {
    const radio = new FakeRadio();
    await tune(radio, 5, { rxHz: 155_475_000, rxOnly: true });
    radio.dropSession();
    const ch = await tune(radio, 5, { rxHz: 155_475_000 });
    expect(ch.txHz).toBe(155_475_000);
  });
});

describe('status', () => {
  it('returns firmware, family, magic, ident, work mode and the audio settings', async () => {
    const radio = new FakeRadio();
    const s = new Session(radio);
    await s.start();
    const st = await readStatus(s);
    expect(st).toEqual({
      firmware: 'HN5RV011',
      firmwareHex: '48 4e 35 52 56 30 31 31 ff ff ff ff ff ff',
      family: 'uv5r',
      magic: '291',
      ident: 'aa 30 76 04 00 05 20 dd',
      workmode: 'vfo',
      squelch: 3,
      voice: 'eng',
      beep: 'on',
      abr: 5,
    });
    for (const key of ['channelA', 'channelB', 'channel', 'empty', 'rxMhz', 'name', 'note']) expect(st).not.toHaveProperty(key);
  });
  it('reads the settings block from the page values despite the 16-byte read alias', async () => {
    const radio = new FakeRadio();
    for (let a = 0x0e00; a < 0x0e80; a++) radio.eeprom[a] = a & 0xff;
    const s = await withSession(radio, async (s) => s);
    expect(await readSettings(s)).toEqual(decodeSettings(radio.eeprom.subarray(SETTINGS_BASE, SETTINGS_BASE + SETTINGS_SIZE)));
  });
  it('reads work mode and a zeroed settings block despite the 16-byte read alias', async () => {
    const radio = new FakeRadio();
    radio.eeprom[ADDR.workmode] = 1;
    radio.eeprom.fill(0, 0x0e20, 0x0e40);
    const s = new Session(radio);
    await s.start();
    const st = await readStatus(s);
    expect(st).toMatchObject({ workmode: 'channel', squelch: 0, voice: 'off', beep: 'off', abr: 0 });
  });
});
