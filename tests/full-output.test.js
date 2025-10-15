import { describe, expect, test } from 'vitest';
import { generateCsv } from '../src/full';

function createItem({ value = 0, hitUrl = '', note = '', detectedSelector = '', detectedElementType = '' } = {}) {
  return { value, hitUrl, note, detectedSelector, detectedElementType };
}

describe('generateCsv', () => {
  test('includes 備考 column populated with notes', () => {
    const result = {
      url: 'https://example.com/ir/',
      items: {
        hasSearch: createItem({
          value: 1,
          hitUrl: 'https://example.com/ir/',
          note: 'サイト内検索: 検出',
          detectedSelector: 'input[type="search"]',
          detectedElementType: 'search-element',
        }),
        hasEnglish: createItem({ note: 'IR英語版サイト: 未検出' }),
        hasTopMessage: createItem(),
        hasProfile: createItem(),
        hasIntegratedReport: createItem(),
        hasFinancialGraph: createItem(),
        hasShareholderBenefit: createItem(),
        hasSustainabilityMenu: createItem(),
      },
    };

    const csv = generateCsv([result]);
    const lines = csv.trim().split('\n');

    expect(lines[0].split(',').pop()).toBe('備考');
    const searchLine = lines.find((line) => line.includes('サイト内検索がある'));
    expect(searchLine?.endsWith('サイト内検索: 検出')).toBe(true);

    const englishLine = lines.find((line) => line.includes('IR英語版サイトがある'));
    expect(englishLine?.endsWith('IR英語版サイト: 未検出')).toBe(true);
  });
});
