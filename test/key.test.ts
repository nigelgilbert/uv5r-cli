import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TransportError, signalExitCode } from '../src/errors.ts';
import { KEY_SIGNALS, holdPtt } from '../src/radio.ts';
import type { Transport } from '../src/transport.ts';
import { FakeRadio } from './fake.ts';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));

function listeners(em: EventEmitter): number {
  return KEY_SIGNALS.reduce((n, s) => n + em.listenerCount(s), 0);
}

describe('holdPtt', () => {
  it('keys for the given time, releases PTT and removes its listeners', async () => {
    const radio = new FakeRadio();
    const em = new EventEmitter();
    const pending = holdPtt(radio, 0.1, em);
    await Promise.resolve();
    expect(radio.ptt).toBe(true);
    expect(listeners(em)).toBe(3);
    const result = await pending;
    expect(result.interrupted).toBeUndefined();
    expect(result.seconds).toBeGreaterThanOrEqual(0.1);
    expect(result.seconds).toBeLessThan(0.5);
    expect(radio.ptt).toBe(false);
    expect(listeners(em)).toBe(0);
  });

  it.each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)('releases PTT early on %s', async (signal) => {
    const radio = new FakeRadio();
    const em = new EventEmitter();
    const started = performance.now();
    const pending = holdPtt(radio, 5, em);
    setTimeout(() => em.emit(signal), 50);
    const result = await pending;
    expect(performance.now() - started).toBeLessThan(500);
    expect(result.interrupted).toBe(signal);
    expect(result.seconds).toBeLessThan(0.5);
    expect(radio.ptt).toBe(false);
    expect(listeners(em)).toBe(0);
  });

  it('handles the first of two signals', async () => {
    const radio = new FakeRadio();
    const em = new EventEmitter();
    const pending = holdPtt(radio, 5, em);
    setTimeout(() => {
      em.emit('SIGINT');
      em.emit('SIGTERM');
    }, 50);
    const result = await pending;
    expect(result.interrupted).toBe('SIGINT');
    expect(radio.ptt).toBe(false);
  });

  it('reports pttAsserted, seconds and released on success', async () => {
    const result = await holdPtt(new FakeRadio(), 0.1, new EventEmitter());
    expect(Object.keys(result)).toEqual(['pttAsserted', 'seconds', 'released']);
    expect(result).toMatchObject({ pttAsserted: true, released: true });
  });

  it('throws a transport error naming the release phase when the release fails after the assertion', async () => {
    const em = new EventEmitter();
    const radio: Transport = Object.assign(new FakeRadio(), {
      async setPtt(on: boolean): Promise<void> {
        if (!on) throw new Error('release failed');
      },
    });
    const pending = holdPtt(radio, 5, em);
    setTimeout(() => em.emit('SIGINT'), 50);
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    const body = (err as TransportError).toJSON();
    expect(body).toMatchObject({ kind: 'transport', pttAsserted: true, released: false, phase: 'release', interrupted: 'SIGINT' });
    expect(body.message).toContain('PTT rose and the release is unconfirmed: release failed');
    expect(body.message).toContain('unplug the AIOC');
    expect(body.message).not.toMatch(/retry/i);
    expect(listeners(em)).toBe(0);
  });

  it('reports pttAsserted false and released false when both steps fail', async () => {
    const em = new EventEmitter();
    const radio: Transport = Object.assign(new FakeRadio(), {
      async setPtt(on: boolean): Promise<void> {
        throw new Error(on ? 'assert failed' : 'release failed');
      },
    });
    const err = await holdPtt(radio, 5, em).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    const body = (err as TransportError).toJSON();
    expect(body).toMatchObject({ pttAsserted: false, released: false, phase: 'assert' });
    expect(body.message).toContain('assert failed');
    expect(body.message).toContain('unplug the AIOC');
    expect(listeners(em)).toBe(0);
  });

  it('reports released true when only the assertion fails', async () => {
    const radio = new FakeRadio();
    radio.setPtt = async (on: boolean) => {
      if (on) throw new TransportError('ptt-control-failed', 'assert failed', { target: 'fake' });
      radio.ptt = false;
    };
    const err = await holdPtt(radio, 5, new EventEmitter()).catch((e: unknown) => e);
    expect((err as TransportError).toJSON()).toMatchObject({ target: 'fake', pttAsserted: false, released: true, phase: 'assert' });
    expect((err as TransportError).message).not.toContain('unplug');
  });
});

describe('signalExitCode', () => {
  it('adds 128 to the signal number', () => {
    expect(signalExitCode('SIGINT')).toBe(130);
    expect(signalExitCode('SIGTERM')).toBe(143);
    expect(signalExitCode('SIGHUP')).toBe(129);
  });
});

describe('key verb', () => {
  it('exits 3 with a transport error when the target does not exist', () => {
    const res = spawnSync(process.execPath, [MAIN, 'key', '--seconds', '5', '--json'], {
      env: { ...process.env, UV5R_TARGET: '/dev/does-not-exist-uv5r' },
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(res.status).toBe(3);
    expect(res.stdout).toBe('');
    expect(JSON.parse(res.stderr.trim())).toMatchObject({ kind: 'transport', retry: 'no', pttAsserted: false, released: false, phase: 'open' });
  });
});
