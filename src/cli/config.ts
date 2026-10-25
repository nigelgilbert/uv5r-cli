import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UsageError, withDetail } from '../core/index.ts';
import { parseStation, type Station } from '../speech/station.ts';

/** Path of `uv5r.json` at the repo root, found the way `packageVersion()` finds `package.json`. */
export const DEFAULT_CONFIG = fileURLToPath(new URL('../../uv5r.json', import.meta.url));

/** The config file a verb reads; `required` is true when `--config` or `UV5R_CONFIG` named it. */
export interface ConfigPath {
  path: string;
  required: boolean;
}

/** Pick the config file: `--config FILE`, then `UV5R_CONFIG` when set and non-empty, then the repo default. */
export function resolveConfigPath(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): ConfigPath {
  if (flag !== undefined) return { path: flag, required: true };
  const named = env.UV5R_CONFIG;
  if (named !== undefined && named !== '') return { path: named, required: true };
  return { path: DEFAULT_CONFIG, required: false };
}

/**
 * Read and validate the station config at `path`. A missing file returns an empty Station
 * unless `required` is set. A required file that is missing, any other read failure, a
 * file that is not JSON and a key of the wrong type throw a UsageError with the file in
 * its detail.
 */
export function readStation(path: string, { required }: { required: boolean }): Station {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (!required && (err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new UsageError(`cannot read ${path}: ${(err as NodeJS.ErrnoException).message}`, { file: path });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new UsageError(`${path} is not JSON: ${(err as Error).message}`, { file: path });
  }
  try {
    return parseStation(json);
  } catch (err) {
    throw withDetail(err, { file: path });
  }
}
