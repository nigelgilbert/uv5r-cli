import { DEFAULT_FLOOR_DBFS, listen, type ListenResult } from './audio.ts';
import { formatMhz, type ChannelSpec } from './codec.ts';
import { DeviceStateError, withDetail } from './errors.ts';
import { settle, type Session } from './protocol.ts';
import { readSettings, withSession, writeChannel } from './radio.ts';
import type { Transport } from './transport.ts';

/** Seconds `check` listens. */
export const CHECK_SECONDS = 5;
/** Share of captured seconds a passing check has active. */
export const CHECK_ACTIVE_SHARE = 0.8;

export interface CheckOptions {
  /** avfoundation audio input to capture from. */
  device: string;
}

export type CheckResult = { slot: number; requestedMhz: string } & ListenResult;

/** Return `spec` as a receive-only record with no TX frequency. */
export function receiveOnly(spec: ChannelSpec): ChannelSpec {
  return { ...spec, rxOnly: true, txHz: undefined };
}

/**
 * Read the squelch setting in session `s` and throw a squelch-open DeviceStateError when it
 * is 0. Open squelch passes noise as audio on any frequency, so a check before slot `n` is
 * written calls this first.
 */
export async function refuseOpenSquelch(s: Session, n: number): Promise<void> {
  const { squelch } = await readSettings(s);
  if (squelch !== 0) return;
  throw new DeviceStateError(
    'squelch-open',
    `squelch is 0, so noise reads as audio on any frequency; slot ${n} not written; run uv5r settings squelch 3, then check again`,
    { slot: n, squelch },
  );
}

/** Return the active seconds a capture of `seconds` needs to pass a check. */
export function neededSeconds(seconds: number): number {
  return Math.ceil(CHECK_ACTIVE_SHARE * seconds);
}

/**
 * Judge a capture taken after writing `spec` into slot `n`. Return it with `slot` and
 * `requestedMhz` when at least 80% of its seconds are active. Throw a DeviceStateError
 * that lists the causes otherwise. A pass means audio above the floor after writing slot
 * `n`, consistent with the radio receiving slot `n`; the received frequency stays unverified.
 */
export function judgeCheck(n: number, spec: ChannelSpec, heard: ListenResult): CheckResult {
  const result = { slot: n, requestedMhz: formatMhz(spec.rxHz), ...heard };
  const total = heard.active.length;
  const needed = neededSeconds(total);
  if (total > 0 && heard.activeSeconds >= needed) return result;
  throw new DeviceStateError(
    'audio-inactive',
    `slot ${n}: ${heard.activeSeconds} of ${total} s active after writing ${result.requestedMhz} MHz, check needs ${needed}; ` +
      `causes: VFO mode, another slot selected, volume knob down, plug unseated, quiet frequency; ` +
      `ask the human to set MR mode and select slot ${n}`,
    result,
    { remedy: `ask the human to set MR mode and select slot ${n}` },
  );
}

/**
 * Refuse an open squelch, then write `spec` into slot `n` as a receive-only record in the
 * same clone session. Wait for the reload, listen CHECK_SECONDS at DEFAULT_FLOOR_DBFS and
 * judge the capture with judgeCheck. Slot `n` keeps the receive-only record after the
 * write, also when the capture fails; a capture error then carries `slot` and `requestedMhz`.
 */
export async function checkChannel(t: Transport, n: number, spec: ChannelSpec, options: CheckOptions): Promise<CheckResult> {
  await withSession(t, async (s) => {
    await refuseOpenSquelch(s, n);
    return writeChannel(s, n, receiveOnly(spec));
  });
  await settle();
  let heard: ListenResult;
  try {
    heard = await listen(options.device, CHECK_SECONDS, DEFAULT_FLOOR_DBFS);
  } catch (err) {
    throw withDetail(err, { slot: n, requestedMhz: formatMhz(spec.rxHz) });
  }
  return judgeCheck(n, spec, heard);
}
