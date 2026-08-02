// Singapore NRIC/FIN checksum generation & validation.

const NRIC_ST_TABLE = ['J', 'Z', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'];
const NRIC_FG_TABLE = ['X', 'W', 'U', 'T', 'R', 'Q', 'P', 'N', 'M', 'L', 'K'];
const NRIC_WEIGHTS = [2, 7, 6, 5, 4, 3, 2];

export function nricChecksumLetter(prefix: string, digits: number[]): string {
  let sum = digits.reduce((acc, d, i) => acc + d * NRIC_WEIGHTS[i], 0);
  if (prefix === 'T' || prefix === 'G') sum += 4;
  const remainder = sum % 11;
  const table = prefix === 'F' || prefix === 'G' ? NRIC_FG_TABLE : NRIC_ST_TABLE;
  return table[remainder];
}

export function generateNric(type: 'nric' | 'fin'): string {
  const prefix = type === 'nric' ? (Math.random() < 0.5 ? 'S' : 'T') : Math.random() < 0.5 ? 'F' : 'G';
  const digits = Array.from({ length: 7 }, () => Math.floor(Math.random() * 10));
  const letter = nricChecksumLetter(prefix, digits);
  return `${prefix}${digits.join('')}${letter}`;
}

export function validateNric(value: string): { valid: boolean; reason: 'format' | 'checksum' | null } {
  const match = /^([A-Za-z])(\d{7})([A-Za-z])$/.exec(value.trim());
  if (!match) return { valid: false, reason: 'format' };
  const prefix = match[1].toUpperCase();
  if (!['S', 'T', 'F', 'G'].includes(prefix)) return { valid: false, reason: 'format' };
  const digits = match[2].split('').map(Number);
  const providedLetter = match[3].toUpperCase();
  const expectedLetter = nricChecksumLetter(prefix, digits);
  return { valid: expectedLetter === providedLetter, reason: 'checksum' };
}
