import { constants } from 'node:os';
import type { ErrorKind } from '../core/errors.ts';

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
