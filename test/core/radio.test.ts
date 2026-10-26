import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ADDR, SETTINGS_BASE, SETTINGS_SIZE, decodeChannel, decodeSettings, encodeChannel, encodeName, parseTone, type ChannelSpec } from '../../src/core/codec.ts';
import { BaofengError, TransportError, UsageError } from '../../src/core/errors.ts';
import { FOREIGN_MAGICS, MAGICS, PROGRAM_MAGICS, magicByName } from '../../src/core/ident.ts';
import { SETTLE_MS, Session, attempt, hex } from '../../src/core/protocol.ts';
import {
  KEY_SIGNALS,
  PROGRAM_PAUSE_MS,
  PTT_CONTROL_TIMEOUT_MS,
  SCAN_WRONG_ACK_PAUSE_MS,
  STOP_GRACE_MS,
  channelPayload,
  eraseChannel,
  identify,
  keyWhile,
  readChannel,
  readSettings,
  readStatus,
  withSession,
  writeChannel,
  type IdentifyAttempt,
  type SessionOptions,
} from '../../src/core/radio.ts';
import { FakeRadio } from './fake.ts';

const WRONG_ACK_REMEDY = 'run uv5r identify with no UV5R_MAGIC prefix and put the pin line it prints before every later uv5r command, as in UV5R_MAGIC=ORIG uv5r status; when pin is null, run later commands with no prefix';
const NO_HANDSHAKE_REMEDY = `ask the human to check the radio is on and the cable is seated; if both hold, ${WRONG_ACK_REMEDY}`;

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

/** A 9-byte ident, one byte longer than the bench ident. */
const NINE_BYTES = Uint8Array.from([0xaa, 0x30, 0x76, 0x04, 0x00, 0x05, 0x20, 0x00, 0xdd]);

/** Make `radio` answer the closing 06 with nothing. */
function refuseClosingAck(radio: FakeRadio): void {
  const read = radio.read.bind(radio);
  let reads = 0;
  vi.spyOn(radio, 'read').mockImplementation(async (n, ms) => (++reads === 3 ? new Uint8Array() : read(n, ms)));
}

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
    expect(read.mock.calls[1]).toEqual([14, 350]);
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
    radio.identReply = NINE_BYTES;
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
      message: 'radio answered the clone handshake with 15',
      remedy: WRONG_ACK_REMEDY,
      retry: 'after-remedy',
      got: '15',
    });
    expect(radio.handshakes).toHaveLength(2);
  });

  it('names the wrong ack byte from the first attempt when the second attempt is silent with magic 291', async () => {
    const radio = new FakeRadio();
    radio.ackByte = 0x15;
    const write = radio.write.bind(radio);
    vi.spyOn(radio, 'write').mockImplementation((bytes) => {
      write(bytes);
      if (radio.handshakes.length === 1) radio.handshakesIgnored = 1;
    });
    const err = await settled(new Session(radio).start());
    expect((err as BaofengError).toJSON()).toMatchObject({
      reason: 'session-unavailable',
      message: 'radio answered the clone handshake with 15',
      remedy: WRONG_ACK_REMEDY,
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
    refuseClosingAck(radio);
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

  it('fails with radio-unsupported naming the BF-A58 on a BFT515 version with magic A58 and leaves the ident unset', async () => {
    const radio = new FakeRadio();
    const a58 = magicByName('A58');
    radio.magics = [a58.bytes];
    radio.firmware = 'BFT515 ';
    const session = new Session(radio);
    const err = await settled(session.start(a58));
    expect((err as BaofengError).toJSON()).toMatchObject({
      reason: 'radio-unsupported',
      message: expect.stringContaining('BF-A58'),
      radio: 'Baofeng BF-A58',
      magic: 'A58',
      got: 'aa 30 76 04 00 05 20 dd',
    });
    expect(session.ident).toBeUndefined();
  });

  it('reports all 12 bytes of a 12-byte ident in got on a BFT515 version with magic A58', async () => {
    const radio = new FakeRadio();
    const a58 = magicByName('A58');
    radio.magics = [a58.bytes];
    radio.firmware = 'BFT515 ';
    radio.identReply = Uint8Array.from([0xaa, 0x01, 0x01, 0x36, 0x01, 0x74, 0x01, 0x04, 0x00, 0x05, 0x20, 0xdd]);
    const err = await settled(new Session(radio).start(a58));
    expect((err as BaofengError).toJSON()).toMatchObject({ reason: 'radio-unsupported', radio: 'Baofeng BF-A58', magic: 'A58', got: 'aa 01 01 36 01 74 01 04 00 05 20 dd' });
  });

  it('fails with a usage error and writes nothing when start gets the unsupported magic F11', async () => {
    const radio = new FakeRadio();
    const f11 = MAGICS.find((m) => m.name === 'F11')!;
    radio.magics = [f11.bytes];
    const write = vi.spyOn(radio, 'write');
    const session = new Session(radio);
    const err = await settled(session.start(f11));
    expect((err as BaofengError).toJSON()).toMatchObject({ magic: 'F11' });
    expect(err).toBeInstanceOf(UsageError);
    expect(write).not.toHaveBeenCalled();
    expect(session.ident).toBeUndefined();
  });

  it('stops after the ident without the closing 06 when attempt runs without confirm, magic 291', async () => {
    const radio = new FakeRadio();
    const write = vi.spyOn(radio, 'write');
    const outcome = await settled(attempt(radio, magicByName('291'), { confirm: false }));
    expect(outcome).toEqual({ kind: 'ident', bytes: radio.ident, got: hex(radio.ident) });
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
  /** Ack wait of each attempt that gets no 06; the fake answers at once, so the budget adds it per attempt. */
  const ACK_WAIT_MS = 1200;
  /** The budget for a silent cable across the three phases: 29.26 s rounded up. */
  const BUDGET_MS = 29_300;
  /** Fake time of a silent scan: 18 attempts at 9600, SETTLE_MS before the second 291 and PROGRAM_PAUSE_MS between the two at 115200. */
  const SILENT_ELAPSED_MS = 18 * SEND_MS + SETTLE_MS + PROGRAM_PAUSE_MS;
  const CLASSIC = ['291', '291', 'ORIG', 'ORIG', 'UV82', 'UV82', 'A58', 'A58', 'UV5G', 'UV5G', 'F11', 'UV6', 'UV6_ORIG'];
  const FOREIGN = FOREIGN_MAGICS.map((m) => m.radio);
  const PROGRAM = PROGRAM_MAGICS.map((m) => m.name);
  const POWER_CYCLE_REMEDY = 'ask the human to power-cycle the radio and report the radio name; this CLI speaks the classic UV-5R protocol';
  const resetFails = (rate: number) => new TransportError('serial-io-failed', `cannot set ${rate} baud: EIO`, { target: 'fake', baud: rate });

  /** Return the bytes of the foreign magic for `radio`. */
  const foreignMagic = (radio: string) => FOREIGN_MAGICS.find((m) => m.radio === radio)!.bytes;
  /** Return the bytes of the program magic `ascii`. */
  const programMagic = (ascii: string) => PROGRAM_MAGICS.find((m) => m.name === ascii)!.bytes;

  /** Return a fake radio that acks no classic magic. */
  function silentRadio(): FakeRadio {
    const radio = new FakeRadio();
    radio.magics = [];
    return radio;
  }

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
    expect(attempts[2]!.at - attempts[1]!.at).toBe(SEND_MS);
    expect(elapsed).toBe(3 * SEND_MS + SETTLE_MS + FINISH_MS);
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
    expect(names).toHaveLength(CLASSIC.length - 1 + FOREIGN.length + PROGRAM.length);
    expect(result).toBeInstanceOf(BaofengError);
    expect((result as BaofengError).toJSON()).toMatchObject({
      reason: 'protocol-reply-invalid',
      message: expect.stringContaining('unknown UV-5R variant'),
      magic: '291',
      got: 'aa 30 76 04 00 05 20 00 dd',
    });
  });

  it('lists an invalid ident on the unsupported F11 in answers and ends with session-unavailable when silence follows', async () => {
    const radio = radioAcking('F11');
    radio.identReply = NINE_BYTES;
    const { result, names } = await scan(radio);
    expect(names.slice(9, 13)).toEqual(['UV5G silent', 'F11 invalid', 'UV6 silent', 'UV6_ORIG silent']);
    expect(names).toHaveLength(20);
    expect((result as BaofengError).toJSON()).toMatchObject({
      reason: 'session-unavailable',
      message: expect.stringContaining('F11 invalid aa 30 76 04 00 05 20 00 dd'),
      retry: 'no',
      answers: [{ magic: 'F11', outcome: 'invalid', got: 'aa 30 76 04 00 05 20 00 dd' }],
    });
  });

  it('reports radio-unsupported naming the UV-6 on a UV6 ack, with no closing 06 and no block read', async () => {
    const radio = radioAcking('UV6');
    const write = vi.spyOn(radio, 'write');
    const { result, names } = await scan(radio);
    expect(names).toEqual([...CLASSIC.slice(0, 11).map((n) => `${n} silent`), 'UV6 ident']);
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

  it('reports all 12 bytes of a 12-byte ident in got on a UV6 ack', async () => {
    const radio = radioAcking('UV6');
    radio.identReply = Uint8Array.from([0xaa, 0x01, 0x01, 0x36, 0x01, 0x74, 0x01, 0x04, 0x00, 0x05, 0x20, 0xdd]);
    const { result, names } = await scan(radio);
    expect(names.at(-1)).toBe('UV6 ident');
    expect((result as BaofengError).toJSON()).toMatchObject({ reason: 'radio-unsupported', radio: 'Baofeng UV-6', magic: 'UV6', got: 'aa 01 01 36 01 74 01 04 00 05 20 dd' });
  });

  it('reports radio-unsupported naming the BF-A58 on an A58 ack with a BFT517 version', async () => {
    const radio = radioAcking('A58');
    radio.firmware = 'BFT517 ';
    const { result, names } = await scan(radio);
    expect(names.at(-1)).toBe('A58 ident');
    expect((result as BaofengError).toJSON()).toMatchObject({
      reason: 'radio-unsupported',
      message: expect.stringContaining('BF-A58'),
      radio: 'Baofeng BF-A58',
      magic: 'A58',
      got: 'aa 30 76 04 00 05 20 dd',
    });
  });

  it('reports all 12 bytes of a 12-byte ident in got on an A58 ack with a BFT515 version', async () => {
    const radio = radioAcking('A58');
    radio.firmware = 'BFT515 ';
    radio.identReply = Uint8Array.from([0xaa, 0x01, 0x01, 0x36, 0x01, 0x74, 0x01, 0x04, 0x00, 0x05, 0x20, 0xdd]);
    const { result, names } = await scan(radio);
    expect(names.at(-1)).toBe('A58 ident');
    expect((result as BaofengError).toJSON()).toMatchObject({ reason: 'radio-unsupported', radio: 'Baofeng BF-A58', magic: 'A58', got: 'aa 01 01 36 01 74 01 04 00 05 20 dd' });
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

  it('gives session-unavailable with empty answers and a remedy without identify on silence through all three phases, within the budget', async () => {
    const radio = silentRadio();
    const { result, attempts, names, elapsed } = await scan(radio);
    expect(names).toEqual([...CLASSIC, ...FOREIGN, ...PROGRAM].map((n) => `${n} silent`));
    expect(attempts.map((a) => a.baud)).toEqual([...new Array(18).fill(9600), ...new Array(2).fill(115200)]);
    const gaps = attempts.slice(1).map((a, i) => a.at - attempts[i]!.at);
    expect(gaps).toEqual([SETTLE_MS + SEND_MS, ...new Array(16).fill(SEND_MS), 0, PROGRAM_PAUSE_MS]);
    expect(elapsed).toBe(SILENT_ELAPSED_MS);
    expect(elapsed + 20 * ACK_WAIT_MS).toBeLessThanOrEqual(BUDGET_MS);
    const json = (result as BaofengError).toJSON();
    expect(json).toMatchObject({
      reason: 'session-unavailable',
      message: 'radio did not answer any classic magic, foreign magic or 115200 program magic',
      remedy: 'ask the human to check the radio is on and the cable is seated',
      retry: 'after-remedy',
      answers: [],
    });
    expect(json.remedy).not.toContain('identify');
    expect(radio.rate).toBe(9600);
  });

  it('lists a foreign invalid ident in answers and pauses SETTLE_MS after it', async () => {
    const radio = silentRadio();
    radio.foreignMagic = foreignMagic('UV-6R');
    radio.foreignIdent = NINE_BYTES;
    const { result, attempts, names, elapsed } = await scan(radio);
    expect(names.slice(13, 18)).toEqual(['BTECH UV-5X3 silent', 'MTC UV-5R-3 silent', 'UV-6R invalid', 'UV-9G silent', 'Baojie BJ-UV55 silent']);
    expect(attempts[16]!.at - attempts[15]!.at).toBe(SETTLE_MS + SEND_MS);
    expect(names).toHaveLength(20);
    expect(elapsed).toBe(SILENT_ELAPSED_MS + SETTLE_MS);
    expect(elapsed).toBeLessThanOrEqual(BUDGET_MS);
    expect((result as BaofengError).toJSON()).toMatchObject({
      reason: 'session-unavailable',
      message: expect.stringContaining('UV-6R invalid aa 30 76 04 00 05 20 00 dd'),
      answers: [{ magic: 'UV-6R', outcome: 'invalid', got: 'aa 30 76 04 00 05 20 00 dd' }],
    });
  });

  it('names the BTECH UV-5X3 on a 14-byte ident to its magic, with no closing 06 after the ident', async () => {
    const radio = silentRadio();
    radio.foreignMagic = foreignMagic('BTECH UV-5X3');
    const write = vi.spyOn(radio, 'write');
    const { result, names } = await scan(radio);
    expect(names).toEqual([...CLASSIC.map((n) => `${n} silent`), 'BTECH UV-5X3 foreign']);
    expect((result as BaofengError).toJSON()).toMatchObject({
      reason: 'radio-unsupported',
      message: expect.stringContaining('BTECH UV-5X3'),
      retry: 'no',
      remedy: 'report the radio name to the human; this CLI speaks the classic UV-5R protocol',
      radio: 'BTECH UV-5X3',
      magic: '50 0d 0c 20 16 03 28',
      got: `aa ${new Array(12).fill('30').join(' ')} dd`,
    });
    expect(writesAfterIdentRequest(write)).toEqual([]);
    expect(radio.rate).toBe(9600);
  });

  it('names the UV-6R on an 8-byte ident to its magic', async () => {
    const radio = silentRadio();
    radio.foreignMagic = foreignMagic('UV-6R');
    radio.foreignIdent = radio.ident;
    const write = vi.spyOn(radio, 'write');
    const { result, names } = await scan(radio);
    expect(names.slice(13)).toEqual(['BTECH UV-5X3 silent', 'MTC UV-5R-3 silent', 'UV-6R ident']);
    expect((result as BaofengError).toJSON()).toMatchObject({ reason: 'radio-unsupported', radio: 'UV-6R', magic: '50 bb ff 20 14 11 22', got: 'aa 30 76 04 00 05 20 dd' });
    expect(writesAfterIdentRequest(write)).toEqual([]);
  });

  it('acks a program magic only at 115200', async () => {
    const radio = new FakeRadio();
    radio.programMagic = programMagic('PROGRAMBFNORMALU');
    radio.write(radio.programMagic);
    expect([...(await radio.read(1, 0))]).toEqual([]);
    await radio.setBaud(115200);
    radio.write(radio.magics[0]!);
    expect([...(await radio.read(1, 0))]).toEqual([]);
    radio.write(radio.programMagic);
    expect([...(await radio.read(1, 0))]).toEqual([0x06]);
  });

  it('names the UV17Pro group on a PROGRAMBFNORMALU ack at 115200 with powerCycle and the power-cycle remedy, and returns to 9600', async () => {
    const radio = silentRadio();
    radio.programMagic = programMagic('PROGRAMBFNORMALU');
    const setBaud = vi.spyOn(radio, 'setBaud');
    const write = vi.spyOn(radio, 'write');
    const { result, attempts } = await scan(radio);
    expect(attempts.at(-1)).toMatchObject({ name: 'PROGRAMBFNORMALU', baud: 115200, outcome: 'ack' });
    expect(attempts).toHaveLength(19);
    expect((result as BaofengError).toJSON()).toMatchObject({
      reason: 'radio-unsupported',
      message: expect.stringContaining('UV17Pro family'),
      remedy: POWER_CYCLE_REMEDY,
      retry: 'no',
      radio: expect.stringMatching(/^UV17Pro family: UV-17Pro/),
      magic: 'PROGRAMBFNORMALU',
      got: '06',
      powerCycle: true,
    });
    expect(write.mock.calls.at(-1)![0]).toEqual(radio.programMagic);
    expect(setBaud.mock.calls).toEqual([[115200], [9600]]);
    expect(radio.rate).toBe(9600);
  });

  it('keeps the scan error when the reset to 9600 also fails', async () => {
    const radio = silentRadio();
    radio.programMagic = programMagic('PROGRAMBFNORMALU');
    const setBaud = radio.setBaud.bind(radio);
    vi.spyOn(radio, 'setBaud').mockImplementation(async (rate) => {
      if (rate === 9600) throw resetFails(rate);
      return setBaud(rate);
    });
    const { result } = await scan(radio);
    expect((result as BaofengError).toJSON()).toMatchObject({ reason: 'radio-unsupported', powerCycle: true });
  });

  it('ends with the reset error when the scan raised none', async () => {
    const radio = silentRadio();
    vi.spyOn(radio, 'setBaud').mockImplementation(async (rate) => {
      if (rate === 9600) throw resetFails(rate);
    });
    const { result, names } = await scan(radio);
    expect(names).toHaveLength(20);
    expect((result as BaofengError).toJSON()).toMatchObject({ reason: 'serial-io-failed', baud: 9600 });
  });

  it('sets 9600 again when the switch to 115200 fails, and ends with the switch error', async () => {
    const radio = silentRadio();
    const setBaud = vi.spyOn(radio, 'setBaud').mockImplementation(async (rate) => {
      if (rate === 115200) throw resetFails(rate);
    });
    const { result, names } = await scan(radio);
    expect(names).toHaveLength(18);
    expect(setBaud.mock.calls).toEqual([[115200], [9600]]);
    expect((result as BaofengError).toJSON()).toMatchObject({ reason: 'serial-io-failed', baud: 115200 });
  });

  it('sets 9600 again when a read at 115200 fails, and ends with the read error', async () => {
    const radio = silentRadio();
    const failure = new TransportError('serial-io-failed', 'cannot read: EIO', { target: 'fake' });
    const read = radio.read.bind(radio);
    vi.spyOn(radio, 'read').mockImplementation(async (n, ms) => {
      if (radio.rate === 115200) throw failure;
      return read(n, ms);
    });
    const setBaud = vi.spyOn(radio, 'setBaud');
    const { result, names } = await scan(radio);
    expect(names).toHaveLength(18);
    expect(setBaud.mock.calls).toEqual([[115200], [9600]]);
    expect(radio.rate).toBe(9600);
    expect(result).toBe(failure);
  });

  it('discards a stray byte from the switch to 115200 before the first program magic', async () => {
    const radio = silentRadio();
    radio.programMagic = programMagic('PROGRAMBFNORMALU');
    const setBaud = radio.setBaud.bind(radio);
    vi.spyOn(radio, 'setBaud').mockImplementation(async (rate) => {
      await setBaud(rate);
      if (rate === 115200) radio.queueStale([0x00]);
    });
    const { result, names } = await scan(radio);
    expect(names.slice(18)).toEqual(['PROGRAMBFNORMALU ack']);
    expect((result as BaofengError).toJSON()).toMatchObject({ reason: 'radio-unsupported', magic: 'PROGRAMBFNORMALU', got: '06' });
  });

  it('lists each wrong ack at 115200 in answers', async () => {
    const radio = silentRadio();
    const read = radio.read.bind(radio);
    vi.spyOn(radio, 'read').mockImplementation(async (n, ms) => (radio.rate === 115200 ? Uint8Array.of(0x15) : read(n, ms)));
    const { result, names } = await scan(radio);
    expect(names.slice(18)).toEqual(PROGRAM.map((n) => `${n} wrong-ack`));
    expect((result as BaofengError).toJSON()).toMatchObject({
      reason: 'session-unavailable',
      message: 'radio opened no clone session; answers: PROGRAMBFNORMALU wrong-ack 15, PROGRAMCOLORPROU wrong-ack 15',
      remedy: 'report the answers to the human; the radio answers but opens no session with a known magic',
      retry: 'no',
      answers: PROGRAM.map((magic) => ({ magic, outcome: 'wrong-ack', got: '15' })),
    });
  });

  it('retries a wrong ack after SCAN_WRONG_ACK_PAUSE_MS and lists both in answers when silence follows', async () => {
    const radio = radioAcking('UV82');
    radio.ackByte = 0x15;
    const { result, attempts, names } = await scan(radio);
    expect(names.slice(3, 7)).toEqual(['ORIG silent', 'UV82 wrong-ack', 'UV82 wrong-ack', 'A58 silent']);
    expect(attempts[5]!.at - attempts[4]!.at).toBe(SCAN_WRONG_ACK_PAUSE_MS + SEND_MS);
    expect(attempts[6]!.at - attempts[5]!.at).toBe(SCAN_WRONG_ACK_PAUSE_MS + SEND_MS);
    expect((result as BaofengError).toJSON()).toMatchObject({
      reason: 'session-unavailable',
      message: expect.stringContaining('UV82 wrong-ack 15'),
      answers: [
        { magic: 'UV82', outcome: 'wrong-ack', got: '15' },
        { magic: 'UV82', outcome: 'wrong-ack', got: '15' },
      ],
    });
  });

  it('lists a refused closing 06 in answers, pauses SETTLE_MS before the next magic and ends with retry once', async () => {
    const radio = new FakeRadio();
    refuseClosingAck(radio);
    const { result, attempts, names } = await scan(radio);
    expect(names.slice(0, 2)).toEqual(['291 refused', 'ORIG silent']);
    expect(attempts[1]!.at - attempts[0]!.at).toBe(SETTLE_MS + SEND_MS);
    expect((result as BaofengError).toJSON()).toMatchObject({
      reason: 'session-unavailable',
      remedy: 'wait 3 s and rerun the command',
      retry: 'once',
      answers: [{ magic: '291', outcome: 'refused', got: '' }],
    });
  });

  it('pauses SETTLE_MS after a wrong ack on the first magic and SCAN_WRONG_ACK_PAUSE_MS after the second', async () => {
    const radio = new FakeRadio();
    radio.ackByte = 0x15;
    const { attempts, names } = await scan(radio);
    expect(names.slice(0, 3)).toEqual(['291 wrong-ack', '291 wrong-ack', 'ORIG silent']);
    expect(attempts[1]!.at - attempts[0]!.at).toBe(SETTLE_MS + SEND_MS);
    expect(attempts[2]!.at - attempts[1]!.at).toBe(SCAN_WRONG_ACK_PAUSE_MS + SEND_MS);
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

describe('keyWhile', () => {
  /** Return a player that resolves when `stop` resolves and records PTT at that moment. */
  function stoppablePlayer(radio: FakeRadio) {
    const seen: { pttAtStop?: boolean } = {};
    const body = async (stop: Promise<void>) => {
      await stop;
      seen.pttAtStop = radio.ptt;
    };
    return { seen, body };
  }

  const listeners = (em: EventEmitter) => KEY_SIGNALS.reduce((n, s) => n + em.listenerCount(s), 0);

  afterEach(() => {
    vi.useRealTimers();
  });

  it('raises PTT before the body runs and releases it when the body settles', async () => {
    const radio = new FakeRadio();
    let pttAtStart: boolean | undefined;
    const result = await keyWhile(
      radio,
      async () => {
        pttAtStart = radio.ptt;
      },
      { maxMs: 5000 },
      new EventEmitter(),
    );
    expect(pttAtStart).toBe(true);
    expect(radio.pttLog).toEqual([true, false]);
    expect(result).toEqual({ pttAsserted: true, seconds: 0, released: true });
  });

  it.each(['SIGINT', 'SIGTSTP'] as const)('releases PTT before the player settles on %s mid-play', async (signal) => {
    const radio = new FakeRadio();
    const em = new EventEmitter();
    const { seen, body } = stoppablePlayer(radio);
    const pending = keyWhile(radio, body, { maxMs: 5000 }, em);
    setTimeout(() => em.emit(signal), 20);
    const result = await pending;
    expect(seen.pttAtStop).toBe(false);
    expect(radio.pttLog).toEqual([true, false]);
    expect(result).toMatchObject({ pttAsserted: true, released: true, interrupted: signal });
    expect(listeners(em)).toBe(0);
  });

  it('skips the body and releases at once on a signal during the PTT assertion', async () => {
    const radio = new FakeRadio();
    const em = new EventEmitter();
    const assert = radio.setPtt.bind(radio);
    radio.setPtt = async (on: boolean) => {
      if (on) em.emit('SIGTERM');
      await assert(on);
    };
    let ran = false;
    const result = await keyWhile(
      radio,
      async () => {
        ran = true;
      },
      { maxMs: 5000 },
      em,
    );
    expect(ran).toBe(false);
    expect(radio.pttLog).toEqual([true, false]);
    expect(result).toEqual({ pttAsserted: true, seconds: 0, released: true, interrupted: 'SIGTERM' });
  });

  it('drops PTT at maxMs on a hung player and returns after the grace', async () => {
    vi.useFakeTimers();
    const radio = new FakeRadio();
    const pending = keyWhile(radio, () => new Promise(() => {}), { maxMs: 100 }, new EventEmitter());
    await vi.advanceTimersByTimeAsync(100);
    expect(radio.ptt).toBe(false);
    let done = false;
    void pending.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS - 10);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toMatchObject({ pttAsserted: true, released: true, timedOut: true });
    expect(radio.pttLog).toEqual([true, false]);
  });

  it('keeps PTT low when the player completes late, inside or after the grace', async () => {
    vi.useFakeTimers();
    for (const lateMs of [500, STOP_GRACE_MS + 500]) {
      const radio = new FakeRadio();
      const em = new EventEmitter();
      const body = (stop: Promise<void>) => stop.then(() => new Promise<void>((_, reject) => setTimeout(() => reject(new Error('player exited late')), lateMs)));
      const pending = keyWhile(radio, body, { maxMs: 5000 }, em);
      await vi.advanceTimersByTimeAsync(10);
      em.emit('SIGHUP');
      await vi.advanceTimersByTimeAsync(0);
      expect(radio.ptt).toBe(false);
      await vi.advanceTimersByTimeAsync(STOP_GRACE_MS + 1000);
      expect(await pending).toMatchObject({ released: true, interrupted: 'SIGHUP' });
      expect(radio.pttLog).toEqual([true, false]);
    }
  });

  it('keeps the player failure when the release fails too', async () => {
    const radio = new FakeRadio();
    radio.setPtt = async (on: boolean) => {
      radio.pttLog.push(on);
      if (!on) throw new TransportError('ptt-control-failed', 'release failed');
      radio.ptt = on;
    };
    const err = await keyWhile(
      radio,
      async () => {
        throw new TransportError('audio-process-failed', 'ffmpeg exited with code 1');
      },
      { maxMs: 5000 },
      new EventEmitter(),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    const body = (err as TransportError).toJSON();
    expect(body).toMatchObject({ reason: 'audio-process-failed', retry: 'no', remedy: 'ask the human to unplug the AIOC to drop PTT', seconds: 0 });
    expect(body.message).toBe('ffmpeg exited with code 1; PTT release unconfirmed: release failed; ask the human to unplug the AIOC to drop PTT');
    expect(radio.pttLog).toEqual([true, false]);
  });

  it('keeps the player failure and its guidance when the release succeeds', async () => {
    const radio = new FakeRadio();
    const err = await keyWhile(
      radio,
      async () => {
        throw new TransportError('audio-process-failed', 'ffmpeg exited with code 1', {}, { remedy: 'reseat the AIOC', retry: 'after-remedy' });
      },
      { maxMs: 5000 },
      new EventEmitter(),
    ).catch((e: unknown) => e);
    expect((err as TransportError).toJSON()).toEqual({ reason: 'audio-process-failed', message: 'ffmpeg exited with code 1', remedy: 'reseat the AIOC', retry: 'after-remedy', seconds: 0 });
    expect(radio.pttLog).toEqual([true, false]);
  });

  it('fails as a transport error with interrupted when the release fails after a signal', async () => {
    const radio = new FakeRadio();
    const em = new EventEmitter();
    radio.setPtt = async (on: boolean) => {
      radio.pttLog.push(on);
      if (!on) throw new Error('release failed');
      radio.ptt = on;
    };
    const { body } = stoppablePlayer(radio);
    const pending = keyWhile(radio, body, { maxMs: 5000 }, em);
    setTimeout(() => em.emit('SIGINT'), 20);
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).kind).toBe('transport');
    expect((err as TransportError).toJSON()).toMatchObject({ reason: 'ptt-control-failed', interrupted: 'SIGINT', remedy: 'ask the human to unplug the AIOC to drop PTT', retry: 'no' });
    expect(listeners(em)).toBe(0);
  });

  it('fails a hung assertion after PTT_CONTROL_TIMEOUT_MS and still releases', async () => {
    vi.useFakeTimers();
    const radio = new FakeRadio();
    const release = radio.setPtt.bind(radio);
    radio.setPtt = (on: boolean) => (on ? new Promise<void>(() => radio.pttLog.push(on)) : release(on));
    let ran = false;
    const pending = keyWhile(
      radio,
      async () => {
        ran = true;
      },
      { maxMs: 60_000 },
      new EventEmitter(),
    ).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(PTT_CONTROL_TIMEOUT_MS);
    const err = (await pending) as TransportError;
    expect(err).toBeInstanceOf(TransportError);
    expect(err.toJSON()).toMatchObject({
      reason: 'ptt-control-failed',
      message: 'PTT assertion unconfirmed: the port did not confirm PTT high within 3 s; PTT released',
      retry: 'no',
    });
    expect(ran).toBe(false);
    expect(radio.pttLog).toEqual([true, false]);
  });

  it('reports a hung release as unconfirmed with the unplug remedy', async () => {
    vi.useFakeTimers();
    const radio = new FakeRadio();
    const assert = radio.setPtt.bind(radio);
    radio.setPtt = (on: boolean) => (on ? assert(on) : new Promise<void>(() => radio.pttLog.push(on)));
    const pending = keyWhile(radio, async () => {}, { maxMs: 60_000 }, new EventEmitter()).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(PTT_CONTROL_TIMEOUT_MS - 1);
    let done = false;
    void pending.then(() => (done = true));
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = (await pending) as TransportError;
    expect(err.toJSON()).toMatchObject({
      reason: 'ptt-control-failed',
      message: 'PTT rose and the release is unconfirmed: the port did not confirm PTT low within 3 s; ask the human to unplug the AIOC to drop PTT',
      remedy: 'ask the human to unplug the AIOC to drop PTT',
      retry: 'no',
    });
    expect(radio.pttLog).toEqual([true, false]);
  });

  it('ignores a player rejection that follows the stop', async () => {
    const radio = new FakeRadio();
    const em = new EventEmitter();
    const pending = keyWhile(
      radio,
      async (stop) => {
        await stop;
        throw new TransportError('audio-process-failed', 'ffmpeg killed after a signal to uv5r');
      },
      { maxMs: 5000 },
      em,
    );
    setTimeout(() => em.emit('SIGINT'), 20);
    expect(await pending).toMatchObject({ released: true, interrupted: 'SIGINT' });
  });
});
