import { describe, expect, test } from 'vitest';
import {
  evaluateFinancialText,
  evaluateShareholderContent,
  evaluateTopMessage,
  selectIntegratedReportLink,
} from '../src/lib/spec-validators';

describe('evaluateTopMessage', () => {
  const thresholdDate = new Date(2024, 0, 1);
  const runDate = new Date(2025, 9, 14);

  test('returns valid when keyword and recent dated month exist', () => {
    const text = '社長メッセージ 2024年9月10日に更新しました。';
    const result = evaluateTopMessage(text, {
      keywords: ['社長メッセージ'],
      thresholdDate,
      today: runDate,
    });
    expect(result.isValid).toBe(true);
    expect(result.recentDate?.getFullYear()).toBe(2024);
    expect(result.hasKeyword).toBe(true);
  });

  test('fails when month is missing from date', () => {
    const text = '社長メッセージ 2024年のご挨拶。';
    const result = evaluateTopMessage(text, {
      keywords: ['社長メッセージ'],
      thresholdDate,
      today: runDate,
    });
    expect(result.isValid).toBe(false);
  });

  test('fails when date is older than threshold', () => {
    const text = '社長メッセージ 2023年12月10日をご覧ください。';
    const result = evaluateTopMessage(text, {
      keywords: ['社長メッセージ'],
      thresholdDate,
      today: runDate,
    });
    expect(result.isValid).toBe(false);
  });
});

describe('selectIntegratedReportLink', () => {
  test('selects the most recent PDF with required keyword and year', () => {
    const links = [
      {
        href: 'https://example.com/ir/2022_report.pdf',
        text: '2022年度 統合報告書',
      },
      {
        href: 'https://example.com/ir/2024_report.pdf',
        text: '2024年度 統合報告書（PDF）',
      },
    ];

    const result = selectIntegratedReportLink(links, {
      minYear: 2023,
      keywords: ['統合報告書'],
      pdfIndicators: ['.pdf', 'pdf'],
    });

    expect(result).not.toBeNull();
    expect(result?.href).toContain('2024_report.pdf');
    expect(result?.latestYear).toBe(2024);
  });

  test('returns null when only outdated PDFs exist', () => {
    const links = [
      {
        href: 'https://example.com/ir/2022_report.pdf',
        text: '2022年度 統合報告書',
      },
    ];

    const result = selectIntegratedReportLink(links, {
      minYear: 2023,
      keywords: ['統合報告書'],
      pdfIndicators: ['.pdf'],
    });

    expect(result).toBeNull();
  });
});

describe('evaluateFinancialText', () => {
  test('detects recent fiscal year within text', () => {
    const text = '2024年度の売上高は前年度比を上回りました。';
    const result = evaluateFinancialText(text, { minYear: 2024 });
    expect(result.hasRecentYear).toBe(true);
    expect(result.latestYear).toBe(2024);
  });

  test('fails when only older years are present', () => {
    const text = '2022年度と2023年度の業績推移を掲載。';
    const result = evaluateFinancialText(text, { minYear: 2024 });
    expect(result.hasRecentYear).toBe(false);
  });
});

describe('evaluateShareholderContent', () => {
  test('accepts text containing shareholder return policies', () => {
    const text = '株主還元方針として安定配当を掲げています。';
    const result = evaluateShareholderContent(text, {
      primaryKeywords: ['株主還元', '株主還元方針'],
      minimumTextLength: 10,
    });
    expect(result.isValid).toBe(true);
    expect(result.matchedKeyword).toBe('株主還元');
  });

  test('rejects text containing only payout ratio numbers', () => {
    const text = '配当性向 30% 35% 40%';
    const result = evaluateShareholderContent(text, {
      primaryKeywords: ['株主還元', '配当政策'],
      minimumTextLength: 10,
    });
    expect(result.isValid).toBe(false);
  });
});
