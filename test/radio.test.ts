import { describe, expect, it } from 'vitest';
import { ADDR, SETTINGS_BASE, SETTINGS_SIZE, decodeChannel, decodeSettings, encodeChannel, encodeName, parseTone, type ChannelSpec } from '../src/codec.ts';
import { BaofengError } from '../src/errors.ts';
import { Session } from '../src/protocol.ts';
import { STATUS_NOTE, channelPayload, eraseChannel, readChannel, readSettings, readStatus, withSession, writeChannel } from '../src/radio.ts';
import { FakeRadio } from './fake.ts';

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
      kind: 'device-state',
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
    expect((err as BaofengError).toJSON()).toMatchObject({ kind: 'timeout', reason: 'serial-timeout' });
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
  it('returns the flat payload with the note', async () => {
    const radio = new FakeRadio();
    radio.eeprom[ADDR.mrchb] = 5;
    const s = new Session(radio);
    await s.start();
    await writeChannel(s, 5, { rxHz: 154_680_000, name: 'SHERIFF' });
    const st = await readStatus(await nextSession(radio));
    expect(st).toEqual({
      firmware: 'HN5RV011',
      workmode: 'vfo',
      channelA: 0x7f,
      channelB: 5,
      squelch: 3,
      voice: 'eng',
      beep: 'on',
      abr: 5,
      channel: 5,
      rxMhz: '154.68',
      txMhz: '154.68',
      txTone: 'none',
      rxTone: 'none',
      bandwidth: 'wide',
      power: 'high',
      name: 'SHERIFF',
      note: STATUS_NOTE,
    });
    expect(STATUS_NOTE).toBe('channelA/B are the values stored in EEPROM; the radio display shows the channel the knob selected');
  });
  it('marks an empty active record', async () => {
    const radio = new FakeRadio();
    const s = new Session(radio);
    await s.start();
    const st = await readStatus(s);
    expect(st).toMatchObject({ channel: 0x7f, empty: true, note: STATUS_NOTE });
    expect(st).not.toHaveProperty('rxMhz');
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
