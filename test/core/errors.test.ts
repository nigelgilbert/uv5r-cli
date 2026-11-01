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
  type ErrorReason,
} from '../../src/core/errors.ts';

const REASON_ENUM = [
  'device-unavailable',
  'serial-io-failed',
  'ptt-control-failed',
  'dependency-missing',
  'audio-process-failed',
  'capture-incomplete',
  'file-write-failed',
  'speech-engine-failed',
  'audio-device-unavailable',
  'session-unavailable',
  'protocol-reply-invalid',
  'radio-unsupported',
  'write-unacknowledged',
  'verification-failed',
  'image-incompatible',
  'audio-inactive',
  'squelch-open',
  'channel-busy',
  'invalid-argument',
  'station-unconfigured',
  'utterance-too-long',
  'device-busy',
  'serial-timeout',
  'unexpected-error',
];

describe('error reasons', () => {
  it('lists the twenty-four reasons of the enum, each with a kind, a meaning, a remedy and a retry value', () => {
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
  ] as const)('gives a %s a type, kind, reason, remedy and retry value in toJSON', (_name, err, reason) => {
    const body = err.toJSON();
    expect(body).toMatchObject({ type: 'error', kind: REASONS[reason].kind, reason, message: err.message, remedy: REASONS[reason].remedy, retry: REASONS[reason].retry });
    expect(REASON_ENUM).toContain(body.reason);
  });

  it.each(Object.keys(REASONS) as ErrorReason[])('serializes %s with type error and its kind', (reason) => {
    const body = JSON.parse(JSON.stringify(new BaofengError(reason, 'failed'))) as Record<string, unknown>;
    expect(Object.keys(body).slice(0, 6)).toEqual(['type', 'kind', 'reason', 'message', 'remedy', 'retry']);
    expect(body).toMatchObject({ type: 'error', kind: REASONS[reason].kind, reason });
  });

  it('keeps the canonical fields when a detail field shares a name', () => {
    const err = new UsageError('bad flag', { type: 'flag', kind: 'other', reason: 'x', message: 'y', remedy: 'z', retry: 'once', flag: 'seconds' });
    expect(err.toJSON()).toEqual({
      type: 'error',
      kind: 'usage',
      reason: 'invalid-argument',
      message: 'bad flag',
      remedy: REASONS['invalid-argument'].remedy,
      retry: REASONS['invalid-argument'].retry,
      flag: 'seconds',
    });
  });

  it('gives a UsageError invalid-argument by default and the reason it is passed', () => {
    expect(new UsageError('bad flag').reason).toBe('invalid-argument');
    const err = new UsageError('no callsign in uv5r.json', { file: 'uv5r.json' }, {}, 'station-unconfigured');
    expect(err.kind).toBe('usage');
    expect(err.toJSON()).toMatchObject({ reason: 'station-unconfigured', retry: 'no', remedy: REASONS['station-unconfigured'].remedy, file: 'uv5r.json' });
  });

  it('names say and whisper-cli under dependency-missing and speech-engine-failed', () => {
    expect(REASONS['dependency-missing'].means).toContain('whisper-cli');
    expect(REASONS['dependency-missing'].means).toContain('model file');
    expect(REASONS['speech-engine-failed'].means).toContain('whisper-cli');
  });

  it.each([
    ['station-unconfigured', 'usage', 'no'],
    ['utterance-too-long', 'usage', 'after-remedy'],
    ['speech-engine-failed', 'transport', 'after-remedy'],
    ['audio-device-unavailable', 'transport', 'after-remedy'],
    ['channel-busy', 'device-state', 'after-remedy'],
  ] as const)('maps %s to kind %s with retry %s', (reason, kind, retry) => {
    expect(REASONS[reason]).toMatchObject({ kind, retry });
  });

  it('takes a remedy and retry value for one site and keeps the detail fields', () => {
    const err = new DeviceStateError('verification-failed', 'channel 5 record written; name did not take the write', { wrote: 'aa', read: 'ff' }, { remedy: 'read channel 5', retry: 'no' });
    expect(err.toJSON()).toEqual({
      type: 'error',
      kind: 'device-state',
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
    expect(wrapped.toJSON()).toEqual({ type: 'error', kind: 'unexpected', reason: 'unexpected-error', message: 'boom', remedy: REASONS['unexpected-error'].remedy, retry: 'no', slot: 3 });
  });
});
