const LOREM_WORD_BANK = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do',
  'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua', 'enim',
  'ad', 'minim', 'veniam', 'quis', 'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip',
  'ex', 'ea', 'commodo', 'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate',
  'velit', 'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint', 'occaecat', 'cupidatat',
  'non', 'proident', 'sunt', 'culpa', 'qui', 'officia', 'deserunt', 'mollit', 'anim', 'id', 'est', 'laborum',
];

const LOREM_OPENING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';

function randomLoremWord() {
  return LOREM_WORD_BANK[Math.floor(Math.random() * LOREM_WORD_BANK.length)];
}

function capitalizeFirst(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function makeLoremSentence() {
  const wordCount = 6 + Math.floor(Math.random() * 9);
  const words = Array.from({ length: wordCount }, randomLoremWord);
  return `${capitalizeFirst(words.join(' '))}.`;
}

function makeLoremParagraph() {
  const sentenceCount = 4 + Math.floor(Math.random() * 3);
  return Array.from({ length: sentenceCount }, makeLoremSentence).join(' ');
}

export function generateLoremText(unit: 'words' | 'sentences' | 'paragraphs', count: number, startWithLorem: boolean): string {
  const safeCount = Math.max(1, count);

  if (unit === 'words') {
    const words: string[] = startWithLorem ? LOREM_OPENING.replace('.', '').split(' ') : [];
    while (words.length < safeCount) words.push(randomLoremWord());
    return `${capitalizeFirst(words.slice(0, safeCount).join(' '))}.`;
  }

  if (unit === 'sentences') {
    const sentences: string[] = [];
    for (let i = 0; i < safeCount; i += 1) {
      sentences.push(i === 0 && startWithLorem ? LOREM_OPENING : makeLoremSentence());
    }
    return sentences.join(' ');
  }

  const paragraphs: string[] = [];
  for (let i = 0; i < safeCount; i += 1) {
    const paragraph = makeLoremParagraph();
    paragraphs.push(i === 0 && startWithLorem ? `${LOREM_OPENING} ${paragraph}` : paragraph);
  }
  return paragraphs.join('\n\n');
}
