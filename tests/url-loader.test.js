import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import {
  extractCompanyName,
  detectFormat,
  loadUrls,
} from '../src/lib/url-loader';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('url-loader utilities', () => {
  it('detects format from extension', () => {
    expect(detectFormat('input.json')).toBe('json');
    expect(detectFormat('input.csv')).toBe('csv');
    expect(detectFormat('input.txt')).toBe('txt');
  });

  it('extracts company name from URL', () => {
    expect(extractCompanyName('https://example.com/ir/')).toBe('example');
    expect(extractCompanyName('http://www.sample.co.jp')).toBe('sample');
    expect(extractCompanyName('')).toBe('');
  });

  it('loads sample JSON urls', () => {
    const jsonPath = path.join(__dirname, '..', 'input', 'urls_sample.json');
    const entries = loadUrls(jsonPath);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]).toHaveProperty('url');
  });

  it('loads sample TXT urls', () => {
    const txtPath = path.join(__dirname, '..', 'input', 'urls_sample.txt');
    const entries = loadUrls(txtPath);
    expect(entries.every((item) => item.url.startsWith('http'))).toBe(true);
  });
});
