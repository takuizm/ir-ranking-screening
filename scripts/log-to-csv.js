'use strict';

const fs = require('fs');
const path = require('path');

const logPath = process.argv[2];
const outputPathArg = process.argv[3];

if (!logPath) {
  console.error('Usage: node scripts/log-to-csv.js <logPath> [outputCsvPath]');
  process.exit(1);
}

const logContent = fs.readFileSync(logPath, 'utf8');
const lines = logContent.split(/\r?\n/);

const OUTPUT_DIR = path.join(process.cwd(), 'output');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const timestampLabel = path.basename(logPath).replace(/\.log$/i, '');
const outputFilename =
  outputPathArg ||
  path.join(
    OUTPUT_DIR,
    `${timestampLabel || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}_from-log.csv`,
  );

const itemConfigs = [
  { key: 'hasSearch', label: 'サイト内検索がある', keyword: 'サイト内検索' },
  { key: 'hasEnglish', label: 'IR英語版サイトがある', keyword: '英語版サイト' },
  { key: 'hasTopMessage', label: '社長メッセージの掲載がある', keyword: '社長メッセージ' },
  { key: 'hasProfile', label: '社長の経歴の掲載がある', keyword: '社長経歴' },
  { key: 'hasIntegratedReport', label: '統合報告書(PDF)の掲載がある', keyword: '統合報告書' },
  { key: 'hasFinancialGraph', label: '財務情報をグラフで掲載している', keyword: '財務グラフ' },
  {
    key: 'hasShareholderBenefit',
    label: '株主還元もしくは株主優待について掲載がある',
    keyword: '株主還元・優待',
  },
  {
    key: 'hasSustainabilityMenu',
    label: 'グローバルメニューに「サステナビリティ」「ESG」「CSR」相当のメニューがある',
    keyword: 'サステナビリティメニュー',
  },
];

function createEmptyItem() {
  return {
    value: 0,
    hitUrl: '',
    detectedSelector: '',
    detectedElementType: '',
    note: '',
  };
}

function createEmptyResult(url = '') {
  const items = {};
  itemConfigs.forEach((config) => {
    items[config.key] = createEmptyItem();
  });
  return {
    url,
    actualUrl: '',
    items,
  };
}

const results = [];
let currentResult = null;

function finalizeCurrentResult() {
  if (currentResult) {
    results.push(currentResult);
  }
  currentResult = null;
}

const urlPattern = /^調査中:\s*(.+)$/;
const checkMark = '✓';
const crossMark = '✗';
const warningMark = '⚠️';

const parenthesesUrlPattern = /（(https?:\/\/[^)]+)）/;

function applyStatusToItem(config, line) {
  if (!currentResult) {
    return;
  }
  const item = currentResult.items[config.key] || createEmptyItem();
  if (line.includes(checkMark)) {
    item.value = 1;
  } else if (line.includes(crossMark) || line.includes(warningMark)) {
    item.value = 0;
  }

  const match = line.split(config.keyword)[1];
  if (match) {
    const noteText = match.replace(/^[：:\s]*/, '').trim();
    if (noteText) {
      item.note = noteText;
    }
  }

  if (config.key === 'hasEnglish') {
    const urlMatch = line.match(parenthesesUrlPattern);
    if (urlMatch) {
      item.hitUrl = urlMatch[1];
    }
  }

  currentResult.items[config.key] = item;
}

for (const line of lines) {
  if (!line.trim()) {
    continue;
  }

  const urlMatch = line.match(urlPattern);
  if (urlMatch) {
    finalizeCurrentResult();
    currentResult = createEmptyResult(urlMatch[1].trim());
    continue;
  }

  if (!currentResult) {
    continue;
  }

  for (const config of itemConfigs) {
    if (line.includes(config.keyword)) {
      applyStatusToItem(config, line);
      break;
    }
  }
}

finalizeCurrentResult();

if (results.length === 0) {
  console.warn('No results parsed from log. Check the log format or path.');
}

let csv = '対象URL,調査項目,Value,ヒットしたURL,検出セレクタ,検出要素タイプ,備考\n';

results.forEach((result) => {
  itemConfigs.forEach((config) => {
    const item = result.items[config.key] || createEmptyItem();
    const detectedSelector = item.detectedSelector || '';
    const detectedElementType = item.detectedElementType || '';
    const line = [
      result.url,
      config.label,
      item.value,
      item.hitUrl,
      detectedSelector,
      detectedElementType,
      item.note,
    ]
      .map((value) => {
        if (value === undefined || value === null) {
          return '';
        }
        const str = String(value);
        if (/[,"\n]/.test(str)) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(',');
    csv += `${line}\n`;
  });
});

fs.writeFileSync(outputFilename, csv, 'utf8');
console.log(`ログを解析してCSVを出力しました: ${outputFilename}`);
console.log(`解析件数: ${results.length}件`);
