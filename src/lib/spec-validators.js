'use strict';

const ERA_OFFSETS = {
  令和: 2018,
  平成: 1988,
  昭和: 1925,
};

const ENGLISH_MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  sept: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function normalizeDigits(input) {
  if (!input) {
    return '';
  }
  return input.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function cleanText(input) {
  return normalizeDigits(input || '').replace(/\s+/g, ' ').trim();
}

function convertJapaneseEraToYear(era, value) {
  const offset = ERA_OFFSETS[era];
  if (!offset) {
    return null;
  }
  const eraYear = parseInt(value, 10);
  if (Number.isNaN(eraYear) || eraYear <= 0) {
    return null;
  }
  return offset + eraYear;
}

function clampMonth(month) {
  const parsed = parseInt(month, 10);
  if (Number.isNaN(parsed)) {
    return null;
  }
  if (parsed < 1 || parsed > 12) {
    return null;
  }
  return parsed;
}

function parseIntSafe(value) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function extractDateCandidates(text) {
  const normalized = normalizeDigits(text || '');
  const candidates = [];

  const pushDate = (year, month, day, source) => {
    const verifiedMonth = clampMonth(month);
    if (!year || !verifiedMonth) {
      return;
    }
    const parsedYear = parseIntSafe(year);
    if (!parsedYear) {
      return;
    }
    const parsedDay = parseIntSafe(day) || 1;
    const candidate = new Date(parsedYear, verifiedMonth - 1, parsedDay);
    if (Number.isNaN(candidate.getTime())) {
      return;
    }
    candidates.push({ date: candidate, source });
  };

  const pushEraDate = (era, eraYear, month, day, source) => {
    const convertedYear = convertJapaneseEraToYear(era, eraYear);
    if (!convertedYear) {
      return;
    }
    pushDate(convertedYear, month, day, source);
  };

  const jpPattern = /(\d{4})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?/g;
  let match = null;
  while ((match = jpPattern.exec(normalized)) !== null) {
    pushDate(match[1], match[2], match[3], match[0]);
  }

  const numericPattern = /(\d{4})[./-](\d{1,2})(?:[./-](\d{1,2}))?/g;
  while ((match = numericPattern.exec(normalized)) !== null) {
    pushDate(match[1], match[2], match[3], match[0]);
  }

  const eraPattern = /(令和|平成|昭和)\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?/g;
  while ((match = eraPattern.exec(normalized)) !== null) {
    pushEraDate(match[1], match[2], match[3], match[4], match[0]);
  }

  const englishMonthPattern =
    /\b(January|February|March|April|May|June|July|August|September|Sept\.?|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Oct\.?|Nov\.?|Dec\.?)\s+(\d{1,2},\s*)?(\d{4})\b/gi;
  while ((match = englishMonthPattern.exec(normalized)) !== null) {
    const monthName = match[1].replace(/\./g, '').toLowerCase();
    const month = ENGLISH_MONTHS[monthName];
    if (!month) {
      continue;
    }
    const dayRaw = match[2] ? match[2].replace(/[^0-9]/g, '') : '';
    const day = dayRaw ? parseIntSafe(dayRaw) : 1;
    const year = parseIntSafe(match[3]);
    if (!year) {
      continue;
    }
    pushDate(year, month, day, match[0]);
  }

  const englishDayFirstPattern =
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|Sept\.?|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Oct\.?|Nov\.?|Dec\.?)\s+(\d{4})\b/gi;
  while ((match = englishDayFirstPattern.exec(normalized)) !== null) {
    const monthName = match[2].replace(/\./g, '').toLowerCase();
    const month = ENGLISH_MONTHS[monthName];
    if (!month) {
      continue;
    }
    const day = parseIntSafe(match[1]) || 1;
    const year = parseIntSafe(match[3]);
    if (!year) {
      continue;
    }
    pushDate(year, month, day, match[0]);
  }

  const unique = new Map();
  candidates.forEach((entry) => {
    const key = entry.date.getTime();
    if (!unique.has(key)) {
      unique.set(key, entry);
    }
  });

  return Array.from(unique.values());
}

function findMostRecentDate(text, { thresholdDate, today }) {
  const dates = extractDateCandidates(text);
  if (dates.length === 0) {
    return null;
  }
  const lowerBound = thresholdDate ? thresholdDate.getTime() : -Infinity;
  const upperBound = today ? today.getTime() : Infinity;
  const validDates = dates
    .map((entry) => entry.date)
    .filter((date) => {
      const time = date.getTime();
      return time >= lowerBound && time <= upperBound;
    });
  if (validDates.length === 0) {
    return null;
  }
  return new Date(Math.max(...validDates.map((d) => d.getTime())));
}

function includesKeyword(text, keyword) {
  if (!keyword) {
    return false;
  }
  if (!text) {
    return false;
  }
  const normalizedText = text.toLowerCase();
  return normalizedText.includes(keyword.toLowerCase());
}

function evaluateTopMessage(text, { keywords = [], thresholdDate, today }) {
  const cleaned = cleanText(text);
  if (!cleaned) {
    return { isValid: false, hasKeyword: false, recentDate: null };
  }

  const hasKeyword = keywords.some((keyword) => cleaned.includes(keyword));
  if (!hasKeyword) {
    return { isValid: false, hasKeyword: false, recentDate: null };
  }

  const recentDate = findMostRecentDate(cleaned, { thresholdDate, today });
  return {
    isValid: Boolean(recentDate),
    hasKeyword: true,
    recentDate,
  };
}

function extractYearsFromString(input) {
  const normalized = normalizeDigits(input || '');
  const years = [];

  const numericPattern = /\b(20\d{2})\b/g;
  let match = null;
  while ((match = numericPattern.exec(normalized)) !== null) {
    years.push(parseInt(match[1], 10));
  }

  const fiscalPattern = /\bFY\s*(20\d{2})\b/gi;
  while ((match = fiscalPattern.exec(normalized)) !== null) {
    years.push(parseInt(match[1], 10));
  }

  const eraPattern = /(令和|平成|昭和)\s*(\d{1,2})\s*年度?/g;
  while ((match = eraPattern.exec(normalized)) !== null) {
    const converted = convertJapaneseEraToYear(match[1], match[2]);
    if (converted) {
      years.push(converted);
    }
  }

  const uniqueYears = Array.from(new Set(years));
  return uniqueYears.sort((a, b) => a - b);
}

function evaluateFinancialText(text, { minYear }) {
  const cleaned = cleanText(text);
  if (!cleaned) {
    return { hasRecentYear: false, latestYear: null };
  }

  const years = extractYearsFromString(cleaned);
  if (years.length === 0) {
    return { hasRecentYear: false, latestYear: null };
  }

  const latestYear = Math.max(...years);
  return {
    hasRecentYear: latestYear >= minYear,
    latestYear,
  };
}

function selectIntegratedReportLink(links, { minYear, keywords = [], pdfIndicators = [] }) {
  if (!Array.isArray(links) || links.length === 0) {
    return null;
  }

  const normalizedPdfIndicators = pdfIndicators.map((indicator) => indicator.toLowerCase());
  const candidates = [];

  links.forEach((link) => {
    const href = link.href || '';
    const text = link.text || '';
    const combined = cleanText(`${text} ${href}`);
    if (!combined) {
      return;
    }

    const matchesKeyword = keywords.some((keyword) => combined.includes(keyword));
    if (!matchesKeyword) {
      return;
    }

    const lowerHref = href.toLowerCase();
    const lowerText = text.toLowerCase();
    const isPdf = normalizedPdfIndicators.some(
      (indicator) => lowerHref.includes(indicator) || lowerText.includes(indicator),
    );
    if (!isPdf) {
      return;
    }

    const years = extractYearsFromString(combined);
    if (years.length === 0) {
      return;
    }
    const latestYear = Math.max(...years);
    if (latestYear < minYear) {
      return;
    }

    candidates.push({
      href,
      text,
      latestYear,
    });
  });

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.latestYear - a.latestYear);
  return candidates[0];
}

function evaluateShareholderContent(text, { primaryKeywords = [], minimumTextLength = 15 }) {
  const cleaned = cleanText(text);
  if (!cleaned) {
    return { isValid: false, matchedKeyword: null };
  }

  const textWithoutDigits = cleaned.replace(/[0-9.,％%]/g, '');
  if (textWithoutDigits.length < minimumTextLength) {
    return { isValid: false, matchedKeyword: null };
  }

  const matchedKeyword =
    primaryKeywords.find((keyword) => cleaned.includes(keyword)) || null;

  return {
    isValid: Boolean(matchedKeyword),
    matchedKeyword,
  };
}

module.exports = {
  cleanText,
  convertJapaneseEraToYear,
  evaluateFinancialText,
  evaluateShareholderContent,
  evaluateTopMessage,
  extractDateCandidates,
  extractYearsFromString,
  findMostRecentDate,
  normalizeDigits,
  selectIntegratedReportLink,
};
