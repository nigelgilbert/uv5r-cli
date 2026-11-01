import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { SETTINGS_BASE, SETTINGS_COMMIT, SETTINGS_FIELDS, SETTINGS_SIZE, applySettings, decodeSettings, parseSettingValue } from '../../src/core/codec.ts';
import { magicByName } from '../../src/core/ident.ts';
import { Session } from '../../src/core/protocol.ts';
import { imageSettingsBlock, restoreImage, startFreshSession, verifyRestoredRanges, verifySettingsBlock, verifySettingsInFreshSession, writeSettings } from '../../src/core/radio.ts';
import { FakeRadio } from './fake.ts';
import { GOLDEN, PRIMARY } from './golden.ts';

/** The decoded settings of the default fake. */
const DEFAULT_SETTINGS = decodeSettings(new FakeRadio().eeprom.subarray(SETTINGS_BASE, SETTINGS_BASE + SETTINGS_SIZE));
const FIELD_OFFSETS = new Set<number>(Object.values(SETTINGS_FIELDS).map((f) => f.offset));

/** Run fake timers until `p` settles and return its result. */
async function drive<T>(p: Promise<T>): Promise<T> {
  const [value] = await Promise.all([p, vi.runAllTimersAsync()]);
  return value;
}

async function startSession(radio: FakeRadio, magic = magicByName('291')): Promise<Session> {
  const s = new Session(radio);
  await drive(s.start(magic));
  return s;
}

/** Count handshake attempts: Session.start sends the magic one byte at a time. */
function handshakes(write: MockInstance<FakeRadio['write']>): number {
  return write.mock.calls.filter(([bytes]) => bytes.length === 1 && bytes[0] === magicByName('291').bytes[0]).length;
}

describe('settings codec', () => {
  it('decodes a zeroed block as squelch 0 with voice and beep off', () => {
    expect(decodeSettings(new Uint8Array(0x20))).toMatchObject({ squelch: 0, voice: 'off', beep: 'off', abr: 0 });
  });
  it('keeps an out-of-range byte as a number', () => {
    const block = new Uint8Array(0x20);
    block[0x0e] = 7;
    expect(decodeSettings(block).voice).toBe(7);
  });
  it('parses names and menu indexes', () => {
    expect(parseSettingValue('voice', 'ENG')).toBe(1);
    expect(parseSettingValue('beep', 'on')).toBe(1);
    expect(parseSettingValue('mdfa', 'name')).toBe(1);
    expect(parseSettingValue('squelch', '9')).toBe(9);
    expect(parseSettingValue('timeout', '39')).toBe(39);
  });
  it('rejects values off the menu', () => {
    expect(() => parseSettingValue('squelch', '10')).toThrow(/0\.\.9/);
    expect(() => parseSettingValue('voice', 'french')).toThrow(/off, eng, chi/);
    expect(() => parseSettingValue('beep', '-1')).toThrow(/beep/);
  });
  it('applies a patch without touching other bytes', () => {
    const before = imageSettingsBlock(PRIMARY.image);
    const out = applySettings(before, { squelch: 0, voice: 0 });
    const patched = new Set<number>([SETTINGS_FIELDS.squelch.offset, SETTINGS_FIELDS.voice.offset]);
    expect(out.length).toBe(SETTINGS_SIZE);
    expect(out[SETTINGS_FIELDS.squelch.offset]).toBe(0);
    expect(out[SETTINGS_FIELDS.voice.offset]).toBe(0);
    for (let i = 0; i < SETTINGS_SIZE; i++) {
      if (!patched.has(i)) expect(out[i], `byte 0x${i.toString(16)}`).toBe(before[i]);
    }
  });
});

describe('settings write', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stages both halves and commits with the 0x0E40 record', async () => {
    const radio = new FakeRadio();
    const s = await startSession(radio);
    const block = await drive(writeSettings(s, { squelch: 0, voice: 0 }));
    expect(radio.writes).toEqual([SETTINGS_BASE, SETTINGS_BASE + 0x10, SETTINGS_COMMIT]);
    expect([...radio.eeprom.subarray(SETTINGS_BASE, SETTINGS_BASE + SETTINGS_SIZE)]).toEqual([...block]);
  });
  it('rejects the write when verified in the same session', async () => {
    const radio = new FakeRadio();
    const s = await startSession(radio);
    const block = await drive(writeSettings(s, { voice: 0 }));
    await expect(drive(verifySettingsBlock(s, block))).rejects.toMatchObject({
      kind: 'device-state',
      reason: 'verification-failed',
      detail: { failed: ['voice'], settings: { voice: { desired: 'off', observed: DEFAULT_SETTINGS.voice } } },
    });
  });
  it('lists no field when only bytes outside the setting fields differ', async () => {
    const radio = new FakeRadio();
    const s = await startSession(radio);
    const expected = Uint8Array.from(radio.eeprom.subarray(SETTINGS_BASE, SETTINGS_BASE + SETTINGS_SIZE));
    const spare = [...Array(SETTINGS_SIZE).keys()].find((i) => !FIELD_OFFSETS.has(i))!;
    expected[spare] = expected[spare]! ^ 0xff;
    const err = await drive(verifySettingsBlock(s, expected)).catch((e: unknown) => e);
    expect(err).toMatchObject({ reason: 'verification-failed', detail: { failed: [], settings: {}, wrote: expect.any(String), read: expect.any(String) } });
  });
  it('waits out the idle drop and verifies the write in one new handshake', async () => {
    const radio = new FakeRadio();
    const s = await startSession(radio);
    const block = await drive(writeSettings(s, { voice: 0 }));
    const write = vi.spyOn(radio, 'write');
    expect(await drive(verifySettingsInFreshSession(radio, block))).toEqual({ ...DEFAULT_SETTINGS, voice: 'off' });
    expect(handshakes(write)).toBe(1);
  });
  it('names the settings block in the remedy when the radio does not ack a write', async () => {
    const radio = new FakeRadio();
    radio.refuseWriteAt = SETTINGS_BASE + 0x10;
    const s = await startSession(radio);
    await expect(drive(writeSettings(s, { squelch: 3 }))).rejects.toMatchObject({
      reason: 'write-unacknowledged',
      remedy: 'run uv5r settings to read the block, then rerun',
      retry: 'after-remedy',
    });
  });
  it('restores the eight exposed fields of a zeroed block and leaves the other bytes zero', async () => {
    const radio = new FakeRadio();
    radio.eeprom.fill(0, SETTINGS_BASE, SETTINGS_BASE + SETTINGS_SIZE);
    const s = await startSession(radio);
    const block = await drive(writeSettings(s, { squelch: 3, save: 3, abr: 5, beep: 1, timeout: 3, voice: 1, mdfa: 2, mdfb: 2 }));
    expect([...block].filter((_, i) => !FIELD_OFFSETS.has(i)).every((b) => b === 0)).toBe(true);
    expect(await drive(verifySettingsInFreshSession(radio, block))).toEqual({ squelch: 3, save: 3, abr: 5, beep: 'on', timeout: 3, voice: 'eng', mdfa: 'freq', mdfb: 'freq' });
  });
});

describe('restore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(GOLDEN)('commits the settings block of unit $label through the in-order write and verifies it with the channels and names', async ({ image, manifest }) => {
    const magic = magicByName(manifest.magic);
    const radio = FakeRadio.fromImage(image, { magic: manifest.magic });
    radio.eeprom.fill(0xff, 0x0000, 0x1800);
    // The handshake in startSession reloads the 0x0E00 page from the filled memory.
    const s = await startSession(radio, magic);
    await drive(restoreImage(s, image));
    const fresh = await drive(startFreshSession(radio, { magic }));
    expect(await drive(verifySettingsBlock(fresh, imageSettingsBlock(image)))).toEqual(decodeSettings(imageSettingsBlock(image)));
    expect(await drive(verifyRestoredRanges(fresh, image))).toBe(64);
  });
  it('says to rerun the restore when the radio does not ack a write', async () => {
    const radio = new FakeRadio();
    radio.refuseWriteAt = 0x0100;
    const s = await startSession(radio);
    await expect(drive(restoreImage(s, PRIMARY.image))).rejects.toMatchObject({
      reason: 'write-unacknowledged',
      message: 'radio refused write at 0x100',
      remedy: 'rerun the restore',
      retry: 'once',
    });
  });
  it('reports dropped name writes as a device-state error naming the first address', async () => {
    const radio = new FakeRadio();
    radio.eeprom.fill(0, 0x1050, 0x1070);
    radio.writesIgnoredBelow = 0x1050;
    radio.writesIgnoredAbove = 0x1070;
    const s = await startSession(radio);
    await drive(restoreImage(s, PRIMARY.image));
    const fresh = await drive(startFreshSession(radio));
    await expect(drive(verifyRestoredRanges(fresh, PRIMARY.image))).rejects.toMatchObject({
      kind: 'device-state',
      message: 'restore did not take 2 blocks; first at 0x1050',
      detail: { mismatches: 2, first: [{ addr: '0x1050' }, { addr: '0x1060' }] },
    });
  });
});
