import { astatsFilter, parseAstats, runFfmpeg } from '../cli/audio.ts';

/** Sample rate measureWav counts samples at; the transmit WAV is 48 kHz. */
export const WAV_RATE = 48000;

/** Milliseconds measureWav gives ffmpeg. */
const MEASURE_TIMEOUT_MS = 30_000;

/** Levels and length of one WAV file. */
export interface WavLevels {
  /** Length in seconds at WAV_RATE. */
  seconds: number;
  /** Highest sample peak in dBFS; -Infinity for digital zero. */
  peakDbfs: number;
  /** RMS over the whole file in dBFS; -Infinity for digital zero. */
  rmsDbfs: number;
}

/**
 * ffmpeg arguments that print astats over the whole of `file`. reset 0 accumulates over
 * every frame, so the last printed frame holds the whole-file peak, RMS and sample count.
 * No frame is dropped, since a file has no capture-start burst.
 */
export function measureArgs(file: string): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-i',
    file,
    '-af',
    [`aformat=sample_fmts=flt:sample_rates=${WAV_RATE}:channel_layouts=mono`, astatsFilter(['Peak_level', 'RMS_level', 'Number_of_samples'], 0), 'ametadata=print'].join(','),
    '-f',
    'null',
    '-',
  ];
}

/** Read the whole-file levels from measureArgs stderr; an empty file reads as zero seconds of digital zero. */
export function parseWavLevels(stderr: string): WavLevels {
  const levels = parseAstats(stderr);
  return {
    seconds: (levels.samples.at(-1) ?? 0) / WAV_RATE,
    peakDbfs: levels.peak.at(-1) ?? -Infinity,
    rmsDbfs: levels.rms.at(-1) ?? -Infinity,
  };
}

/** Measure the peak, RMS and length of `file` with one ffmpeg astats pass. */
export async function measureWav(file: string): Promise<WavLevels> {
  return parseWavLevels(await runFfmpeg(measureArgs(file), `measuring ${file}`, MEASURE_TIMEOUT_MS));
}
