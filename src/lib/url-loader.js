const fs = require('fs');
const path = require('path');

function extractCompanyName(url) {
  if (!url || typeof url !== 'string') {
    return '';
  }
  const domain = url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
  return domain.split('.')[0] || '';
}

function detectFormat(filePath, overrideFormat) {
  if (overrideFormat) {
    return overrideFormat.toLowerCase();
  }
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.json':
      return 'json';
    case '.csv':
      return 'csv';
    case '.txt':
      return 'txt';
    default:
      return 'json';
  }
}

function loadUrlsFromJson(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(content);
  if (!Array.isArray(data.urls)) {
    throw new Error('JSON file must contain an array under "urls" key.');
  }
  return data.urls.map((item) => {
    if (typeof item === 'string') {
      return { code: '', name: extractCompanyName(item), url: item };
    }
    return {
      code: item.code || '',
      name: item.name || extractCompanyName(item.url),
      url: item.url,
    };
  });
}

function detectCsvDelimiter(headerLine) {
  return headerLine.includes('|') ? '|' : ',';
}

function loadUrlsFromCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const headerLine = lines[0];
  const delimiter = detectCsvDelimiter(headerLine);
  const headers = headerLine.split(delimiter).map((header) => header.trim().toLowerCase());
  const hasCodeColumn = headers.some((header) => header === 'code' || header.includes('コード'));

  return lines.slice(1).map((line) => {
    const values = line.split(delimiter).map((value) => value.trim().replace(/^"|"$/g, ''));
    if (hasCodeColumn) {
      return {
        code: values[0] || '',
        name: values[1] || extractCompanyName(values[2]),
        url: values[2] || values[1],
      };
    }
    return {
      code: '',
      name: values[0] || extractCompanyName(values[1]),
      url: values[1],
    };
  });
}

function loadUrlsFromTxt(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const urls = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('http'));

  return urls.map((url) => ({
    code: '',
    name: extractCompanyName(url),
    url,
  }));
}

function loadUrls(filePath, overrideFormat) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`URL file not found: ${filePath}`);
  }

  const format = detectFormat(filePath, overrideFormat);

  if (format === 'json') {
    return loadUrlsFromJson(filePath);
  }
  if (format === 'csv') {
    return loadUrlsFromCsv(filePath);
  }
  if (format === 'txt') {
    return loadUrlsFromTxt(filePath);
  }

  throw new Error(`Unsupported URL file format: ${format}`);
}

module.exports = {
  detectFormat,
  detectCsvDelimiter,
  loadUrls,
  loadUrlsFromCsv,
  loadUrlsFromJson,
  loadUrlsFromTxt,
  extractCompanyName,
};
