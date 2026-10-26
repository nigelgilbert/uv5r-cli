import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WAV_HEADER_BYTES, wavFile, writeWav } from '../../src/tts/wav.ts';

describe('wavFile', () => {
  it('writes a 44-byte 16 kHz s16 mono RIFF header before the PCM', () => {
    const pcm = Buffer.from([1, 0, 2, 0, 3, 0]);
    const wav = wavFile(pcm);
    expect(wav.length).toBe(WAV_HEADER_BYTES + pcm.length);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.length);
    expect(wav.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt32LE(28)).toBe(32000);
    expect(wav.readUInt16LE(32)).toBe(2);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.subarray(WAV_HEADER_BYTES)).toEqual(pcm);
  });

  it('writes the file writeWav names', () => {
    const dir = mkdtempSync(join(tmpdir(), 'uv5r-wav-'));
    try {
      const file = join(dir, 'seg.wav');
      writeWav(file, Buffer.alloc(640));
      expect(readFileSync(file)).toEqual(wavFile(Buffer.alloc(640)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
