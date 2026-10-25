import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADDR, SETTINGS_BASE, SETTINGS_COMMIT, SETTINGS_SIZE } from '../../src/core/codec.ts';
import { magicByName } from '../../src/core/ident.ts';
import { SETTLE_MS, Session, VERSION_LENGTH, VERSION_OFFSET, attempt, hex, settle } from '../../src/core/protocol.ts';
import { IMAGE_AUX, IMAGE_HEADER, RESTORE_RANGES, imageSettingsBlock, restoreImage, writeSettings } from '../../src/core/radio.ts';
import { FakeRadio } from './fake.ts';
import { GOLDEN, PRIMARY } from './golden.ts';

const LOW = SETTINGS_BASE;
const HIGH = SETTINGS_BASE + 0x10;

/** Run fake timers until `p` settles and return its result. */
async function drive<T>(p: Promise<T>): Promise<T> {
  const [value] = await Promise.all([p, vi.runAllTimersAsync()]);
  return value;
}

/** Run fake timers alongside `p` and return its rejection. */
async function driveRejection(p: Promise<unknown>): Promise<unknown> {
  const caught = p.then(
    () => undefined,
    (err: unknown) => err,
  );
  await vi.runAllTimersAsync();
  return caught;
}

async function startSession(radio: FakeRadio, magic = magicByName('291')): Promise<Session> {
  const s = new Session(radio);
  await drive(s.start(magic));
  return s;
}

const block = (fill: number) => new Uint8Array(0x10).fill(fill);
const settingsBytes = (radio: FakeRadio) => [...radio.eeprom.subarray(SETTINGS_BASE, SETTINGS_BASE + SETTINGS_SIZE)];

describe('settings commit guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['nothing', []],
    ['only 0x0e20', [LOW]],
    ['only 0x0e30', [HIGH]],
  ])('refuses a commit with %s staged and sends nothing', async (_, halves) => {
    const radio = new FakeRadio();
    const before = settingsBytes(radio);
    const s = await startSession(radio);
    for (const h of halves) await drive(s.writeBlock(h, block(0x11)));
    expect(await driveRejection(s.writeBlock(SETTINGS_COMMIT, block(0)))).toMatchObject({ kind: 'usage' });
    expect(radio.writes).toEqual(halves);
    expect(settingsBytes(radio)).toEqual(before);
  });

  it('clears the staged halves when it refuses a commit', async () => {
    const radio = new FakeRadio();
    const s = await startSession(radio);
    await drive(s.writeBlock(LOW, block(0x11)));
    await driveRejection(s.writeBlock(SETTINGS_COMMIT, block(0)));
    await drive(s.writeBlock(HIGH, block(0x22)));
    expect(await driveRejection(s.writeBlock(SETTINGS_COMMIT, block(0)))).toMatchObject({ kind: 'usage' });
    expect(radio.writes).toEqual([LOW, HIGH]);
  });

  it('commits both halves once and refuses a repeated commit', async () => {
    const radio = new FakeRadio();
    const s = await startSession(radio);
    const written = await drive(writeSettings(s, { squelch: 0 }));
    expect(settingsBytes(radio)).toEqual([...written]);
    expect(await driveRejection(s.writeBlock(SETTINGS_COMMIT, block(0)))).toMatchObject({ kind: 'usage' });
    expect(settingsBytes(radio)).toEqual([...written]);
    await drive(s.writeBlock(LOW, written.subarray(0, 0x10)));
    await drive(s.writeBlock(HIGH, written.subarray(0x10, 0x20)));
    await drive(s.writeBlock(SETTINGS_COMMIT, block(0)));
    expect(radio.writes).toEqual([LOW, HIGH, SETTINGS_COMMIT, LOW, HIGH, SETTINGS_COMMIT]);
    expect(settingsBytes(radio)).toEqual([...written]);
  });

  it('forgets staged halves on a new handshake', async () => {
    const radio = new FakeRadio();
    const s = await startSession(radio);
    await drive(s.writeBlock(LOW, block(0x11)));
    await drive(s.writeBlock(HIGH, block(0x22)));
    radio.dropSession();
    await drive(s.start());
    expect(await driveRejection(s.writeBlock(SETTINGS_COMMIT, block(0)))).toMatchObject({ kind: 'usage' });
  });

  it('forgets staged halves after a failed write', async () => {
    const radio = new FakeRadio();
    const s = await startSession(radio);
    await drive(s.writeBlock(LOW, block(0x11)));
    await drive(s.writeBlock(HIGH, block(0x22)));
    vi.spyOn(radio, 'read').mockResolvedValueOnce(new Uint8Array());
    expect(await driveRejection(s.writeBlock(0x0000, block(0x33)))).toMatchObject({ kind: 'device-state' });
    expect(await driveRejection(s.writeBlock(SETTINGS_COMMIT, block(0)))).toMatchObject({ kind: 'usage' });
    expect(radio.writes).not.toContain(SETTINGS_COMMIT);
  });

  it.each(GOLDEN)('restores unit $label in address order through the guard', async ({ image, manifest }) => {
    const radio = FakeRadio.fromImage(image, { magic: manifest.magic });
    radio.eeprom.fill(0xff, 0x0000, 0x1800);
    // The handshake in startSession reloads the 0x0E00 page from the filled memory.
    const s = await startSession(radio, magicByName(manifest.magic));
    const expected = RESTORE_RANGES.reduce((n, [start, end]) => n + (end - start) / 0x10, 0);
    expect(await drive(restoreImage(s, image))).toBe(expected);
    expect(settingsBytes(radio)).toEqual([...imageSettingsBlock(image)]);
    expect([...radio.eeprom.subarray(0x0000, 0x0cf0)]).toEqual([...image.subarray(IMAGE_HEADER, IMAGE_HEADER + 0x0cf0)]);
  });
});

describe('fake from an image', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers the handshake as PRIMARY and loads its main memory and aux block', async () => {
    const radio = FakeRadio.fromImage(PRIMARY.image, { magic: PRIMARY.manifest.magic });
    const s = await startSession(radio, magicByName(PRIMARY.manifest.magic));
    // PRIMARY's ident and firmware match the default constructor, so the changed-copy test covers the ident load.
    expect(hex(s.startedIdent.bytes)).toBe(hex(PRIMARY.image.subarray(0, IMAGE_HEADER)));
    expect(s.startedIdent.firmware).toBe(PRIMARY.manifest.firmware);
    expect([...radio.eeprom.subarray(0, IMAGE_AUX - IMAGE_HEADER)]).toEqual([...PRIMARY.image.subarray(IMAGE_HEADER, IMAGE_AUX)]);
    expect([...radio.eeprom.subarray(ADDR.firmwareBlock)]).toEqual([...PRIMARY.image.subarray(IMAGE_AUX)]);
  });
  it('answers the handshake with a changed ident and firmware', async () => {
    const image = Uint8Array.from(PRIMARY.image);
    image[6] = 0x21;
    image.fill(0xff, IMAGE_AUX + VERSION_OFFSET, IMAGE_AUX + VERSION_OFFSET + VERSION_LENGTH);
    image.set(Buffer.from('BFB297', 'latin1'), IMAGE_AUX + VERSION_OFFSET);
    const s = await startSession(FakeRadio.fromImage(image));
    expect(hex(s.startedIdent.bytes)).toBe('aa 30 76 04 00 05 21 dd');
    expect(s.startedIdent.firmware).toBe('BFB297');
  });
  it('acks the magic it is given and ignores the default 291', async () => {
    const orig = FakeRadio.fromImage(PRIMARY.image, { magic: 'ORIG' });
    await expect(startSession(orig, magicByName('ORIG'))).resolves.toBeInstanceOf(Session);
    const radio = FakeRadio.fromImage(PRIMARY.image, { magic: 'ORIG' });
    expect(await driveRejection(new Session(radio).start(magicByName('291')))).toMatchObject({ kind: 'device-state', reason: 'session-unavailable' });
  });
  it('throws on an image shorter than a CHIRP image', () => {
    expect(() => FakeRadio.fromImage(PRIMARY.image.subarray(0, IMAGE_HEADER))).toThrow(`image is ${IMAGE_HEADER} bytes`);
  });
});

describe('write shape', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['a 32-byte write', 0x0e20, 0x20],
    ['a 64-byte write', 0x0e00, 0x40],
    ['an 8-byte write', 0x0000, 0x08],
    ['an unaligned address', 0x0e28, 0x10],
    ['an address past memory', 0x2000, 0x10],
    ['a negative address', -0x10, 0x10],
  ])('rejects %s before sending it', async (_, addr, size) => {
    const radio = new FakeRadio();
    const s = await startSession(radio);
    expect(await driveRejection(s.writeBlock(addr, new Uint8Array(size)))).toMatchObject({ kind: 'usage' });
    expect(radio.writes).toEqual([]);
  });
});

describe('settings page reads', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([0x0e00, 0x0e10, 0x0e20, 0x0e30, 0x0e40, 0x0e50].map((a) => [a.toString(16).padStart(4, '0'), a] as const))('sends a 16-byte read at 0x%s as one 16-byte read command', async (_, addr) => {
    const radio = new FakeRadio();
    const s = await startSession(radio);
    const write = vi.spyOn(radio, 'write');
    await drive(s.readBlock(addr, 0x10));
    const reads = write.mock.calls.map(([bytes]) => [...bytes]).filter((b) => b[0] === 0x53);
    expect(reads).toEqual([[0x53, addr >> 8, addr & 0xff, 0x10]]);
  });
});

describe('handshake input', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('discards stale input before the magic and reads the ident with magic 291', async () => {
    const radio = new FakeRadio();
    radio.queueStale([0x15, 0xdd]);
    expect(await drive(attempt(radio, magicByName('291'), { confirm: true }))).toEqual({ kind: 'ident', bytes: radio.ident, got: hex(radio.ident) });
  });
});

describe('settle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("waits on a ref'd timer so a port that closes mid-wait leaves the loop alive", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    void settle();
    const timer = setTimeoutSpy.mock.results[0]!.value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(true);
    clearTimeout(timer);
  });

  it('waits SETTLE_MS while stop stays pending', async () => {
    vi.useFakeTimers();
    let done = false;
    void settle(new Promise(() => {})).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('resolves at once and clears its timer when stop resolves', async () => {
    vi.useFakeTimers();
    let stop = () => {};
    const done = settle(new Promise<void>((resolve) => (stop = resolve)));
    expect(vi.getTimerCount()).toBe(1);
    stop();
    await done;
    expect(vi.getTimerCount()).toBe(0);
  });
});
