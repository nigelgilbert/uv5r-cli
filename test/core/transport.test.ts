import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransportError } from '../../src/core/errors.ts';
import { SerialTransport } from '../../src/core/transport.ts';

type Cb = (err?: Error | null) => void;

/** Stand-in for the serialport stream; tests drive it through `ports` and its fields. */
const { FakePort, ports } = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events');
  const ports: InstanceType<typeof FakePort>[] = [];
  class FakePort extends EventEmitter {
    static list = async (): Promise<unknown[]> => [];
    isOpen = false;
    writeError: Error | undefined;
    setError: Error | undefined;
    updateError: Error | undefined;
    updates: unknown[] = [];
    written: Buffer[] = [];
    sets: unknown[] = [];
    readonly options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      super();
      this.options = options;
      ports.push(this);
    }
    open(cb: Cb): void {
      this.isOpen = true;
      process.nextTick(() => cb(null));
    }
    write(buf: Buffer, cb: Cb): boolean {
      this.written.push(buf);
      const err = this.writeError;
      process.nextTick(() => cb(err ?? null));
      return true;
    }
    set(opts: unknown, cb: Cb): void {
      this.sets.push(opts);
      const err = this.setError;
      process.nextTick(() => cb(err ?? null));
    }
    update(opts: unknown, cb: Cb): void {
      this.updates.push(opts);
      const err = this.updateError;
      process.nextTick(() => cb(err ?? null));
    }
    close(cb: Cb): void {
      this.isOpen = false;
      process.nextTick(() => {
        this.emit('close', null);
        cb(null);
      });
    }
  }
  return { FakePort, ports };
});

vi.mock('serialport', () => ({ SerialPort: FakePort }));

/** Open a transport on `/dev/null` so the existence check passes, and return it with its fake port. */
async function openFake() {
  const t = await SerialTransport.open('/dev/null');
  const port = ports.at(-1)!;
  return { t, port };
}

beforeEach(() => {
  ports.length = 0;
});

describe('SerialTransport', () => {
  it('reports a missing device path as device-unavailable with a remedy', async () => {
    const err = await SerialTransport.open('/dev/uv5r-nonexistent').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).toJSON()).toEqual({
      type: 'error',
      kind: 'transport',
      reason: 'device-unavailable',
      message: 'no device at /dev/uv5r-nonexistent',
      remedy: 'reseat the cable or pass --target with an existing path',
      retry: 'after-remedy',
      target: '/dev/uv5r-nonexistent',
    });
  });

  it('opens the port with HUPCL so the kernel drops DTR when the fd closes', async () => {
    const { port } = await openFake();
    expect(port.options).toMatchObject({ baudRate: 9600, hupcl: true });
  });

  it('buffers data events and returns them from read', async () => {
    const { t, port } = await openFake();
    port.emit('data', Buffer.from([1, 2, 3]));
    setTimeout(() => port.emit('data', Buffer.from([4])), 10);
    expect(Array.from(await t.read(4, 500))).toEqual([1, 2, 3, 4]);
    expect(Array.from(await t.read(1, 20))).toEqual([]);
  });

  it('rejects a pending read promptly after an error event and throws on the next write', async () => {
    const { t, port } = await openFake();
    const start = Date.now();
    setTimeout(() => port.emit('error', new Error('EIO')), 20);
    const err = await t.read(1, 2000).catch((e: unknown) => e);
    expect(Date.now() - start).toBeLessThan(500);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).message).toContain('EIO');
    expect((err as TransportError).reason).toBe('serial-io-failed');
    expect((err as TransportError).detail).toEqual({ target: '/dev/null' });
    expect(() => t.write(Uint8Array.of(0x50))).toThrow(TransportError);
    await expect(t.setPtt(true)).rejects.toBeInstanceOf(TransportError);
  });

  it('refuses to key after a stored failure and still sends the release to the port', async () => {
    const { t, port } = await openFake();
    port.emit('error', new Error('EIO'));
    port.sets.length = 0;
    await expect(t.setPtt(true)).rejects.toThrow(/EIO/);
    expect(port.sets).toEqual([]);
    await expect(t.setPtt(false)).resolves.toBeUndefined();
    expect(port.sets).toEqual([{ dtr: false, rts: false }]);
  });

  it('rejects a release after a stored failure when the port refuses it', async () => {
    const { t, port } = await openFake();
    port.emit('error', new Error('EIO'));
    port.setError = new Error('set EIO');
    const err = await t.setPtt(false).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).message).toBe('set EIO');
    expect((err as TransportError).toJSON()).toMatchObject({ reason: 'ptt-control-failed', retry: 'no' });
  });

  it('lowers DTR before closing and ignores a failed release', async () => {
    const { t, port } = await openFake();
    port.sets.length = 0;
    await t.close();
    expect(port.sets).toEqual([{ dtr: false, rts: false }]);
    expect(port.isOpen).toBe(false);
    const { t: t2, port: port2 } = await openFake();
    port2.setError = new Error('set EIO');
    await expect(t2.close()).resolves.toBeUndefined();
    expect(port2.isOpen).toBe(false);
  });

  it('rejects the next read after a write callback reports an error', async () => {
    const { t, port } = await openFake();
    port.writeError = new Error('write EIO');
    t.write(Uint8Array.of(0x50));
    const err = await t.read(1, 2000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).message).toContain('write EIO');
  });

  it('marks the transport failed when the device disconnects', async () => {
    const { t, port } = await openFake();
    port.isOpen = false;
    port.emit('close', new Error('Device not configured'));
    const err = await t.read(1, 2000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).message).toContain('disconnected');
    await expect(t.close()).resolves.toBeUndefined();
  });

  it('changes the baud rate on the open port', async () => {
    const { t, port } = await openFake();
    await expect(t.setBaud(115200)).resolves.toBeUndefined();
    await expect(t.setBaud(9600)).resolves.toBeUndefined();
    expect(port.updates).toEqual([{ baudRate: 115200 }, { baudRate: 9600 }]);
  });

  it('rejects with serial-io-failed when the port refuses the baud rate', async () => {
    const { t, port } = await openFake();
    port.updateError = new Error('EINVAL');
    const err = await t.setBaud(115200).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).toJSON()).toEqual({
      type: 'error',
      kind: 'transport',
      reason: 'serial-io-failed',
      message: 'cannot set 115200 baud: EINVAL',
      remedy: 'ask the human to reseat the AIOC cable',
      retry: 'after-remedy',
      target: '/dev/null',
      baud: 115200,
    });
  });

  it('treats a deliberate close as normal', async () => {
    const { t } = await openFake();
    await expect(t.close()).resolves.toBeUndefined();
    expect(Array.from(await t.read(1, 20))).toEqual([]);
    expect(() => t.write(Uint8Array.of(0x50))).not.toThrow();
    await expect(t.close()).resolves.toBeUndefined();
  });
});
