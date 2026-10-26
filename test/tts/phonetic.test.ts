import { describe, expect, it } from 'vitest';
import { UsageError } from '../../src/core/index.ts';
import { PHONETIC, idSentence, phonetic } from '../../src/tts/phonetic.ts';

describe('phonetic', () => {
  it('spells KJ7ABC with commas between the words', () => {
    expect(phonetic('KJ7ABC')).toBe('Kilo, Juliett, Seven, Alfa, Bravo, Charlie');
  });

  it('renders every letter and digit', () => {
    expect(phonetic('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe(
      'Alfa, Bravo, Charlie, Delta, Echo, Foxtrot, Golf, Hotel, India, Juliett, Kilo, Leema, Mike, November, Oscar, Pah-PAH, Keh-beck, Romeo, Sierra, Tango, Uniform, Victor, Whiskey, X-ray, Yankee, Zulu',
    );
    expect(phonetic('0123456789')).toBe('Zero, One, Two, Tree, Four, Fife, Six, Seven, Eight, Niner');
  });

  it('holds one word per letter and digit', () => {
    expect(Object.keys(PHONETIC).sort()).toEqual([...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ']);
  });

  it('reads lowercase letters', () => {
    expect(phonetic('kj7abc')).toBe(phonetic('KJ7ABC'));
  });

  it('rejects a character outside the table', () => {
    expect(() => phonetic('KJ7/P')).toThrow(UsageError);
  });
});

describe('idSentence', () => {
  it('prefixes the phonetic callsign with "This is"', () => {
    expect(idSentence('KJ7ABC')).toBe('This is Kilo, Juliett, Seven, Alfa, Bravo, Charlie');
  });
});
