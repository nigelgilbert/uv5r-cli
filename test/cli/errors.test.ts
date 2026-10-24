import { describe, expect, it } from 'vitest';
import { BusyError, DeviceStateError, TimeoutError, TransportError, UnexpectedError, UsageError } from '../../src/core/index.ts';
import { EXIT, exitCodeFor } from '../../src/cli/exit.ts';

describe('exit codes', () => {
  it.each([
    ['UsageError', new UsageError('bad flag'), 'usage', 2],
    ['TransportError', new TransportError('serial-io-failed', 'serial error: EIO'), 'transport', 3],
    ['TimeoutError', new TimeoutError('no ack'), 'timeout', 4],
    ['DeviceStateError', new DeviceStateError('verification-failed', 'channel 5 did not take the write'), 'device-state', 5],
    ['BusyError', new BusyError('cannot open /dev/x: busy'), 'busy', 6],
    ['UnexpectedError', new UnexpectedError('boom'), 'unexpected', 1],
  ] as const)('maps a %s to its exit code', (_name, err, kind, exit) => {
    expect(err.kind).toBe(kind);
    expect(exitCodeFor(err.kind)).toBe(exit);
  });

  it('keeps ok at 0', () => {
    expect(EXIT.ok).toBe(0);
  });
});
