import { UsageError } from '../core/index.ts';

/** NATO phonetic words for each letter and digit, spelled the way a TTS engine says them. */
export const PHONETIC: Readonly<Record<string, string>> = {
  A: 'Alfa',
  B: 'Bravo',
  C: 'Charlie',
  D: 'Delta',
  E: 'Echo',
  F: 'Foxtrot',
  G: 'Golf',
  H: 'Hotel',
  I: 'India',
  J: 'Juliett',
  K: 'Kilo',
  L: 'Leema',
  M: 'Mike',
  N: 'November',
  O: 'Oscar',
  P: 'pah-PAH',
  Q: 'keh-beck',
  R: 'Romeo',
  S: 'Sierra',
  T: 'Tango',
  U: 'Uniform',
  V: 'Victor',
  W: 'Whiskey',
  X: 'X-ray',
  Y: 'Yankee',
  Z: 'Zulu',
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'tree',
  '4': 'four',
  '5': 'fife',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'niner',
};

/**
 * Spell `callsign` with the phonetic table, each word capitalized and joined by commas so
 * the TTS engine pauses between them. A character outside the table throws a UsageError.
 */
export function phonetic(callsign: string): string {
  return [...callsign.toUpperCase()]
    .map((ch) => {
      const word = PHONETIC[ch];
      if (word === undefined) throw new UsageError(`callsign ${JSON.stringify(callsign)}: ${JSON.stringify(ch)} has no phonetic word; use letters and digits`, { callsign });
      return word[0]!.toUpperCase() + word.slice(1);
    })
    .join(', ');
}

/** Return the ID sentence that ends every transmission, such as "This is Kilo, Juliett, Seven". */
export function idSentence(callsign: string): string {
  return `This is ${phonetic(callsign)}`;
}
