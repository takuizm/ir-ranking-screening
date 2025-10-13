const fs = require('fs');
const path = require('path');

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSearch(search = {}) {
  return {
    ...search,
    selectors: ensureArray(search.selectors),
    formSelectors: ensureArray(search.formSelectors),
    iconSelectors: ensureArray(search.iconSelectors),
    modalSelectors: ensureArray(search.modalSelectors),
    inputSelectors: ensureArray(search.inputSelectors),
    triggerTexts: ensureArray(search.triggerTexts),
    specificPatterns: ensureArray(search.specificPatterns),
    hiddenIndicators: ensureArray(search.hiddenIndicators),
    excludeSelectors: ensureArray(search.excludeSelectors),
    submitSelectors: ensureArray(search.submitSelectors),
  };
}

function normalizeKeywords(keywords = {}) {
  const normalized = { ...keywords };
  normalized.search = normalizeSearch(keywords.search);
  return normalized;
}

function loadKeywords(customPath) {
  const configPath = customPath
    ? path.resolve(customPath)
    : path.join(process.cwd(), 'config', 'keywords.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `config/keywords.json が見つかりません。必ず調査用キーワードを定義したファイルを配置してください。（参照パス: ${configPath}）`,
    );
  }

  try {
    const fileContent = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(fileContent);
    return normalizeKeywords(parsed);
  } catch (error) {
    throw new Error(`config/keywords.json の読み込みに失敗しました: ${error.message}`);
  }
}

module.exports = {
  loadKeywords,
};
