import { constants } from 'node:os';

/** Error kinds; each maps to one CLI exit code. */
export type ErrorKind = 'usage' | 'transport' | 'timeout' | 'device-state' | 'busy' | 'unexpected';

export const EXIT = {
  ok: 0,
  unexpected: 1,
  usage: 2,
  transport: 3,
  timeout: 4,
  deviceState: 5,
  busy: 6,
} as const;

export function exitCodeFor(kind: ErrorKind): number {
  switch (kind) {
    case 'usage':
      return EXIT.usage;
    case 'transport':
      return EXIT.transport;
    case 'timeout':
      return EXIT.timeout;
    case 'device-state':
      return EXIT.deviceState;
    case 'busy':
      return EXIT.busy;
    case 'unexpected':
      return EXIT.unexpected;
  }
}

/** Return 128 plus the signal number, the exit code for a key ended by a signal. */
export function signalExitCode(signal: NodeJS.Signals): number {
  return 128 + constants.signals[signal];
}

/** Reasons a TransportError carries; each exits 3. */
export type TransportReason = 'device-unavailable' | 'serial-io-failed' | 'ptt-control-failed' | 'dependency-missing' | 'audio-process-failed' | 'capture-incomplete';

/** Reasons a DeviceStateError carries; each exits 5. */
export type DeviceStateReason =
  | 'session-unavailable'
  | 'protocol-reply-invalid'
  | 'write-unacknowledged'
  | 'verification-failed'
  | 'image-incompatible'
  | 'audio-inactive'
  | 'squelch-open';

/** Why a command failed; every error carries one, and each maps to one kind. */
export type ErrorReason = TransportReason | DeviceStateReason | 'invalid-argument' | 'device-busy' | 'serial-timeout' | 'unexpected-error';

/** Whether to rerun the command: never, once as it stands, or after doing the remedy. */
export type Retry = 'no' | 'once' | 'after-remedy';

/** What to do next after an error. */
export interface Guidance {
  /** One imperative sentence. */
  remedy: string;
  retry: Retry;
}

/** What each retry value tells the caller. */
export const RETRY: Record<Retry, string> = {
  no: 'do not rerun the command; follow the remedy and report to the human',
  once: 'rerun the same command once; follow the remedy if it fails again',
  'after-remedy': 'rerun the command after doing the remedy',
};

interface ReasonDoc extends Guidance {
  kind: ErrorKind;
  /** One line on when the reason applies. */
  means: string;
}

/** Each reason's kind, meaning and the remedy and retry an error site uses unless it sets its own. */
export const REASONS: Record<ErrorReason, ReasonDoc> = {
  'device-unavailable': {
    kind: 'transport',
    means: 'no AIOC found, no device at the target path, or the port did not open',
    remedy: 'ask the human to reseat the AIOC cable, or pass --target PATH',
    retry: 'after-remedy',
  },
  'serial-io-failed': {
    kind: 'transport',
    means: 'a serial error or a disconnect while the port was open',
    remedy: 'ask the human to reseat the AIOC cable',
    retry: 'after-remedy',
  },
  'ptt-control-failed': {
    kind: 'transport',
    means: 'the port did not confirm a PTT assertion or release',
    remedy: 'ask the human to unplug the AIOC to drop PTT',
    retry: 'no',
  },
  'dependency-missing': {
    kind: 'transport',
    means: 'ffmpeg or afplay is missing from PATH',
    remedy: 'ask the human to install the missing program',
    retry: 'after-remedy',
  },
  'audio-process-failed': {
    kind: 'transport',
    means: 'ffmpeg or afplay exited with an error, timed out or stopped on a signal',
    remedy: 'check that --device names the AIOC input and the terminal has microphone access',
    retry: 'after-remedy',
  },
  'capture-incomplete': {
    kind: 'transport',
    means: 'ffmpeg returned fewer whole seconds than requested plus the first second the CLI drops; captured and requested count that second',
    remedy: 'rerun the command; check that --device names the AIOC input if it fails again',
    retry: 'once',
  },
  'session-unavailable': {
    kind: 'device-state',
    means: 'the radio did not answer or refused the clone handshake, or left clone mode mid-session',
    remedy: 'ask the human to check the radio is on and the cable is seated',
    retry: 'once',
  },
  'protocol-reply-invalid': {
    kind: 'device-state',
    means: 'the radio sent a malformed ident or read header',
    remedy: 'rerun the command; ask the human to power-cycle the radio if it fails again',
    retry: 'once',
  },
  'write-unacknowledged': {
    kind: 'device-state',
    means: 'the radio did not ack a block write; the block may or may not hold the new bytes',
    remedy: 'rerun the command; read the slot afterwards',
    retry: 'once',
  },
  'verification-failed': {
    kind: 'device-state',
    means: 'a write was acked but reads back different',
    remedy: 'read the slot, then rerun the write',
    retry: 'after-remedy',
  },
  'image-incompatible': {
    kind: 'device-state',
    means: 'the image ident differs from this radio, or the image is too short',
    remedy: 'pass an image dumped from this radio',
    retry: 'after-remedy',
  },
  'audio-inactive': {
    kind: 'device-state',
    means: 'a check heard fewer than 80% of its seconds above the floor',
    remedy: 'ask the human to set MR mode and select the slot',
    retry: 'after-remedy',
  },
  'squelch-open': {
    kind: 'device-state',
    means: 'squelch is 0, so noise reads as audio on any frequency; check and sweep stop before the write',
    remedy: 'run uv5r settings squelch 3',
    retry: 'after-remedy',
  },
  'invalid-argument': {
    kind: 'usage',
    means: 'bad input: a flag, argument, plan entry or file',
    remedy: 'fix the command and rerun',
    retry: 'after-remedy',
  },
  'device-busy': {
    kind: 'busy',
    means: 'another process holds the serial port',
    remedy: 'ask the human to close the other program, such as CHIRP or a terminal, that holds the port',
    retry: 'after-remedy',
  },
  'serial-timeout': {
    kind: 'timeout',
    means: 'no ack before a block read, or a short block payload',
    remedy: 'rerun the command; ask the human to check the radio is on if it fails again',
    retry: 'once',
  },
  'unexpected-error': {
    kind: 'unexpected',
    means: 'an error the CLI has no reason for',
    remedy: 'report the message to the human',
    retry: 'no',
  },
};

/**
 * Base class for errors that carry a kind, a reason, guidance and a JSON-safe detail
 * object. The kind follows from the reason. Remedy and retry default to the reason's
 * entry in REASONS; pass `guidance` to set them for one site.
 */
export class BaofengError extends Error {
  readonly kind: ErrorKind;
  readonly reason: ErrorReason;
  remedy: string;
  retry: Retry;
  readonly detail: Record<string, unknown>;

  constructor(reason: ErrorReason, message: string, detail: Record<string, unknown> = {}, guidance: Partial<Guidance> = {}) {
    super(message);
    this.name = 'BaofengError';
    this.reason = reason;
    this.kind = REASONS[reason].kind;
    this.remedy = guidance.remedy ?? REASONS[reason].remedy;
    this.retry = guidance.retry ?? REASONS[reason].retry;
    this.detail = { ...detail };
  }

  /** Add `extra` to the detail, replace any guidance given, and return this error. */
  attach(extra: Record<string, unknown>, guidance: Partial<Guidance> = {}): this {
    Object.assign(this.detail, extra);
    if (guidance.remedy !== undefined) this.remedy = guidance.remedy;
    if (guidance.retry !== undefined) this.retry = guidance.retry;
    return this;
  }

  toJSON(): Record<string, unknown> {
    return { reason: this.reason, message: this.message, remedy: this.remedy, retry: this.retry, ...this.detail };
  }
}

export class UsageError extends BaofengError {
  constructor(message: string, detail: Record<string, unknown> = {}, guidance: Partial<Guidance> = {}) {
    super('invalid-argument', message, detail, guidance);
  }
}

export class TransportError extends BaofengError {
  constructor(reason: TransportReason, message: string, detail: Record<string, unknown> = {}, guidance: Partial<Guidance> = {}) {
    super(reason, message, detail, guidance);
  }
}

export class TimeoutError extends BaofengError {
  constructor(message: string, detail: Record<string, unknown> = {}, guidance: Partial<Guidance> = {}) {
    super('serial-timeout', message, detail, guidance);
  }
}

export class DeviceStateError extends BaofengError {
  constructor(reason: DeviceStateReason, message: string, detail: Record<string, unknown> = {}, guidance: Partial<Guidance> = {}) {
    super(reason, message, detail, guidance);
  }
}

export class BusyError extends BaofengError {
  constructor(message: string, detail: Record<string, unknown> = {}, guidance: Partial<Guidance> = {}) {
    super('device-busy', message, detail, guidance);
  }
}

/** An error the CLI has no reason for, as cli prints it. */
export class UnexpectedError extends BaofengError {
  constructor(message: string, detail: Record<string, unknown> = {}) {
    super('unexpected-error', message, detail);
  }
}

/** Return `err` as a BaofengError with `extra` added to its detail; wrap anything else in an UnexpectedError. */
export function withDetail(err: unknown, extra: Record<string, unknown>): BaofengError {
  if (err instanceof BaofengError) return err.attach(extra);
  return new UnexpectedError(err instanceof Error ? err.message : String(err), extra);
}
