import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL, modelName, parseWhisperJson, REPO_ROOT, repoPath, transcribeWav, VAD_MODEL, whisperArgs, whisperTranscriber } from '../../src/speech/stt.ts';

const TMP = mkdtempSync(join(tmpdir(), 'uv5r-stt-'));

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** whisper-cli -oj output in the shape of output_json in whisper.cpp examples/cli/cli.cpp. */
const SAMPLE_JSON = JSON.stringify({
  systeminfo: 'WHISPER : COREML = 0 | OPENVINO = 0 | Metal : EMBED_LIBRARY = 1 | CPU : NEON = 1 | ARM_FMA = 1 |',
  model: {
    type: 'base',
    multilingual: false,
    vocab: 51864,
    audio: { ctx: 1500, state: 512, head: 8, layer: 6 },
    text: { ctx: 448, state: 512, head: 8, layer: 6 },
    mels: 80,
    ftype: 9,
  },
  params: { model: 'models/ggml-base.en-q5_1.bin', language: 'en', translate: false },
  result: { language: 'en' },
  transcription: [
    { timestamps: { from: '00:00:00,000', to: '00:00:02,500' }, offsets: { from: 0, to: 2500 }, text: ' Bench, this is Kilo Juliett Seven,' },
    { timestamps: { from: '00:00:02,500', to: '00:00:04,320' }, offsets: { from: 2500, to: 4320 }, text: '  status, over.' },
  ],
});

const OPTIONS = { model: '/m/ggml-base.en-q5_1.bin', vadModel: '/m/ggml-silero-v6.2.0.bin', prompt: 'KJ7ABC' };

/** Write a whisper-cli stand-in into a new directory: it writes $FAKE_WHISPER_JSON to the -of path plus .json, fails with $FAKE_WHISPER_FAIL, or sleeps $FAKE_WHISPER_SLEEP seconds. */
function fakeWhisperDir(): string {
  const dir = mkdtempSync(join(TMP, 'bin-'));
  const script = join(dir, 'whisper-cli');
  writeFileSync(
    script,
    [
      '#!/bin/sh',
      'while [ $# -gt 0 ]; do case "$1" in -of) out="$2"; shift;; esac; shift; done',
      'if [ -n "$FAKE_WHISPER_FAIL" ]; then echo "$FAKE_WHISPER_FAIL" >&2; exit 2; fi',
      'if [ -n "$FAKE_WHISPER_SLEEP" ]; then exec /bin/sleep "$FAKE_WHISPER_SLEEP"; fi',
      'printf "%s" "$FAKE_WHISPER_JSON" > "$out.json"',
      '',
    ].join('\n'),
  );
  chmodSync(script, 0o755);
  return dir;
}

describe('whisperArgs', () => {
  it('builds the plan argv with the prompt, VAD and JSON output', () => {
    expect(whisperArgs('/s/seg-000001.wav', '/s/seg-000001', OPTIONS)).toEqual([
      '-m',
      '/m/ggml-base.en-q5_1.bin',
      '--vad',
      '-vm',
      '/m/ggml-silero-v6.2.0.bin',
      '-sns',
      '--prompt',
      'KJ7ABC',
      '-oj',
      '-of',
      '/s/seg-000001',
      '/s/seg-000001.wav',
    ]);
  });

  it('leaves the prompt out when it is empty', () => {
    expect(whisperArgs('a.wav', 'a', { ...OPTIONS, prompt: '' })).not.toContain('--prompt');
  });
});

describe('parseWhisperJson', () => {
  it('joins the transcription texts and trims the whitespace', () => {
    expect(parseWhisperJson(SAMPLE_JSON)).toBe('Bench, this is Kilo Juliett Seven, status, over.');
  });

  it('returns empty text for an empty transcription array', () => {
    expect(parseWhisperJson(JSON.stringify({ transcription: [] }))).toBe('');
  });

  it.each([['not json'], [JSON.stringify({ result: {} })], ['null']])('throws speech-engine-failed on %s', (text) => {
    expect(() => parseWhisperJson(text)).toThrow(expect.objectContaining({ reason: 'speech-engine-failed' }));
  });
});

describe('model paths', () => {
  it('resolves a relative model path against the repo root and keeps an absolute one', () => {
    expect(repoPath(DEFAULT_MODEL)).toBe(join(REPO_ROOT, 'models/ggml-base.en-q5_1.bin'));
    expect(repoPath(VAD_MODEL)).toBe(join(REPO_ROOT, 'models/ggml-silero-v6.2.0.bin'));
    expect(repoPath('/abs/model.bin')).toBe('/abs/model.bin');
    expect(existsSync(join(REPO_ROOT, 'package.json'))).toBe(true);
  });

  it('names the model by its file name without .bin', () => {
    expect(modelName(repoPath(DEFAULT_MODEL))).toBe('ggml-base.en-q5_1');
  });
});

describe('whisperTranscriber', () => {
  const model = join(TMP, 'model.bin');
  const vad = join(TMP, 'vad.bin');
  writeFileSync(model, 'm');
  writeFileSync(vad, 'v');

  it.each([
    ['the model', { model: join(TMP, 'missing-model.bin'), vadModel: vad }, join(TMP, 'missing-model.bin')],
    ['the VAD model', { model, vadModel: join(TMP, 'missing-vad.bin') }, join(TMP, 'missing-vad.bin')],
  ])('throws dependency-missing naming %s when its file is missing', (_what, paths, file) => {
    expect(() => whisperTranscriber({ ...paths, prompt: '' })).toThrow(expect.objectContaining({ reason: 'dependency-missing', detail: { file }, message: expect.stringContaining(file) }));
  });

  it('throws dependency-missing naming whisper-cli when it is not on PATH', () => {
    vi.stubEnv('PATH', mkdtempSync(join(TMP, 'empty-')));
    expect(() => whisperTranscriber({ model, vadModel: vad, prompt: '' })).toThrow(expect.objectContaining({ reason: 'dependency-missing', message: expect.stringContaining('whisper-cli') }));
  });

  it('returns a transcribe that runs whisper-cli from PATH', async () => {
    vi.stubEnv('PATH', fakeWhisperDir());
    vi.stubEnv('FAKE_WHISPER_JSON', SAMPLE_JSON);
    const transcribe = whisperTranscriber({ model, vadModel: vad, prompt: 'KJ7ABC' });
    const wav = join(TMP, 'seg-000001.wav');
    writeFileSync(wav, '');
    const result = await transcribe(wav);
    expect(result.text).toBe('Bench, this is Kilo Juliett Seven, status, over.');
    expect(result.inferMs).toBeGreaterThanOrEqual(0);
    expect(existsSync(join(TMP, 'seg-000001.json'))).toBe(false);
  });
});

describe('transcribeWav', () => {
  it('rejects with dependency-missing when whisper-cli is absent', async () => {
    vi.stubEnv('PATH', mkdtempSync(join(TMP, 'empty-')));
    await expect(transcribeWav(join(TMP, 'a.wav'), OPTIONS)).rejects.toMatchObject({ reason: 'dependency-missing', message: expect.stringContaining('whisper-cli') });
  });

  it('rejects with speech-engine-failed and the stderr tail on a non-zero exit', async () => {
    vi.stubEnv('PATH', fakeWhisperDir());
    vi.stubEnv('FAKE_WHISPER_FAIL', 'error: failed to open model');
    await expect(transcribeWav(join(TMP, 'b.wav'), OPTIONS)).rejects.toMatchObject({
      kind: 'transport',
      reason: 'speech-engine-failed',
      message: expect.stringContaining('exited with code 2'),
      detail: expect.objectContaining({ code: 2, wav: join(TMP, 'b.wav') }),
    });
    await expect(transcribeWav(join(TMP, 'b.wav'), OPTIONS)).rejects.toThrow('failed to open model');
  });

  it('rejects with speech-engine-failed when whisper-cli runs past its timeout', async () => {
    vi.stubEnv('PATH', fakeWhisperDir());
    vi.stubEnv('FAKE_WHISPER_SLEEP', '30');
    await expect(transcribeWav(join(TMP, 'd.wav'), OPTIONS, 200)).rejects.toMatchObject({
      reason: 'speech-engine-failed',
      message: expect.stringContaining('timed out after 0.2s'),
      detail: expect.objectContaining({ signal: 'SIGTERM', wav: join(TMP, 'd.wav') }),
    });
  });

  it('rejects with speech-engine-failed when whisper-cli writes JSON without a transcription', async () => {
    vi.stubEnv('PATH', fakeWhisperDir());
    vi.stubEnv('FAKE_WHISPER_JSON', '{}');
    await expect(transcribeWav(join(TMP, 'c.wav'), OPTIONS)).rejects.toMatchObject({ reason: 'speech-engine-failed' });
    expect(existsSync(join(TMP, 'c.json'))).toBe(false);
  });
});
