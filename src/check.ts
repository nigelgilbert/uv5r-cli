import { listen, type ListenResult } from './audio.ts';
import { formatMhz, type ChannelSpec } from './codec.ts';
import { DeviceStateError } from './errors.ts';
import { settle } from './protocol.ts';
import { withSession, writeChannel } from './radio.ts';
import type { Transport } from './transport.ts';

/** Seconds `check` listens when the caller gives no length. */
export const CHECK_SECONDS = 5;
/** Fewest seconds `check` listens; the 80% rule needs at least 4 active of 5. */
export const MIN_CHECK_SECONDS = 5;
/** Share of captured seconds a passing check has active. */
export const CHECK_ACTIVE_SHARE = 0.8;

export interface CheckOptions {
  /** avfoundation audio input to capture from. */
  device: string;
  /** Whole seconds to capture. */
  seconds: number;
  /** A second is active when its RMS is above this level in dBFS. */
  floorDbfs: number;
}

export type CheckResult = { slot: number; requestedMhz: string } & ListenResult;

/** Return `spec` as a receive-only record with no TX frequency. */
export function receiveOnly(spec: ChannelSpec): ChannelSpec {
  return { ...spec, rxOnly: true, txHz: undefined };
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
 * Write `spec` into slot `n` as a receive-only record in one clone session, wait for the
 * reload, then listen and judge the capture with judgeCheck. Slot `n` keeps the
 * receive-only record after the call, also when the capture fails.
 */
export async function checkChannel(t: Transport, n: number, spec: ChannelSpec, options: CheckOptions): Promise<CheckResult> {
  await withSession(t, (s) => writeChannel(s, n, receiveOnly(spec)));
  await settle();
  return judgeCheck(n, spec, await listen(options.device, options.seconds, options.floorDbfs));
}
