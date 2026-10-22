import { describe, expect, it } from 'vitest';
import { UsageError } from '../src/errors.ts';
import { parsePlan } from '../src/plan.ts';

/** Parse a one-entry plan and return the UsageError it throws. */
function failure(entry: object): UsageError {
  try {
    parsePlan({ channels: [entry] });
  } catch (err) {
    if (err instanceof UsageError) return err;
    throw err;
  }
  throw new Error('parsePlan accepted the entry');
}

describe('parsePlan', () => {
  it('maps each field onto the tune spec', () => {
    const plan = parsePlan({
      name: 'test',
      channels: [
        { channel: 4, name: 'BIG SKY', rxMhz: 146.82, offsetMhz: -0.6, tone: '82.5', lowPower: true, notes: 'repeater' },
        { channel: 7, rxMhz: 154.695, rxTone: 'D606N', narrow: true, rxOnly: true },
      ],
    });
    expect(plan.name).toBe('test');
    expect(plan.entries[0]).toEqual({
      channel: 4,
      spec: { rxHz: 146_820_000, txHz: 146_220_000, rxOnly: false, txTone: { kind: 'ctcss', hz: 82.5 }, rxTone: { kind: 'none' }, wide: true, lowPower: true, name: 'BIG SKY' },
      notes: 'repeater',
    });
    expect(plan.entries[1]!.spec).toMatchObject({ txHz: undefined, rxOnly: true, rxTone: { kind: 'dcs', code: 606, inverted: false }, wide: false });
  });

  it.each([
    [{ channel: 3, rxMhz: 300 }, 'rxMhz'],
    [{ channel: 3 }, 'rxMhz'],
    [{ channel: 3, rxMhz: 146.82, offsetMhz: -0.6, rxOnly: true }, 'offsetMhz'],
    [{ channel: 3, rxMhz: 146.82, narrow: 'yes' }, 'narrow'],
    [{ channel: 3, rxMhz: 146.82, rxTone: 'D999' }, 'rxTone'],
    [{ channel: 3, rxMhz: 146.82, name: 'CAFÉ' }, 'name'],
    [{ channel: 3, rxMhz: 146.82, offset: -0.6 }, 'offset'],
  ])('rejects %j naming channel 3 and the field', (entry, field) => {
    const err = failure(entry);
    expect(err.message).toMatch(new RegExp(`^plan channel 3, ${field}: `));
    expect(err.detail).toMatchObject({ channel: 3, field });
  });

  it('names the entry index when the channel is not a number', () => {
    expect(failure({ channel: '3', rxMhz: 146.82 }).message).toMatch(/^plan entry 1, channel: /);
  });

  it('rejects a channel listed twice', () => {
    expect(() => parsePlan({ channels: [{ channel: 2, rxMhz: 146.52 }, { channel: 2, rxMhz: 146.52 }] })).toThrow('plan channel 2: listed twice');
  });

  it('reads checkMhz as checkHz and leaves it out when absent', () => {
    expect(parsePlan({ checkMhz: 162.55, channels: [{ channel: 1, rxMhz: 162.4 }] }).checkHz).toBe(162_550_000);
    expect(parsePlan({ checkMhz: '162.400', channels: [{ channel: 1, rxMhz: 162.4 }] }).checkHz).toBe(162_400_000);
    expect(parsePlan({ channels: [{ channel: 1, rxMhz: 162.4 }] })).not.toHaveProperty('checkHz');
  });

  it.each([[300], [162.400005], ['loud'], [true]])('rejects checkMhz %j naming checkMhz', (checkMhz) => {
    let err: unknown;
    try {
      parsePlan({ checkMhz, channels: [{ channel: 1, rxMhz: 162.4 }] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).message).toMatch(/^plan checkMhz: /);
    expect((err as UsageError).detail).toMatchObject({ field: 'checkMhz' });
  });

  it('rejects a plan with no channels array', () => {
    expect(() => parsePlan({ name: 'x' })).toThrow(UsageError);
  });
});
