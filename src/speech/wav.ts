import { writeFileSync } from 'node:fs';
import { SAMPLE_RATE } from './segment.ts';

/** Bytes of the canonical RIFF header wavFile writes. */
export const WAV_HEADER_BYTES = 44;

/** Wrap s16le mono PCM at `rate` in a 44-byte RIFF WAVE header. */
export function wavFile(pcm: Buffer, rate: number = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(WAV_HEADER_BYTES);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Write s16le mono PCM at 16 kHz to `path` as a WAV. */
export function writeWav(path: string, pcm: Buffer): void {
  writeFileSync(path, wavFile(pcm));
}
