import { describe, expect, it } from 'vitest';
import {
  BaofengError,
  BusyError,
  DeviceStateError,
  REASONS,
  RETRY,
  TimeoutError,
  TransportError,
  UnexpectedError,
  UsageError,
  withDetail,
} from '../../src/core/errors.ts';

const REASON_ENUM = [
  'device-unavailable',
  'serial-io-failed',
  'ptt-control-failed',
  'dependency-missing',
  'audio-process-failed',
  'capture-incomplete',
  'file-write-failed',
  'session-unavailable',
  'protocol-reply-invalid',
  'write-unacknowledged',
  'verification-failed',
  'image-incompatible',
  'audio-inactive',
  'squelch-open',
  'invalid-argument',
  'device-busy',
  'serial-timeout',
  'unexpected-error',
];

describe('error reasons', () => {
  it('lists the eighteen reasons of the enum, each with a kind, a meaning, a remedy and a retry value', () => {
    expect(Object.keys(REASONS)).toEqual(REASON_ENUM);
    for (const doc of Object.values(REASONS)) {
      expect(doc.means.length).toBeGreaterThan(0);
      expect(doc.remedy.length).toBeGreaterThan(0);
      expect(Object.keys(RETRY)).toContain(doc.retry);
    }
  });

  it.each([
    ['UsageError', new UsageError('bad flag'), 'invalid-argument'],
    ['TransportError', new TransportError('serial-io-failed', 'serial error: EIO'), 'serial-io-failed'],
    ['TimeoutError', new TimeoutError('no ack'), 'serial-timeout'],
    ['DeviceStateError', new DeviceStateError('verification-failed', 'channel 5 did not take the write'), 'verification-failed'],
    ['BusyError', new BusyError('cannot open /dev/x: busy'), 'device-busy'],
    ['UnexpectedError', new UnexpectedError('boom'), 'unexpected-error'],
  ] as const)('gives a %s a reason, a remedy and a retry value in toJSON', (_name, err, reason) => {
    const body = err.toJSON();
    expect(body).toMatchObject({ reason, message: err.message, remedy: REASONS[reason].remedy, retry: REASONS[reason].retry });
    expect(REASON_ENUM).toContain(body.reason);
    expect(body).not.toHaveProperty('kind');
  });

  it('takes a remedy and retry value for one site and keeps the detail fields', () => {
    const err = new DeviceStateError('verification-failed', 'channel 5 record written; name did not take the write', { wrote: 'aa', read: 'ff' }, { remedy: 'read channel 5', retry: 'no' });
    expect(err.toJSON()).toEqual({
      reason: 'verification-failed',
      message: 'channel 5 record written; name did not take the write',
      remedy: 'read channel 5',
      retry: 'no',
      wrote: 'aa',
      read: 'ff',
    });
  });

  it('adds detail to a BaofengError and wraps any other error as unexpected-error', () => {
    const err = new TimeoutError('short read', { addr: 0 });
    expect(withDetail(err, { slot: 3 })).toBe(err);
    expect(err.toJSON()).toMatchObject({ reason: 'serial-timeout', addr: 0, slot: 3 });
    const wrapped = withDetail(new RangeError('boom'), { slot: 3 });
    expect(wrapped).toBeInstanceOf(BaofengError);
    expect(wrapped.toJSON()).toEqual({ reason: 'unexpected-error', message: 'boom', remedy: REASONS['unexpected-error'].remedy, retry: 'no', slot: 3 });
  });
});
