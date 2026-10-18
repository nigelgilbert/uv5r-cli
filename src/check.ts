import { listen, type ListenResult } from './audio.ts';
import { formatMhz, type ChannelSpec } from './codec.ts';
import { DeviceStateError } from './errors.ts';
import { settle } from './protocol.ts';
import { withSession, writeChannel } from './radio.ts';
import type { Transport } from './transport.ts';

/** Seconds `check` listens when the caller gives no length. */
export const CHECK_SECONDS = 5;

export interface CheckOptions {
  /** avfoundation audio input to capture from. */
  device: string;
  /** Whole seconds to capture. */
  seconds: number;
  /** A second is active when its RMS is above this level in dBFS. */
  floorDbfs: number;
}

export type CheckResult = { channel: number; rxMhz: string } & ListenResult;

/**
 * Prove the radio is parked on slot `n` in MR mode. Write `spec` into slot `n` in one
 * clone session, wait for the radio to reload, then listen. Return the listen result with
 * `channel` and `rxMhz` when any second is active. Throw a DeviceStateError on silence,
 * since a radio in VFO mode or on another slot never plays the written frequency.
 */
export async function checkChannel(t: Transport, n: number, spec: ChannelSpec, options: CheckOptions): Promise<CheckResult> {
  await withSession(t, (s) => writeChannel(s, n, spec));
  await settle();
  const heard = await listen(options.device, options.seconds, options.floorDbfs);
  const result = { channel: n, rxMhz: formatMhz(spec.rxHz), ...heard };
  if (result.activeSeconds > 0) return result;
  throw new DeviceStateError(`no audio on channel ${n}: set MR mode and select ${n}`, result);
}
