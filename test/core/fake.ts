import { ADDR } from '../../src/core/codec.ts';
import { magicByName, type MagicName } from '../../src/core/ident.ts';
import { VERSION_LENGTH, VERSION_OFFSET, hex } from '../../src/core/protocol.ts';
import { IMAGE_AUX, IMAGE_HEADER } from '../../src/core/radio.ts';
import type { Transport } from '../../src/core/transport.ts';
import { AUX_SIZE } from './golden.ts';

/** Start of the page the radio serves from its reload snapshot and aliases for 16-byte reads. */
const PAGE = 0x0e00;
const PAGE_END = 0x0e80;
const SETTINGS = 0x0e20;
const COMMIT = 0x0e40;
/** Silence after which the bench radio leaves clone mode, measured at about 2.5 s. */
const IDLE_DROP_MS = 2500;
/** Bytes of a classic magic. */
const MAGIC_LENGTH = 7;
/** Bytes of a UV17Pro program magic. */
const PROGRAM_LENGTH = 16;
/** Baud of the classic and foreign magics. */
const CLASSIC_RATE = 9600;
/** Baud of the program magics. */
const PROGRAM_RATE = 115200;
/** Radio address where main memory ends. */
const MAIN_END = IMAGE_AUX - IMAGE_HEADER;
/** Address of the 14-byte version string. */
const VERSION_AT = ADDR.firmwareBlock + VERSION_OFFSET;

/**
 * In-memory UV-5R with the bench radio's behaviour: answers the clone handshake, serves
 * 16-byte aligned reads, acks every write, applies writes to channel memory and ignores
 * writes to the VFO region. The 0x0E00 page reads as it was at the last reload; 16-byte
 * reads in 0x0E10..0x0E4F return the 0x0E40 record; writes at 0x0E20 and 0x0E30 are staged
 * in a zero-filled buffer that a write at 0x0E40 commits.
 *
 * Assumptions beyond the bench measurements:
 * - The bench showed writes to 0x0E4C and 0x0E76..0x0E77 have no effect. The fake drops
 *   every other write in 0x0E00..0x0E7F too, including the bytes of the 0x0E40 write itself.
 * - The session drops after IDLE_DROP_MS without a byte from the host, timed with
 *   Date.now(), so fake timers drive it. A handshake then starts a new session and reloads
 *   the page.
 * - Outside a session it matches the last 7 bytes received against `magics` and
 *   `foreignMagic`, answers a match with `ackByte`, and stays idle when `ackByte` is not 06.
 *   A `foreignMagic` match answers `02` with `foreignIdent`.
 * - At a rate other than 9600 it ignores every byte. At 115200 it answers the 16 bytes of
 *   `programMagic` with one 06.
 */
export class FakeRadio implements Transport {
  readonly target = 'fake';
  readonly eeprom = new Uint8Array(0x2000).fill(0xff);
  readonly ident = Uint8Array.from([0xaa, 0x30, 0x76, 0x04, 0x00, 0x05, 0x20, 0xdd]);
  /** Magics the radio acks; the bench unit acks 291. */
  magics: Uint8Array[] = [magicByName('291').bytes];
  /** Byte the radio sends in reply to a magic it acks. */
  ackByte = 0x06;
  /** Reply to `02`, of any length. */
  identReply: Uint8Array = this.ident;
  /** A 7-byte foreign magic the radio acks at 9600 as another driver's radio. */
  foreignMagic: Uint8Array | undefined;
  /** Reply to `02` after `foreignMagic`, 8 or 14 bytes. */
  foreignIdent: Uint8Array = Uint8Array.from([0xaa, ...new Array<number>(12).fill(0x30), 0xdd]);
  /** A 16-byte program magic the radio acks at 115200 with one 06. */
  programMagic: Uint8Array | undefined;
  /** Hex of every magic the radio matched, acked or ignored, in order. */
  readonly handshakes: string[] = [];
  private inbox: number[] = [];
  private outbox: number[] = [];
  private lastBytes: number[] = [];
  private lastProgramBytes: number[] = [];
  /** Reply to the next `02`, set by the magic that matched. */
  private pendingIdent: Uint8Array = this.ident;
  private state: 'idle' | 'acked' | 'ident-sent' | 'session' = 'idle';
  private pendingAckForRead = false;
  private loadedPage = new Uint8Array(PAGE_END - PAGE);
  private staged = new Uint8Array(0x20);
  private lastByteAt = 0;
  ptt = false;
  /** Value of each setPtt call, in order. */
  readonly pttLog: boolean[] = [];
  /** Baud rate the host set last. */
  rate = CLASSIC_RATE;
  /** Addresses of every write command the radio received, in order. */
  readonly writes: number[] = [];
  /** Number of magic sequences to leave unanswered, as a radio still in a dying clone session. */
  handshakesIgnored = 0;
  writesIgnoredBelow = 0x0f00;
  writesIgnoredAbove = 0x0f40;
  /** Address of a write whose first byte the radio stores inverted, to fail a read-back. */
  corruptWriteAt: number | undefined;
  /** Address of a write the radio drops without an ack. */
  refuseWriteAt: number | undefined;
  /** Address of a read the radio leaves unanswered, to time out the read. */
  silentReadAt: number | undefined;

  constructor() {
    this.firmware = 'HN5RV011';
    this.eeprom[0x1fcf] = 0xff;
    this.eeprom.set(
      [0x03, 0, 0, 0x03, 0, 0, 0x05, 0, 0x01, 0x03, 0, 0, 0, 0, 0x01, 0, 0x03, 0, 0, 0, 0x05, 0x02, 0x02, 0, 0, 0, 0, 0, 0, 0x03, 0x01, 0x02],
      SETTINGS,
    );
    this.eeprom[0x0e4c] = 0;
    this.eeprom.set([4, 4, 6, 0, 0, 0, 0, 0], 0x0f08);
    this.reload();
  }

  /** Return a fake with the ident, main memory and aux block of a CHIRP `image` that acks `magic`. */
  static fromImage(image: Uint8Array, { magic = '291' }: { magic?: MagicName } = {}): FakeRadio {
    if (image.length !== IMAGE_AUX + AUX_SIZE) throw new Error(`image is ${image.length} bytes; expected ${IMAGE_AUX + AUX_SIZE}`);
    const radio = new FakeRadio();
    radio.ident.set(image.subarray(0, IMAGE_HEADER));
    radio.eeprom.set(image.subarray(IMAGE_HEADER, IMAGE_HEADER + MAIN_END), 0);
    radio.eeprom.set(image.subarray(IMAGE_AUX), ADDR.firmwareBlock);
    radio.magics = [magicByName(magic).bytes];
    return radio;
  }

  /** The version string at 0x1EF0, padded with 0xFF to 14 bytes. */
  set firmware(text: string) {
    this.eeprom.fill(0xff, VERSION_AT, VERSION_AT + VERSION_LENGTH);
    this.eeprom.set(Buffer.from(text, 'latin1').subarray(0, VERSION_LENGTH), VERSION_AT);
  }

  get firmware(): string {
    return Buffer.from(this.eeprom.subarray(VERSION_AT, VERSION_AT + VERSION_LENGTH)).toString('latin1');
  }

  /** Load the 0x0E00 page from EEPROM and clear the staging buffer, as the radio does when it enters clone mode. */
  private reload(): void {
    this.loadedPage = Uint8Array.from(this.eeprom.subarray(PAGE, PAGE_END));
    this.staged.fill(0);
  }

  write(bytes: Uint8Array): void {
    if (this.rate !== CLASSIC_RATE) {
      for (const b of bytes) this.feedProgram(b);
      return;
    }
    if (this.state !== 'idle' && Date.now() - this.lastByteAt >= IDLE_DROP_MS) this.dropSession();
    this.lastByteAt = Date.now();
    for (const b of bytes) this.feed(b);
  }

  /** Match the last 16 bytes against `programMagic` and ack a match with one 06. */
  private feedProgram(b: number): void {
    this.lastProgramBytes = [...this.lastProgramBytes, b].slice(-PROGRAM_LENGTH);
    const seen = hex(this.lastProgramBytes);
    if (this.rate !== PROGRAM_RATE || !this.programMagic || hex(this.programMagic) !== seen) return;
    this.lastProgramBytes = [];
    this.handshakes.push(seen);
    this.outbox.push(0x06);
  }

  private feed(b: number): void {
    if (this.state === 'idle') {
      this.lastBytes = [...this.lastBytes, b].slice(-MAGIC_LENGTH);
      const seen = hex(this.lastBytes);
      const foreign = this.foreignMagic !== undefined && hex(this.foreignMagic) === seen;
      if (!foreign && !this.magics.some((m) => hex(m) === seen)) return;
      this.pendingIdent = foreign ? this.foreignIdent : this.identReply;
      this.lastBytes = [];
      this.handshakes.push(seen);
      if (this.handshakesIgnored > 0) {
        this.handshakesIgnored--;
        return;
      }
      this.outbox.push(this.ackByte);
      if (this.ackByte !== 0x06) return;
      this.state = 'acked';
      this.reload();
      return;
    }
    if (this.state === 'acked') {
      if (b === 0x02) {
        this.outbox.push(...this.pendingIdent);
        this.state = 'ident-sent';
      }
      return;
    }
    if (this.state === 'ident-sent') {
      if (b === 0x06) {
        this.outbox.push(0x06);
        this.state = 'session';
      }
      return;
    }
    this.inbox.push(b);
    this.drain();
  }

  private serve(addr: number, size: number): Uint8Array {
    if (addr >= PAGE && addr < PAGE_END) {
      const at = size === 0x10 && addr >= 0x0e10 && addr < 0x0e50 ? COMMIT : addr;
      return this.loadedPage.subarray(at - PAGE, at - PAGE + size);
    }
    return this.eeprom.subarray(addr, addr + size);
  }

  private store(addr: number, data: number[]): void {
    if (addr === SETTINGS || addr === SETTINGS + 0x10) {
      this.staged.set(data, addr - SETTINGS);
      return;
    }
    if (addr === COMMIT) {
      this.eeprom.set(this.staged, SETTINGS);
      this.staged.fill(0);
      return;
    }
    if (addr >= PAGE && addr < PAGE_END) return;
    if (addr === this.corruptWriteAt) data = [data[0]! ^ 0xff, ...data.slice(1)];
    if (addr < this.writesIgnoredBelow || addr >= this.writesIgnoredAbove) this.eeprom.set(data, addr);
  }

  private drain(): void {
    while (this.inbox.length > 0) {
      const cmd = this.inbox[0]!;
      if (cmd === 0x06) {
        this.inbox.shift();
        continue;
      }
      if (cmd === 0x53) {
        if (this.inbox.length < 4) return;
        const [, hi, lo, size] = this.inbox.splice(0, 4) as number[];
        const addr = ((hi! << 8) | lo!) & ~0x0f;
        if (addr === this.silentReadAt) continue;
        if (this.pendingAckForRead) this.outbox.push(0x06);
        this.pendingAckForRead = true;
        this.outbox.push(0x58, hi!, lo!, size!, ...this.serve(addr, size!));
        continue;
      }
      if (cmd === 0x58) {
        if (this.inbox.length < 4) return;
        const len = this.inbox[3]!;
        if (this.inbox.length < 4 + len) return;
        const [, hi, lo] = this.inbox.splice(0, 4) as number[];
        const data = this.inbox.splice(0, len);
        const addr = (hi! << 8) | lo!;
        this.writes.push(addr);
        if (addr === this.refuseWriteAt) continue;
        this.store(addr, data);
        this.outbox.push(0x06);
        continue;
      }
      this.inbox.shift();
    }
  }

  async read(n: number, _ms: number): Promise<Uint8Array> {
    return Uint8Array.from(this.outbox.splice(0, n));
  }

  discard(): void {
    this.outbox = [];
  }

  /** Queue `bytes` as stale input that the host reads before any reply. */
  queueStale(bytes: Iterable<number>): void {
    this.outbox.push(...bytes);
  }

  /** Leave clone mode at once, as the radio does after IDLE_DROP_MS of silence. */
  dropSession(): void {
    this.state = 'idle';
    this.inbox = [];
    this.outbox = [];
    this.pendingAckForRead = false;
  }

  async setPtt(on: boolean): Promise<void> {
    this.pttLog.push(on);
    this.ptt = on;
  }

  async setBaud(rate: number): Promise<void> {
    this.rate = rate;
  }

  async close(): Promise<void> {}
}
