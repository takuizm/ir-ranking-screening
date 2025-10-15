/**
 * 企業IR調査スクリプト - Full版（8項目、高精度・詳細調査）
 *
 * 検出項目：
 * 1. サイト内検索機能
 * 2. IR英語版サイト
 * 3. 社長メッセージ
 * 4. 社長の経歴
 * 5. 統合報告書PDF
 * 6. 財務情報グラフ
 * 7. 株主還元・優待
 * 8. サステナビリティメニュー
 *
 * 特徴：
 * - 全項目で404チェック実施
 * - リンク先に実際に遷移して内容確認
 * - 英語版URLを実際に遷移して検証
 * - 外部リンク除外（Cookiebot、SNS等）
 * - キーワード外部管理（config/keywords.json）
 * - 高精度（英語版88.9%、社長メッセージ88.9%、株主還元88.9%）
 *
 * 実行方法:
 * 1. npm install
 * 2. node src/index.js --mode full --file input/urls_test_9社.txt
 *
 * オプション:
 *   --file <ファイル名>     URLリストファイルを指定（デフォルト: urls.txt）
 *   --output <ファイル名>   出力ファイル名（デフォルト: 自動生成）
 *   --wait <ミリ秒>         追加待機時間（デフォルト: 3000）
 *
 * 例:
 *   node src/index.js --mode full --file input/irurls.txt
 *   npm run survey:full
 */

/* eslint-env node, browser */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const util = require('util');
const { loadUrls: loadUrlEntries } = require('./lib/url-loader');
const { loadKeywords } = require('./config/keywords');
const {
  evaluateFinancialText,
  evaluateShareholderContent,
  evaluateTopMessage,
  selectIntegratedReportLink,
} = require('./lib/spec-validators');

const INPUT_DIR = path.join(process.cwd(), 'input');
const OUTPUT_DIR = path.join(process.cwd(), 'output');
const LOG_DIR = path.join(process.cwd(), 'logs');

function ensureDirectoryExists(targetDir) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
}

ensureDirectoryExists(INPUT_DIR);
ensureDirectoryExists(OUTPUT_DIR);
ensureDirectoryExists(LOG_DIR);

const runStartedAt = new Date();
const previousYearThreshold = new Date(runStartedAt.getFullYear() - 1, 0, 1);
const financialDataMinYear = Math.max(runStartedAt.getFullYear() - 1, 2000);
const integratedReportMinYear = 2023;
const logFilename = `${runStartedAt.toISOString().replace(/[-:]/g, '').split('.')[0]}_ir-survey.log`;
const logFilePath = path.join(LOG_DIR, logFilename);
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
const DEFAULT_PROTOCOL_TIMEOUT = 45000;

function writeLog(level, args) {
  const timestamp = new Date().toISOString();
  const message = util.format(...args);
  logStream.write(`[${timestamp}] [${level}] ${message}\n`);
}

const originalConsoleLog = console.log.bind(console);
const originalConsoleWarn = console.warn.bind(console);
const originalConsoleError = console.error.bind(console);

console.log = (...args) => {
  writeLog('INFO', args);
  originalConsoleLog(...args);
};

console.warn = (...args) => {
  writeLog('WARN', args);
  originalConsoleWarn(...args);
};

console.error = (...args) => {
  writeLog('ERROR', args);
  originalConsoleError(...args);
};

process.once('exit', () => {
  logStream.end();
});

process.once('SIGINT', () => {
  logStream.end(() => process.exit(0));
});

process.once('SIGTERM', () => {
  logStream.end(() => process.exit(0));
});

function resolveInputFilePath(filePath) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  const normalized = path.normalize(filePath);
  if (normalized === 'input' || normalized.startsWith(`input${path.sep}`)) {
    return path.resolve(process.cwd(), normalized);
  }
  return path.resolve(INPUT_DIR, normalized);
}

function resolveOutputFilePath(filePath) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  const normalized = path.normalize(filePath);
  if (normalized === 'output' || normalized.startsWith(`output${path.sep}`)) {
    return path.resolve(process.cwd(), normalized);
  }
  return path.resolve(OUTPUT_DIR, normalized);
}

function ensureParentDirectory(targetPath) {
  const directory = path.dirname(targetPath);
  ensureDirectoryExists(directory);
}

function toDisplayPath(targetPath) {
  const relative = path.relative(process.cwd(), targetPath);
  if (!relative || relative.startsWith('..')) {
    return targetPath;
  }
  return relative;
}

function withFallback(value, fallback) {
  return Array.isArray(value) && value.length > 0 ? value : fallback;
}

function buildSearchConfig(searchKeywords = {}) {
  return {
    selectors: withFallback(searchKeywords.selectors, []),
    formSelectors: withFallback(searchKeywords.formSelectors, []),
    iconSelectors: withFallback(searchKeywords.iconSelectors, []),
    modalSelectors: withFallback(searchKeywords.modalSelectors, []),
    inputSelectors: withFallback(searchKeywords.inputSelectors, []),
    triggerTexts: withFallback(searchKeywords.triggerTexts, []),
    specificPatterns: withFallback(searchKeywords.specificPatterns, []),
    hiddenIndicators: withFallback(searchKeywords.hiddenIndicators, []),
    excludeSelectors: withFallback(searchKeywords.excludeSelectors, []),
    submitSelectors: withFallback(searchKeywords.submitSelectors, []),
  };
}

/**
 * コマンドライン引数の解析
 */
function buildOptionsFromArgs(argv = process.argv.slice(2)) {
  const options = {
    file: 'urls.txt',
    output: null,
    wait: 3000,
    mode: 'full',
    outputStyle: 'detailed',
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const current = argv[i];
    const next = argv[i + 1];

    if (current === '--file' && next) {
      options.file = next;
      i++;
    } else if (current.startsWith('--file=')) {
      options.file = current.split('=')[1];
    } else if (current === '--output' && next) {
      options.output = next;
      i++;
    } else if (current.startsWith('--output=')) {
      options.output = current.split('=')[1];
    } else if (current === '--wait' && next) {
      options.wait = parseInt(next, 10);
      i++;
    } else if (current.startsWith('--wait=')) {
      options.wait = parseInt(current.split('=')[1], 10);
    } else if ((current === '--mode' || current === '-m') && next) {
      options.mode = next;
      i++;
    } else if (current.startsWith('--mode=')) {
      options.mode = current.split('=')[1];
    } else if ((current === '--output-style' || current === '--output-format') && next) {
      options.outputStyle = next;
      i++;
    } else if (current.startsWith('--output-style=') || current.startsWith('--output-format=')) {
      options.outputStyle = current.split('=')[1];
    } else if (current === '--dry-run') {
      options.dryRun = true;
    }
  }

  return applyOptionDefaults(options);
}

function applyOptionDefaults(rawOptions) {
  const options = { ...rawOptions };

  if (options.mode === 'compact') {
    options.outputStyle = 'compact';
    options.mode = 'primary';
  }

  if (!options.output) {
    const now = new Date();
    const timestamp = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeLabel = `${now.getHours().toString().padStart(2, '0')}${now
      .getMinutes()
      .toString()
      .padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
    const modeLabel =
      options.outputStyle === 'compact'
        ? 'compact'
        : options.mode === 'primary'
            ? '一次予選'
            : options.mode === 'secondary'
              ? '二次予選'
              : '8項目完全版';
    const suffix = options.outputStyle === 'compact' ? 'summary' : 'details';
    const filename = `${timestamp}_${timeLabel}_IR調査結果_${modeLabel}_${suffix}.csv`;
    options.output = path.join('output', filename);
  }

  return { ...options, __normalized: true };
}

/**
 * リンク先をチェックする共通関数
 */
async function checkLinkDestination(page, url, contentCheckFunction, options = {}) {
  const { timeout = 10000, context = {} } = options;
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout,
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const check = await page.evaluate(
      (checkFnString, ctx) => {
        // 404チェック
        const is404 =
          document.title.includes('404') ||
          document.title.includes('Not Found') ||
          document.body.textContent.includes('404 Not Found') ||
          document.body.textContent.includes('ページが見つかりません') ||
          document.body.textContent.includes('ページが見つかりませんでした') ||
          document.querySelector('h1')?.textContent.includes('404');

        if (is404) {
          return { exists: false, is404: true, url: window.location.href };
        }

        try {
          // 内容チェック関数を実行
          const checkFn = eval(`(${checkFnString})`);
          const result = checkFn(ctx || {});
          if (typeof result === 'object' && result !== null) {
            const { exists, ...details } = result;
            return {
              exists: typeof exists === 'undefined' ? true : Boolean(exists),
              is404: false,
              url: window.location.href,
              details,
            };
          }
          return { exists: Boolean(result), is404: false, url: window.location.href };
        } catch (e) {
          return { exists: false, is404: false, url: window.location.href, error: e.message };
        }
      },
      contentCheckFunction.toString(),
      context,
    );

    return check;
  } catch (error) {
    console.log(`    ⚠️ アクセスエラー: ${error.message}`);
    return { exists: false, is404: true, url: url };
  }
}

function formatDateForLog(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function setItemNote(item, message) {
  if (!item) {
    return;
  }
  item.note = message || '';
}

function logHitUrl(label, url) {
  if (!url) {
    return;
  }
  console.log(`    ヒットURL(${label}): ${url}`);
}

function createSurveyItem(overrides = {}) {
  return {
    value: 0,
    hitUrl: '',
    note: '',
    detectedSelector: '',
    detectedElementType: '',
    ...overrides,
  };
}

function createDefaultItems() {
  return {
    hasSearch: createSurveyItem(),
    hasEnglish: createSurveyItem(),
    hasTopMessage: createSurveyItem(),
    hasProfile: createSurveyItem(),
    hasIntegratedReport: createSurveyItem(),
    hasFinancialGraph: createSurveyItem(),
    hasShareholderBenefit: createSurveyItem(),
    hasSustainabilityMenu: createSurveyItem(),
  };
}

function computeSummary(allResults = []) {
  return {
    hasSearch: allResults.filter((r) => r.items.hasSearch.value === 1).length,
    hasEnglish: allResults.filter((r) => r.items.hasEnglish.value === 1).length,
    hasTopMessage: allResults.filter((r) => r.items.hasTopMessage.value === 1).length,
    hasProfile: allResults.filter((r) => r.items.hasProfile.value === 1).length,
    hasIntegratedReport: allResults.filter((r) => r.items.hasIntegratedReport.value === 1).length,
    hasFinancialGraph: allResults.filter((r) => r.items.hasFinancialGraph.value === 1).length,
    hasShareholderBenefit: allResults.filter((r) => r.items.hasShareholderBenefit.value === 1).length,
    hasSustainabilityMenu: allResults.filter((r) => r.items.hasSustainabilityMenu.value === 1).length,
  };
}

function logSummary(allResults, summary) {
  const total = allResults.length || 1;
  console.log('\n検出サマリー:');
  console.log(
    `  サイト内検索: ${summary.hasSearch}/${allResults.length} (${((summary.hasSearch / total) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  英語版サイト: ${summary.hasEnglish}/${allResults.length} (${((summary.hasEnglish / total) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  社長メッセージ: ${summary.hasTopMessage}/${allResults.length} (${((summary.hasTopMessage / total) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  社長の経歴: ${summary.hasProfile}/${allResults.length} (${((summary.hasProfile / total) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  統合報告書: ${summary.hasIntegratedReport}/${allResults.length} (${((summary.hasIntegratedReport / total) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  財務グラフ: ${summary.hasFinancialGraph}/${allResults.length} (${((summary.hasFinancialGraph / total) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  株主還元・優待: ${summary.hasShareholderBenefit}/${allResults.length} (${((summary.hasShareholderBenefit / total) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  サステナビリティ: ${summary.hasSustainabilityMenu}/${allResults.length} (${((summary.hasSustainabilityMenu / total) * 100).toFixed(1)}%)`,
  );
  console.log('='.repeat(60));
}

function writeSurveyOutputs(options, allResults, urlEntries, encounteredError) {
  ensureParentDirectory(options.output);

  const csv =
    options.outputStyle === 'compact'
      ? generateCompactCsv(allResults, urlEntries)
      : generateCsv(allResults);
  fs.writeFileSync(options.output, csv, 'utf8');

  console.log('\n' + '='.repeat(60));
  console.log(encounteredError ? '調査完了（エラーあり）' : '調査完了');
  console.log('='.repeat(60));
  console.log(`出力ファイル: ${toDisplayPath(options.output)}`);
  console.log(`調査件数: ${allResults.length}件`);

  const summary = computeSummary(allResults);
  logSummary(allResults, summary);

  const errorCount = allResults.filter((r) => r.error).length;
  if (errorCount > 0) {
    console.log(`\n⚠️ エラー件数: ${errorCount}件`);
  }

  return summary;
}

/**
 * IRサイトを調査（8項目完全版）
 */
async function investigateIRSite(page, url, waitTime, keywords, mode = 'full') {
  const searchConfig = buildSearchConfig(keywords.search);
  const modalSelectorCandidates = searchConfig.modalSelectors;
  const inputSelectorCandidates = searchConfig.inputSelectors;
  const submitSelectorCandidates = searchConfig.submitSelectors;
  const advancedSearchConfig = {
    hiddenIndicatorTokens: searchConfig.hiddenIndicators,
    searchTextCandidates: searchConfig.triggerTexts,
    specificPatternList: searchConfig.specificPatterns,
    inputSelectors: searchConfig.inputSelectors,
  };

  const results = {
    url: url,
    actualUrl: '',
    items: createDefaultItems(),
    error: null,
    mode: mode, // 実行モードを記録
  };

  try {
    console.log(`\n調査中: ${url}`);

    // ステップ1: IRページにアクセス
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    // ステップ2: 動的待機（検索要素が表示されるまで待機）
    console.log(`  動的待機中... (最大${waitTime}ms)`);

    try {
      // 検索要素が表示されるまで待機（最大10秒）
      await page.waitForFunction(
        (searchSelectors) => {
          return searchSelectors.some((s) => document.querySelector(s) !== null);
        },
        {
          timeout: Math.max(waitTime, 10000),
          polling: 500, // 500ms間隔でチェック
        },
        searchConfig.selectors,
      );

      console.log(`  ✓ 検索要素を検出、動的待機完了`);
    } catch (error) {
      // タイムアウト時は固定待機にフォールバック
      console.log(`  ⚠️ 動的待機タイムアウト、固定待機にフォールバック (${waitTime}ms)`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    results.actualUrl = page.url();

    // ステップ3: 404チェック
    const is404 = await page.evaluate(() => {
      return (
        document.title.includes('404') ||
        document.title.includes('Not Found') ||
        document.body.textContent.includes('404 Not Found') ||
        document.body.textContent.includes('ページが見つかりません') ||
        document.querySelector('h1')?.textContent.includes('404')
      );
    });

    if (is404) {
      console.log(`  ⚠️ 404ページです`);
      return results; // 全項目0で返す
    }

    // ステップ4: 自動検出（項目1, 2, 8）とリンク取得
    console.log(`  自動検出実行中...`);

    // モード判定をpage.evaluateに渡す
    const detectMode = mode;

    const autoDetect = await page.evaluate(
      (kw, searchCfg, execMode) => {
        console.log('page.evaluate開始, execMode:', execMode);
        const result = {};

        // 変数を先に定義（スコープ問題を回避）
        const urlPatterns = kw.english.urlPatterns;
        const textPatterns = kw.english.textPatterns;
        const searchSelectors = searchCfg.selectors || [];
        const formSelectorCandidates = searchCfg.formSelectors || [];
        const iconSelectorList = searchCfg.iconSelectors || [];
        const excludePatterns = searchCfg.excludeSelectors || [];

        // 1. サイト内検索（二次予選モードではスキップ）
        if (execMode !== 'secondary') {
          console.log('検索要素検出開始');
          console.log('ページURL:', window.location.href);

          // シェアードリサーチ関連と外部サイトの除外パターン
          const currentDomain = window.location.hostname;

          // 同一ドメインかチェックする関数
          const isSameDomain = (href) => {
            try {
              if (href.startsWith('/')) {
                return true; // 相対パスは同一ドメイン
              }
              const url = new URL(href, window.location.origin);
              return url.hostname === currentDomain;
            } catch {
              return false; // URL解析エラーは除外
            }
          };

          // 改善された検索要素検出（可視性チェック付き）
          let foundSearchElement = null;
          for (const selector of searchSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              const rect = element.getBoundingClientRect();
              const style = window.getComputedStyle(element);
              const isVisible =
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0';

              console.log(`セレクタ: ${selector}, 要素:`, element);
              console.log(`可視性:`, {
                rect: { width: rect.width, height: rect.height },
                style: {
                  display: style.display,
                  visibility: style.visibility,
                  opacity: style.opacity,
                },
                isVisible: isVisible,
              });

              // シェアードリサーチ関連と外部サイトの除外チェック
              let isExcluded = false;
              for (const excludePattern of excludePatterns) {
                if (element.matches(excludePattern)) {
                  isExcluded = true;
                  console.log(`✗ シェアードリサーチ関連要素を除外: ${excludePattern}`);
                  break;
                }
              }

              // リンク要素の場合は同一ドメインかチェック
              if (!isExcluded && element.matches('a[href*="search"]')) {
                if (!isSameDomain(element.href)) {
                  isExcluded = true;
                  console.log(`✗ 外部サイトへのリンクを除外: ${element.href}`);
                }
              }

              if (isVisible && !isExcluded) {
                foundSearchElement = selector;
                console.log(`✓ 検索要素検出: ${selector}`);
                console.log(`  要素詳細:`, {
                  tagName: element.tagName,
                  id: element.id,
                  className: element.className,
                  name: element.name,
                  type: element.type,
                  placeholder: element.placeholder,
                  src: element.src,
                  alt: element.alt,
                  href: element.href,
                  action: element.action,
                  method: element.method,
                  value: element.value,
                  'aria-label': element.getAttribute('aria-label'),
                  title: element.title,
                });
                break;
              } else if (isExcluded) {
                console.log(`✗ シェアードリサーチ関連要素のため除外: ${selector}`);
              } else {
                console.log(`✗ 検索要素非表示: ${selector}`);
              }
            } else {
              console.log(`✗ 検索要素なし: ${selector}`);
            }
          }

          result.hasSearch =
            foundSearchElement !== undefined &&
            foundSearchElement !== null &&
            foundSearchElement !== '';

          // フォーム要素の検出強化
          console.log('フォーム要素検出開始');

          let foundForm = false;
          for (const formSelector of formSelectorCandidates) {
            const form = document.querySelector(formSelector);
            if (form) {
              const searchInputs = form.querySelectorAll(
                'input[name="q"], input[type="text"], input[type="image"], input[type="search"]',
              );
              console.log(`フォーム検出: ${formSelector}, 検索入力要素数: ${searchInputs.length}`);

              if (searchInputs.length > 0) {
                // フォーム内の検索入力要素の可視性をチェック
                let hasVisibleInput = false;
                for (const input of searchInputs) {
                  const rect = input.getBoundingClientRect();
                  const style = window.getComputedStyle(input);
                  const isVisible =
                    rect.width > 0 &&
                    rect.height > 0 &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0';

                  console.log(`フォーム内入力要素:`, {
                    tagName: input.tagName,
                    name: input.name,
                    type: input.type,
                    placeholder: input.placeholder,
                    isVisible: isVisible,
                  });

                  if (isVisible) {
                    hasVisibleInput = true;
                    break;
                  }
                }

                if (hasVisibleInput) {
                  foundForm = true;
                  console.log(`✓ フォーム要素検出: ${formSelector}`);
                  break;
                }
              }
            }
          }

          result.hasSearch = result.hasSearch || foundForm;

          // 検索アイコンを検出（クリック可能な要素）
          console.log('検索アイコン検出開始');

          let foundIconElement = null;
          for (const iconSelector of iconSelectorList) {
            const element = document.querySelector(iconSelector);
            if (element) {
              const rect = element.getBoundingClientRect();
              const style = window.getComputedStyle(element);
              const isVisible =
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0';

              console.log(`アイコンセレクタ: ${iconSelector}, 要素:`, element);
              console.log(`アイコン可視性:`, {
                rect: { width: rect.width, height: rect.height },
                style: {
                  display: style.display,
                  visibility: style.visibility,
                  opacity: style.opacity,
                },
                isVisible: isVisible,
              });

              // シェアードリサーチ関連と外部サイトの除外チェック
              let isExcluded = false;
              for (const excludePattern of excludePatterns) {
                if (element.matches(excludePattern)) {
                  isExcluded = true;
                  console.log(`✗ シェアードリサーチ関連アイコンを除外: ${excludePattern}`);
                  break;
                }
              }

              // リンク要素の場合は同一ドメインかチェック
              if (!isExcluded && element.matches('a[href*="search"]')) {
                if (!isSameDomain(element.href)) {
                  isExcluded = true;
                  console.log(`✗ 外部サイトへのリンクを除外: ${element.href}`);
                }
              }

              if (isVisible && !isExcluded) {
                foundIconElement = iconSelector;
                console.log(`✓ 検索アイコン検出: ${iconSelector}`);
                console.log(`  アイコン要素詳細:`, {
                  tagName: element.tagName,
                  id: element.id,
                  className: element.className,
                  name: element.name,
                  type: element.type,
                  placeholder: element.placeholder,
                  src: element.src,
                  alt: element.alt,
                  href: element.href,
                  action: element.action,
                  method: element.method,
                  value: element.value,
                  'aria-label': element.getAttribute('aria-label'),
                  title: element.title,
                });
                break;
              } else if (isExcluded) {
                console.log(`✗ シェアードリサーチ関連アイコンのため除外: ${iconSelector}`);
              } else {
                console.log(`✗ 検索アイコン非表示: ${iconSelector}`);
              }
            } else {
              console.log(`✗ 検索アイコンなし: ${iconSelector}`);
            }
          }

          result.hasSearchIcon =
            foundIconElement !== undefined && foundIconElement !== null && foundIconElement !== '';
          result.searchIconSelector = foundIconElement || '';

          // 検索要素または検索アイコンのいずれかが存在すれば検索機能あり
          result.hasSearch = result.hasSearch || result.hasSearchIcon;

          // 検出されたセレクタを記録
          result.detectedSelector = foundSearchElement || foundIconElement || '';
          result.detectedElementType = foundSearchElement
            ? 'search-element'
            : foundIconElement
              ? 'search-icon'
              : 'none';

          console.log('検索要素検出結果:', {
            hasSearch: result.hasSearch,
            hasSearchIcon: result.hasSearchIcon,
            searchIconSelector: result.searchIconSelector,
            detectedSelector: result.detectedSelector,
            detectedElementType: result.detectedElementType,
            foundSearchElement: foundSearchElement,
            foundIconElement: foundIconElement,
          });

          // デバッグ情報を結果に含める
          result.debug = {
            execMode: execMode,
            foundSearchElement: foundSearchElement,
            foundIconElement: foundIconElement,
            hasSearch: result.hasSearch,
            hasSearchIcon: result.hasSearchIcon,
          };
        } else {
          result.hasSearch = false; // 二次予選では検出しない
          result.hasSearchIcon = false;
          result.searchIconSelector = '';
        }

        // 2. 英語版サイト（二次予選モードではスキップ）
        if (execMode !== 'secondary') {
          const hasUrl = urlPatterns.some((s) => document.querySelector(s) !== null);
          const hasText = Array.from(document.querySelectorAll('a')).some((link) =>
            textPatterns.includes(link.textContent.trim().toUpperCase()),
          );
          result.hasEnglish = hasUrl || hasText;
        } else {
          result.hasEnglish = false; // 二次予選では検出しない
        }

        // 2の続き: 英語版リンクのURLを取得（キーワード設定使用）
        if (result.hasEnglish) {
          const currentDomain = window.location.hostname;
          const excludeDomains = kw.english.excludeDomains;

          // URLパターンで検出された場合
          const englishLinksByUrl = Array.from(document.querySelectorAll(urlPatterns.join(', ')));

          // テキストパターンで検出された場合
          const englishLinksByText = Array.from(document.querySelectorAll('a')).filter((link) =>
            textPatterns.includes(link.textContent.trim().toUpperCase()),
          );

          const allEnglishLinks = [...englishLinksByUrl, ...englishLinksByText];

          // フィルタリング: 外部ドメイン、アンカーリンク、特定の除外URLを除外
          const validEnglishLink = allEnglishLinks.find((link) => {
            const href = link.href;
            const linkDomain = new URL(href).hostname;

            // 除外条件
            const isSameDomainOrSubdomain =
              linkDomain === currentDomain ||
              linkDomain.endsWith('.' + currentDomain) ||
              currentDomain.endsWith('.' + linkDomain);
            const isNotAnchorOnly = !href.endsWith('#');
            const isNotExcludedDomain = excludeDomains.every((domain) => !href.includes(domain));

            return isSameDomainOrSubdomain && isNotAnchorOnly && isNotExcludedDomain;
          });

          result.englishUrl = validEnglishLink ? validEnglishLink.href : '';
        }

        // 8. サステナビリティメニュー（キーワード設定使用）
        const sustainabilityPatterns = kw.sustainability.menuKeywords || [];
        const sustainabilitySelectorList = kw.sustainability.selectors || [];
        const sustainabilitySelectors = sustainabilitySelectorList.join(', ');

        const isVisible = (element) => {
          if (!element) {
            return false;
          }
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const opacity = parseFloat(style.opacity || '1');
          if (!rect || !style) {
            return false;
          }
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            opacity > 0
          );
        };

        const isTopLevelMenu = (element) => {
          let depth = 0;
          let current = element.parentElement;
          while (current && current !== document.body) {
            if (
              current.matches('ul, ol, menu') ||
              current.getAttribute('role') === 'menu' ||
              current.getAttribute('role') === 'menubar'
            ) {
              depth += 1;
            }
            if (current.matches('nav, header')) {
              break;
            }
            current = current.parentElement;
          }
          return depth <= 1;
        };

        let sustainabilityLink = null;
        if (sustainabilitySelectors.trim() !== '') {
          const navLinks = Array.from(document.querySelectorAll(sustainabilitySelectors));
          sustainabilityLink = navLinks.find((link) => {
            const text = (link.textContent || '').trim();
            const matchesKeyword = sustainabilityPatterns.some((pattern) => text.includes(pattern));
            if (!matchesKeyword) {
              return false;
            }
            if (!isVisible(link)) {
              return false;
            }
            return isTopLevelMenu(link);
          });
        }

        result.hasSustainability = Boolean(sustainabilityLink);
        if (sustainabilityLink) {
          result.sustainabilityUrl = sustainabilityLink.href || '';
        }

        // リンク取得（キーワード設定使用）
        result.links = {};
        const domain = window.location.hostname;

        Array.from(document.querySelectorAll('a')).forEach((a) => {
          const text = a.textContent.trim();
          const href = a.href;

          // 社長メッセージ（キーワード設定から取得）
          if (!result.links.topMessage) {
            const matchesText = kw.topMessage.textPatterns.some((p) => text.includes(p));
            const matchesUrl = kw.topMessage.urlPatterns.some((p) => href.includes(p));
            if ((matchesText || matchesUrl) && href.startsWith('http')) {
              result.links.topMessage = href;
            }
          }

          // 役員（社長の経歴）（キーワード設定から取得）
          if (!result.links.officer) {
            const matchesText = kw.officer.textPatterns.some((p) => text.includes(p));
            const matchesUrl = kw.officer.urlPatterns.some((p) => href.includes(p));
            if ((matchesText || matchesUrl) && href.startsWith('http') && !href.includes('#')) {
              result.links.officer = href;
            }
          }

          // IRライブラリ（キーワード設定から取得）
          if (!result.links.library) {
            const matchesText = kw.integratedReport.textPatterns.some((p) => text.includes(p));
            const matchesUrl = kw.integratedReport.urlPatterns.some((p) => href.includes(p));
            if ((matchesText || matchesUrl) && href.startsWith('http') && href.includes(domain)) {
              result.links.library = href;
            }
          }

          // 財務ハイライト（キーワード設定から取得）
          if (!result.links.financial) {
            const matchesText = kw.financial.textPatterns.some((p) => text.includes(p));
            const matchesUrl = kw.financial.urlPatterns.some((p) => href.includes(p));
            if ((matchesText || matchesUrl) && href.startsWith('http') && href.includes(domain)) {
              result.links.financial = href;
            }
          }

          // 株式情報・株主還元・優待（キーワード設定から取得）
          if (!result.links.stock) {
            const matchesText = kw.stock.textPatterns.some((p) => text.includes(p));
            const matchesUrl = kw.stock.urlPatterns.some((p) => href.includes(p));
            const notExcluded = kw.stock.excludeUrls.every((ex) => !href.includes(ex));
            const hrefLower = href.toLowerCase();
            const isPdf = hrefLower.includes('.pdf');
            if (
              (matchesText || matchesUrl) &&
              href.startsWith('http') &&
              href.includes(domain) &&
              notExcluded &&
              !isPdf
            ) {
              result.links.stock = href;
            }
          }
        });

        return result;
      },
      keywords,
      searchConfig,
      detectMode,
    );

    // ステップ5: 項目1, 8の結果を記録
    console.log('autoDetect結果:', {
      hasSearch: autoDetect.hasSearch,
      hasSearchIcon: autoDetect.hasSearchIcon,
      detectedSelector: autoDetect.detectedSelector,
      detectedElementType: autoDetect.detectedElementType,
      debug: autoDetect.debug,
    });

    if (autoDetect.hasSearch) {
      results.items.hasSearch.value = 1;
      results.items.hasSearch.hitUrl = results.actualUrl;
      results.items.hasSearch.detectedSelector = autoDetect.detectedSelector || '';
      results.items.hasSearch.detectedElementType = autoDetect.detectedElementType || '';

      if (autoDetect.hasSearchIcon) {
        console.log(`  ✓ サイト内検索: 検索アイコン検出 (${autoDetect.searchIconSelector})`);
        const iconSelector =
          autoDetect.searchIconSelector && autoDetect.searchIconSelector.trim().length > 0
            ? `サイト内検索: 検索アイコン検出 (${autoDetect.searchIconSelector})`
            : 'サイト内検索: 検索アイコン検出';
        setItemNote(results.items.hasSearch, iconSelector);

        // 検索アイコンをクリックしてモーダル/ドロワーを開く
        if (autoDetect.searchIconSelector && autoDetect.searchIconSelector.trim() !== '') {
          try {
            console.log(`  検索アイコンクリック中...`);
            await page.click(autoDetect.searchIconSelector);
            await new Promise((resolve) => setTimeout(resolve, 1000)); // モーダル表示待機

            // モーダル/ドロワー内の検索入力欄を確認
            const modalSearchInput = await page.evaluate(
              (selectors) => selectors.some((s) => document.querySelector(s) !== null),
              modalSelectorCandidates,
            );

            if (modalSearchInput) {
              console.log(`  ✓ モーダル内検索入力欄: 検出`);
              results.items.hasSearch.hitUrl = page.url();
              setItemNote(
                results.items.hasSearch,
                'サイト内検索: 検索アイコン検出（モーダル内入力欄あり）',
              );
              logHitUrl('サイト内検索', results.items.hasSearch.hitUrl);
            } else {
              console.log(`  ⚠️ モーダル内検索入力欄: 未検出`);
            }
          } catch (error) {
            console.log(`  ⚠️ 検索アイコンクリックエラー: ${error.message}`);
          }
        } else {
          console.log(`  ⚠️ 検索アイコンセレクタが空のためクリックをスキップ`);
        }
      } else {
        console.log(`  ✓ サイト内検索: 検出`);
        setItemNote(results.items.hasSearch, 'サイト内検索: 検出');
        logHitUrl('サイト内検索', results.items.hasSearch.hitUrl || results.actualUrl);
      }
    } else {
      // 高度な検索機能検出を試行（検出ロジックの順序改善）
      console.log(`  高度な検索機能検出を試行中...`);
      console.log(`  autoDetect.hasSearch: ${autoDetect.hasSearch}`);
      console.log(`  autoDetect.hasSearchIcon: ${autoDetect.hasSearchIcon}`);
      console.log(`  autoDetect.detectedSelector: ${autoDetect.detectedSelector}`);
      console.log(`  autoDetect.detectedElementType: ${autoDetect.detectedElementType}`);

      const advancedSearchResult = await page.evaluate((config) => {
        console.log('高度な検索機能検出開始');

        const { hiddenIndicatorTokens, searchTextCandidates, specificPatternList, inputSelectors } =
          config;

        // 1. Shadow DOM 内の検索要素
        console.log('ステップ1: Shadow DOM内の検索要素');
        const shadowHosts = document.querySelectorAll('*');
        for (const host of shadowHosts) {
          if (host.shadowRoot) {
            const shadowSearch = host.shadowRoot.querySelectorAll(inputSelectors.join(', '));
            if (shadowSearch.length > 0) {
              console.log(`✓ Shadow DOM検索要素検出: ${shadowSearch.length}件`);
              return { found: true, type: 'shadow-dom', count: shadowSearch.length };
            }
          }
        }

        // 2. 非表示要素の検索
        console.log('ステップ2: 非表示要素の検索');
        const allInputs = document.querySelectorAll('input');
        for (const input of allInputs) {
          const style = window.getComputedStyle(input);
          const isHidden =
            style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';

          const textBucket = [
            input.className || '',
            input.placeholder || '',
            input.getAttribute('aria-label') || '',
            input.id || '',
          ]
            .join(' ')
            .toLowerCase();

          const matchesHiddenIndicator = hiddenIndicatorTokens.some((token) =>
            textBucket.includes(token.toLowerCase()),
          );

          if (isHidden && matchesHiddenIndicator) {
            console.log(`✓ 非表示検索要素検出:`, input);
            return { found: true, type: 'hidden-element', count: 1 };
          }
        }

        // 3. 検索関連テキストを含むクリック要素
        console.log('ステップ3: 検索関連テキストを含むクリック可能要素');
        const clickableElements = [];
        const allElements = Array.from(document.querySelectorAll('*'));
        searchTextCandidates.forEach((text) => {
          const keyword = text.toLowerCase();
          allElements.forEach((el) => {
            const elementText = (
              el.textContent +
              ' ' +
              el.className +
              ' ' +
              (el.getAttribute('aria-label') || '') +
              ' ' +
              (el.title || '')
            ).toLowerCase();

            if (
              elementText.includes(keyword) &&
              (el.tagName === 'BUTTON' ||
                el.tagName === 'A' ||
                el.tagName === 'DIV' ||
                el.tagName === 'SPAN' ||
                el.tagName === 'LI')
            ) {
              const rect = el.getBoundingClientRect();
              const isVisible = rect.width > 0 && rect.height > 0;
              const elementStyle = window.getComputedStyle(el);

              if (isVisible && elementStyle.cursor === 'pointer') {
                clickableElements.push({
                  tagName: el.tagName,
                  className: el.className,
                  textContent: el.textContent,
                  'aria-label': el.getAttribute('aria-label'),
                  title: el.title,
                });
              }
            }
          });
        });

        // 4. 特定パターン
        console.log('ステップ4: 特定の検索パターン');
        specificPatternList.forEach((pattern) => {
          const elements = document.querySelectorAll(pattern);
          elements.forEach((el) => {
            const rect = el.getBoundingClientRect();
            const isVisible = rect.width > 0 && rect.height > 0;

            if (isVisible) {
              clickableElements.push({
                tagName: el.tagName,
                className: el.className,
                id: el.id,
                textContent: el.textContent,
                'aria-label': el.getAttribute('aria-label'),
                title: el.title,
                pattern,
              });
            }
          });
        });

        // 5. フォーム要素
        console.log('ステップ5: フォーム要素の詳細検索');
        const forms = document.querySelectorAll('form');
        for (const form of forms) {
          const formInputs = form.querySelectorAll('input');
          let hasSearchInput = false;

          for (const input of formInputs) {
            const inputName = input.name ? input.name.toLowerCase() : '';
            const inputId = input.id ? input.id.toLowerCase() : '';
            const inputClass = input.className ? input.className.toLowerCase() : '';
            const inputPlaceholder = input.placeholder ? input.placeholder.toLowerCase() : '';
            const inputType = input.type ? input.type.toLowerCase() : '';

            if (
              inputName.includes('search') ||
              inputName.includes('q') ||
              inputId.includes('search') ||
              inputClass.includes('search') ||
              inputPlaceholder.includes('search') ||
              inputPlaceholder.includes('検索') ||
              inputType === 'search'
            ) {
              hasSearchInput = true;
              console.log(`✓ フォーム内検索要素検出:`, {
                form,
                input,
                name: input.name,
                id: input.id,
                type: input.type,
                placeholder: input.placeholder,
              });
              break;
            }
          }

          if (hasSearchInput) {
            return { found: true, type: 'form-element', count: 1 };
          }
        }

        // 6. 画像ボタン
        console.log('ステップ6: 画像ボタンの検索');
        const imageButtons = document.querySelectorAll('input[type="image"]');
        for (const imgBtn of imageButtons) {
          const alt = imgBtn.alt ? imgBtn.alt.toLowerCase() : '';
          const src = imgBtn.src ? imgBtn.src.toLowerCase() : '';
          const value = imgBtn.value ? imgBtn.value.toLowerCase() : '';

          if (
            alt.includes('search') ||
            alt.includes('検索') ||
            src.includes('search') ||
            value.includes('search') ||
            value.includes('検索')
          ) {
            console.log(`✓ 画像検索ボタン検出:`, imgBtn);
            return { found: true, type: 'image-button', count: 1 };
          }
        }

        if (clickableElements.length > 0) {
          console.log(`✓ クリック可能要素検出: ${clickableElements.length}件`);
          return {
            found: true,
            type: 'clickable-element',
            count: clickableElements.length,
            elements: clickableElements,
          };
        }

        console.log('✗ 高度な検索機能: 未検出');
        return { found: false, type: 'none', count: 0 };
      }, advancedSearchConfig);

      if (advancedSearchResult.found) {
        console.log(
          `  ✓ 高度な検索機能: 検出 (${advancedSearchResult.type}, ${advancedSearchResult.count}件)`,
        );
        results.items.hasSearch.value = 1;
        results.items.hasSearch.hitUrl = results.actualUrl;
        results.items.hasSearch.detectedSelector = `advanced-${advancedSearchResult.type}`;
        results.items.hasSearch.detectedElementType = advancedSearchResult.type;
        setItemNote(
          results.items.hasSearch,
          `サイト内検索: 検出（高度検出: ${advancedSearchResult.type}）`,
        );
        logHitUrl('サイト内検索', results.items.hasSearch.hitUrl);

        // クリック可能要素が見つかった場合はクリックを試行
        if (
          advancedSearchResult.type === 'clickable-element' &&
          advancedSearchResult.elements.length > 0
        ) {
          try {
            console.log(`  検索要素クリック中...`);
            const firstElement = advancedSearchResult.elements[0];

            // より安全なセレクタ生成
            let selector;
            if (firstElement.pattern) {
              selector = firstElement.pattern;
            } else if (firstElement.id) {
              selector = `#${firstElement.id}`;
            } else if (firstElement.className) {
              selector = `${firstElement.tagName.toLowerCase()}.${firstElement.className.split(' ').join('.')}`;
            } else {
              selector = firstElement.tagName.toLowerCase();
            }

            console.log(`  セレクタ: ${selector}`);

            // 1. 検索ボタンをクリック
            await page.click(selector);
            await new Promise((resolve) => setTimeout(resolve, 2000)); // 待機時間を延長

            // 2. 検索入力欄が表示されたかチェック
            const searchInputAfterClick = await page.evaluate((selectors) => {
              for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                  const rect = element.getBoundingClientRect();
                  const style = window.getComputedStyle(element);
                  const isVisible =
                    rect.width > 0 &&
                    rect.height > 0 &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0';

                  if (isVisible) {
                    return {
                      found: true,
                      selector: selector,
                      element: {
                        tagName: element.tagName,
                        id: element.id,
                        name: element.name,
                        type: element.type,
                        placeholder: element.placeholder,
                        className: element.className,
                      },
                    };
                  }
                }
              }

              return { found: false };
            }, inputSelectorCandidates);

            if (searchInputAfterClick.found) {
              console.log(`  ✓ 検索入力欄: 検出 (${searchInputAfterClick.selector})`);

              // 3. 検索入力欄に文字列を入力
              try {
                console.log(`  検索文字列入力中...`);
                await page.type(searchInputAfterClick.selector, 'IR', { delay: 100 });
                await new Promise((resolve) => setTimeout(resolve, 500));

                // 4. 検索ボタンをクリック（送信）
                let searchButtonFound = false;
                for (const buttonSelector of submitSelectorCandidates) {
                  try {
                    const button = await page.$(buttonSelector);
                    if (button) {
                      const isVisible = await page.evaluate((sel) => {
                        const element = document.querySelector(sel);
                        if (element) {
                          const rect = element.getBoundingClientRect();
                          const style = window.getComputedStyle(element);
                          return (
                            rect.width > 0 &&
                            rect.height > 0 &&
                            style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            style.opacity !== '0'
                          );
                        }
                        return false;
                      }, buttonSelector);

                      if (isVisible) {
                        console.log(`  検索ボタンクリック中... (${buttonSelector})`);
                        await button.click();
                        await new Promise((resolve) => setTimeout(resolve, 2000));
                        searchButtonFound = true;
                        break;
                      }
                    }
                  } catch (error) {
                    // ボタンが見つからない場合は無視
                  }
                }

                if (!searchButtonFound) {
                  // ボタンが見つからない場合はEnterキーで送信
                  console.log(`  Enterキーで検索実行...`);
                  await page.keyboard.press('Enter');
                  await new Promise((resolve) => setTimeout(resolve, 2000));
                }

                // 5. 検索結果ページかどうかチェック
                const currentUrl = page.url();
                const isSearchResult = await page.evaluate(() => {
                  // 検索結果の特徴をチェック
                  const searchIndicators = [
                    '検索結果',
                    'search results',
                    '検索',
                    'search',
                    'results',
                    '件',
                    '件数',
                    'count',
                  ];

                  const pageText = document.body.textContent.toLowerCase();
                  return searchIndicators.some((indicator) =>
                    pageText.includes(indicator.toLowerCase()),
                  );
                });

                if (isSearchResult) {
                  console.log(`  ✓ 検索機能: 動作確認済み`);
                  results.items.hasSearch.hitUrl = currentUrl;
                  setItemNote(results.items.hasSearch, 'サイト内検索: 検出（動作確認済み）');
                  logHitUrl('サイト内検索', results.items.hasSearch.hitUrl);
                } else {
                  console.log(`  ⚠️ 検索結果: 不明`);
                }
              } catch (error) {
                console.log(`  ⚠️ 検索文字列入力エラー: ${error.message}`);
              }
            } else {
              console.log(`  ⚠️ 検索入力欄: 未検出`);
            }
          } catch (error) {
            console.log(`  ⚠️ 検索要素クリックエラー: ${error.message}`);
          }
        }
      } else {
        console.log(`  ✗ サイト内検索: 未検出`);
        if (!results.items.hasSearch.note) {
          setItemNote(results.items.hasSearch, 'サイト内検索: 未検出');
        }
      }
    }

    if (autoDetect.hasSustainability) {
      results.items.hasSustainabilityMenu.value = 1;
      results.items.hasSustainabilityMenu.hitUrl =
        autoDetect.sustainabilityUrl || results.actualUrl;
      console.log(`  ✓ サステナビリティメニュー: 検出`);
      setItemNote(results.items.hasSustainabilityMenu, 'サステナビリティメニュー: 検出');
      logHitUrl('サステナビリティメニュー', results.items.hasSustainabilityMenu.hitUrl);
    } else {
      console.log(`  ✗ サステナビリティメニュー: 未検出`);
      setItemNote(results.items.hasSustainabilityMenu, 'サステナビリティメニュー: 未検出');
    }

    // ステップ5.5: 英語版サイトの確認（実際に遷移）
    if (autoDetect.hasEnglish && autoDetect.englishUrl) {
      console.log(`  英語版サイト確認中...`);

      const englishCheck = await checkLinkDestination(
        page,
        autoDetect.englishUrl,
        () => {
          // 英語版サイトであることを軽く確認
          // ページが正常に読み込まれればOK
          return true;
        },
        { timeout: 10000 },
      );

      if (!englishCheck.is404) {
        results.items.hasEnglish.value = 1;
        results.items.hasEnglish.hitUrl = englishCheck.url;
        console.log(`  ✓ 英語版サイト: 有（${englishCheck.url}）`);
        setItemNote(
          results.items.hasEnglish,
          `IR英語版サイト: 有（${englishCheck.url}）`,
        );
        logHitUrl('IR英語版サイト', englishCheck.url);
      } else {
        console.log(`  ✗ 英語版サイト: 404エラー`);
        setItemNote(results.items.hasEnglish, 'IR英語版サイト: 404エラー');
      }

      // IRページに戻る
      await page.goto(results.actualUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    } else if (autoDetect.hasEnglish) {
      // リンクURLが取得できなかったが英語版は検出された場合
      results.items.hasEnglish.value = 1;
      results.items.hasEnglish.hitUrl = results.actualUrl;
      console.log(`  ✓ 英語版サイト: 検出（URL取得失敗）`);
      setItemNote(results.items.hasEnglish, 'IR英語版サイト: 検出（URL取得失敗）');
    } else {
      console.log(`  ✗ 英語版サイト: 未検出`);
      setItemNote(results.items.hasEnglish, 'IR英語版サイト: 未検出');
    }

    // ステップ6: リンク先を確認（項目3-7）

    // モード判定: primaryモードの場合は項目3-8をスキップ
    if (mode === 'primary') {
      console.log(`  一次予選モード: 項目3-8をスキップ`);
      setItemNote(results.items.hasTopMessage, '社長メッセージ: 未調査（一次予選モード）');
      setItemNote(results.items.hasProfile, '社長の経歴: 未調査（一次予選モード）');
      setItemNote(results.items.hasIntegratedReport, '統合報告書: 未調査（一次予選モード）');
      setItemNote(results.items.hasFinancialGraph, '財務情報グラフ: 未調査（一次予選モード）');
      setItemNote(results.items.hasShareholderBenefit, '株主還元・優待: 未調査（一次予選モード）');
      setItemNote(results.items.hasSustainabilityMenu, 'サステナビリティメニュー: 未調査（一次予選モード）');
      return results;
    }

    // 3. 社長メッセージ
    if (autoDetect.links.topMessage) {
      console.log(`  社長メッセージ確認中...`);
      const topMessageKeywords = Array.isArray(keywords.topMessage.contentKeywords)
        ? keywords.topMessage.contentKeywords
        : [];

      const messageCheck = await checkLinkDestination(page, autoDetect.links.topMessage, () => true);
      if (!messageCheck.is404) {
        const messageText = await page.evaluate(() => document.body.innerText || '');
        const evaluation = evaluateTopMessage(messageText, {
          keywords: topMessageKeywords,
          thresholdDate: previousYearThreshold,
          today: runStartedAt,
        });

        if (evaluation.isValid) {
          results.items.hasTopMessage.value = 1;
          results.items.hasTopMessage.hitUrl = messageCheck.url;
          const formattedDate = evaluation.recentDate ? formatDateForLog(evaluation.recentDate) : '';
          if (formattedDate) {
            console.log(`  ✓ 社長メッセージ: 有（日付 ${formattedDate}）`);
            setItemNote(
              results.items.hasTopMessage,
              `社長メッセージ: 有（日付 ${formattedDate}）`,
            );
          } else {
            console.log(`  ✓ 社長メッセージ: 有`);
            setItemNote(results.items.hasTopMessage, '社長メッセージ: 有');
          }
          logHitUrl('社長メッセージ', messageCheck.url);
        } else if (!evaluation.hasKeyword) {
          console.log(`  ✗ 社長メッセージ: キーワード未検出`);
          setItemNote(results.items.hasTopMessage, '社長メッセージ: キーワード未検出');
        } else {
          console.log(`  ✗ 社長メッセージ: 日付要件未達`);
          setItemNote(results.items.hasTopMessage, '社長メッセージ: 日付要件未達');
        }
      } else {
        console.log(`  ✗ 社長メッセージ: 404エラー`);
        setItemNote(results.items.hasTopMessage, '社長メッセージ: 404エラー');
      }
    } else {
      console.log(`  ✗ 社長メッセージ: リンク未検出`);
      setItemNote(results.items.hasTopMessage, '社長メッセージ: リンク未検出');
    }

    // 4. 社長の経歴
    if (autoDetect.links.officer) {
      console.log(`  社長経歴確認中...`);
      const profileCheck = await checkLinkDestination(
        page,
        autoDetect.links.officer,
        (ctx) => {
          const text = document.body.textContent || '';
          const careerKeywords = Array.isArray(ctx.careerKeywords) ? ctx.careerKeywords : [];
          const ceoKeywords = Array.isArray(ctx.ceoKeywords) ? ctx.ceoKeywords : [];

          const hasCareerKeyword = careerKeywords.some((keyword) => text.includes(keyword));
          const hasCEOInfo = ceoKeywords.some((keyword) => text.includes(keyword));

          return hasCareerKeyword || hasCEOInfo;
        },
        {
          context: {
            careerKeywords: keywords.profile.careerKeywords,
            ceoKeywords: keywords.profile.ceoKeywords,
          },
        },
      );
      if (profileCheck.exists && !profileCheck.is404) {
        results.items.hasProfile.value = 1;
        results.items.hasProfile.hitUrl = profileCheck.url;
        console.log(`  ✓ 社長経歴: 有`);
        setItemNote(results.items.hasProfile, '社長の経歴: 有');
        logHitUrl('社長の経歴', profileCheck.url);
      } else if (profileCheck.is404) {
        console.log(`  ✗ 社長経歴: 404エラー`);
        setItemNote(results.items.hasProfile, '社長の経歴: 404エラー');
      } else {
        console.log(`  ✗ 社長経歴: 内容なし`);
        setItemNote(results.items.hasProfile, '社長の経歴: 内容なし');
      }
    } else {
      console.log(`  ✗ 社長経歴: リンク未検出`);
      setItemNote(results.items.hasProfile, '社長の経歴: リンク未検出');
    }

    // 5. 統合報告書
    if (autoDetect.links.library) {
      console.log(`  統合報告書確認中...`);
      const reportCheck = await checkLinkDestination(page, autoDetect.links.library, () => true);
      if (!reportCheck.is404) {
        const reportAnchors = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a')).map((a) => ({
            href: a.href,
            text: (a.textContent || '').trim(),
          }));
        });

        const reportKeywords = [
          ...(Array.isArray(keywords.integratedReport.textPatterns)
            ? keywords.integratedReport.textPatterns
            : []),
          ...(Array.isArray(keywords.integratedReport.reportKeywords)
            ? keywords.integratedReport.reportKeywords
            : []),
        ];
        const pdfIndicators = Array.isArray(keywords.integratedReport.pdfIndicators)
          ? keywords.integratedReport.pdfIndicators
          : [];

        const selectedReport = selectIntegratedReportLink(reportAnchors, {
          minYear: integratedReportMinYear,
          keywords: reportKeywords,
          pdfIndicators,
        });

        if (selectedReport) {
          results.items.hasIntegratedReport.value = 1;
          results.items.hasIntegratedReport.hitUrl = selectedReport.href;
          console.log(
            `  ✓ 統合報告書: 有（${selectedReport.latestYear}年度相当）`,
          );
          setItemNote(
            results.items.hasIntegratedReport,
            `統合報告書: 有（${selectedReport.latestYear}年度相当）`,
          );
          logHitUrl('統合報告書', selectedReport.href);
        } else {
          console.log(`  ✗ 統合報告書: 2023年度以降のPDF未検出`);
          setItemNote(
            results.items.hasIntegratedReport,
            '統合報告書: 2023年度以降のPDF未検出',
          );
        }
      } else {
        console.log(`  ✗ 統合報告書: 404エラー`);
        setItemNote(results.items.hasIntegratedReport, '統合報告書: 404エラー');
      }
    } else {
      console.log(`  ✗ 統合報告書: リンク未検出`);
      setItemNote(results.items.hasIntegratedReport, '統合報告書: リンク未検出');
    }

    // 6. 財務グラフ
    if (autoDetect.links.financial) {
      console.log(`  財務グラフ確認中...`);
      const graphCheck = await checkLinkDestination(page, autoDetect.links.financial, () => true);
      if (!graphCheck.is404) {
        const graphDetails = await page.evaluate((ctx) => {
          const selectors = Array.isArray(ctx.selectors) ? ctx.selectors : [];
          const imageKeywords = Array.isArray(ctx.imageAltKeywords) ? ctx.imageAltKeywords : [];

          const hasCanvasOrSvg = selectors.some((selector) => document.querySelector(selector));
          const hasChartElement =
            document.querySelector(
              '[class*=\"chart\"], [class*=\"graph\"], [data-chart], [data-highcharts-chart]',
            ) !== null;

          const lowerKeywords = imageKeywords.map((keyword) => keyword.toLowerCase());
          const hasGraphImage = Array.from(document.querySelectorAll('img')).some((img) => {
            const alt = (img.alt || '').toLowerCase();
            const src = (img.src || '').toLowerCase();
            return lowerKeywords.some((keyword) => alt.includes(keyword) || src.includes(keyword));
          });

          const text = document.body.innerText || '';

          return {
            hasVisual: Boolean(hasCanvasOrSvg || hasChartElement || hasGraphImage),
            text,
          };
        }, {
          selectors: keywords.graph.selectors,
          imageAltKeywords: keywords.graph.imageAltKeywords,
        });

        const hasVisual = Boolean(graphDetails && graphDetails.hasVisual);
        const financialEvaluation = evaluateFinancialText(graphDetails ? graphDetails.text : '', {
          minYear: financialDataMinYear,
        });

        if (hasVisual && financialEvaluation.hasRecentYear) {
          results.items.hasFinancialGraph.value = 1;
          results.items.hasFinancialGraph.hitUrl = graphCheck.url;
          const yearLabel = financialEvaluation.latestYear
            ? `${financialEvaluation.latestYear}年度データ確認`
            : '最新年度データ確認';
          console.log(`  ✓ 財務グラフ: 有（${yearLabel}）`);
          setItemNote(
            results.items.hasFinancialGraph,
            `財務情報グラフ: 有（${yearLabel}）`,
          );
          logHitUrl('財務情報グラフ', graphCheck.url);
        } else if (!hasVisual) {
          console.log(`  ✗ 財務グラフ: グラフ要素未検出`);
          setItemNote(results.items.hasFinancialGraph, '財務情報グラフ: グラフ要素未検出');
        } else {
          console.log(`  ✗ 財務グラフ: 最新年度データ未検出`);
          setItemNote(results.items.hasFinancialGraph, '財務情報グラフ: 最新年度データ未検出');
        }
      } else {
        console.log(`  ✗ 財務グラフ: 404エラー`);
        setItemNote(results.items.hasFinancialGraph, '財務情報グラフ: 404エラー');
      }
    } else {
      console.log(`  ✗ 財務グラフ: リンク未検出`);
      setItemNote(results.items.hasFinancialGraph, '財務情報グラフ: リンク未検出');
    }

    // 7. 株主還元・優待
    if (autoDetect.links.stock) {
      console.log(`  株主還元・優待確認中...`);
      const stockCheck = await checkLinkDestination(page, autoDetect.links.stock, () => true);
      if (!stockCheck.is404) {
        const stockText = await page.evaluate(() => document.body.innerText || '');
        const shareholderEvaluation = evaluateShareholderContent(stockText, {
          primaryKeywords: Array.isArray(keywords.stock.primaryContentKeywords)
            ? keywords.stock.primaryContentKeywords
            : [],
          minimumTextLength:
            typeof keywords.stock.contentMinimumLength === 'number'
              ? keywords.stock.contentMinimumLength
              : 15,
        });

        if (shareholderEvaluation.isValid) {
          results.items.hasShareholderBenefit.value = 1;
          results.items.hasShareholderBenefit.hitUrl = stockCheck.url;
          if (shareholderEvaluation.matchedKeyword) {
            console.log(
              `  ✓ 株主還元・優待: 有（${shareholderEvaluation.matchedKeyword}）`,
            );
            setItemNote(
              results.items.hasShareholderBenefit,
              `株主還元・優待: 有（${shareholderEvaluation.matchedKeyword}）`,
            );
          } else {
            console.log(`  ✓ 株主還元・優待: 有`);
            setItemNote(results.items.hasShareholderBenefit, '株主還元・優待: 有');
          }
          logHitUrl('株主還元・優待', stockCheck.url);
        } else {
          console.log(`  ✗ 株主還元・優待: HTMLコンテンツ不足またはキーワード未検出`);
          setItemNote(
            results.items.hasShareholderBenefit,
            '株主還元・優待: HTMLコンテンツ不足またはキーワード未検出',
          );
        }
      } else {
        console.log(`  ✗ 株主還元・優待: 404エラー`);
        setItemNote(results.items.hasShareholderBenefit, '株主還元・優待: 404エラー');
      }
    } else {
      console.log(`  ✗ 株主還元・優待: リンク未検出`);
      setItemNote(results.items.hasShareholderBenefit, '株主還元・優待: リンク未検出');
    }

    // 次の調査のため、念のため元のIRページに戻る
    try {
      if (page.url() !== results.actualUrl) {
        await page.goto(results.actualUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      }
    } catch (e) {
      // 戻れなくても続行
    }
  } catch (error) {
    console.error(`  エラー: ${error.message}`);
    results.error = error.message;
    Object.values(results.items || {}).forEach((item) => {
      if (item && !item.note) {
        setItemNote(item, `調査エラー: ${error.message}`);
      }
    });
  }

  return results;
}

/**
 * CSV出力
 */
function generateCsv(allResults) {
  let csv = '対象URL,調査項目,Value,ヒットしたURL,検出セレクタ,検出要素タイプ,備考\n';

  allResults.forEach((result) => {
    const items = [
      { name: 'サイト内検索がある', data: result.items.hasSearch },
      { name: 'IR英語版サイトがある', data: result.items.hasEnglish },
      { name: '社長メッセージの掲載がある', data: result.items.hasTopMessage },
      { name: '社長の経歴の掲載がある', data: result.items.hasProfile },
      { name: '統合報告書(PDF)の掲載がある', data: result.items.hasIntegratedReport },
      { name: '財務情報をグラフで掲載している', data: result.items.hasFinancialGraph },
      {
        name: '株主還元もしくは株主優待について掲載がある',
        data: result.items.hasShareholderBenefit,
      },
      {
        name: 'グローバルメニューに「サステナビリティ」「ESG」「CSR」相当のメニューがある',
        data: result.items.hasSustainabilityMenu,
      },
    ];

    items.forEach((item) => {
      const detectedSelector = item.data.detectedSelector || '';
      const detectedElementType = item.data.detectedElementType || '';
      const note = escapeCsv(item.data.note || '');
      csv += `${result.url},${item.name},${item.data.value},${item.data.hitUrl},${detectedSelector},${detectedElementType},${note}\n`;
    });
  });

  return csv;
}

function escapeCsv(value) {
  if (value === undefined || value === null) {
    return '';
  }
  const str = String(value);
  if (/[,"\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function generateCompactCsv(allResults, urlEntries) {
  const hasCodeColumn = urlEntries.some((entry) => entry && entry.code);
  const headers = hasCodeColumn
    ? ['コード', '企業名', 'URL', '実際のURL', 'サイト内検索機能', '英語版サイト', '備考']
    : ['企業名', 'URL', '実際のURL', 'サイト内検索機能', '英語版サイト', '備考'];

  const lines = [headers.join(',')];

  allResults.forEach((result) => {
    const metadata = result.metadata || {};
    const note = result.error ? `エラー: ${result.error}` : '';
    const row = [];

    if (hasCodeColumn) {
      row.push(escapeCsv(metadata.code || ''));
    }

    row.push(escapeCsv(metadata.name || metadata.url || result.url || ''));
    row.push(escapeCsv(result.url || metadata.url || ''));
    row.push(escapeCsv(result.actualUrl || ''));
    row.push(result.items?.hasSearch?.value ?? 0);
    row.push(result.items?.hasEnglish?.value ?? 0);
    row.push(escapeCsv(note));

    lines.push(row.join(','));
  });

  return lines.join('\n');
}

/**
 * メイン処理
 */
async function runSurvey(rawOptions) {
  const options =
    rawOptions && typeof rawOptions === 'object'
      ? rawOptions.__normalized
        ? rawOptions
        : applyOptionDefaults(rawOptions)
      : buildOptionsFromArgs();

  const keywords = loadKeywords();

  console.log('='.repeat(60));
  const modeLabel =
    options.mode === 'primary'
      ? '一次予選モード（項目1,2）'
      : options.mode === 'secondary'
        ? '二次予選モード（項目3-8）'
        : '完全版（全8項目）';

  const resolvedFile = resolveInputFilePath(options.file);
  const resolvedOutput = resolveOutputFilePath(options.output);
  const displayInputPath = toDisplayPath(resolvedFile);
  const displayOutputPath = toDisplayPath(resolvedOutput);

  options.file = resolvedFile;
  options.output = resolvedOutput;

  console.log('企業IR調査スクリプト v5.0');
  console.log(`モード: ${modeLabel}`);
  console.log('='.repeat(60));
  console.log(`入力ファイル: ${displayInputPath}`);
  console.log(`出力ファイル: ${displayOutputPath}`);
  console.log(`ログファイル: ${toDisplayPath(logFilePath)}`);
  console.log(`待機時間: ${options.wait}ms`);
  if (options.outputStyle === 'compact') {
    console.log('出力形式: compact（Basic互換サマリー）');
  } else {
    console.log('出力形式: detailed（Full版CSV）');
  }
  if (options.dryRun) {
    console.log('モード: dry-run（実行なし）');
  }
  console.log('='.repeat(60));

  const urlEntries = loadUrlEntries(options.file);
  const urls = urlEntries.map((entry) => entry.url).filter(Boolean);

  console.log(`\n読み込んだURL数: ${urls.length}件\n`);

  if (urls.length === 0) {
    throw new Error('URLが見つかりませんでした');
  }

  if (options.dryRun) {
    console.log('Dry-run: URLリストと設定を確認しました。ブラウザ実行は行っていません。');
    return { options, results: [], urlEntries, summary: null };
  }

  const allResults = [];
  let consecutiveErrors = 0;
  let browser;
  let page;
  let encounteredError = null;
  let summary = null;

  try {
    const browserLaunchOptions = {
      headless: 'new',
      protocolTimeout: DEFAULT_PROTOCOL_TIMEOUT,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    };

    if (process.platform === 'darwin') {
      browserLaunchOptions.executablePath =
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    }

    browser = await puppeteer.launch(browserLaunchOptions);

    page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const entry = urlEntries[i] || { url, name: '', code: '' };

      try {
        const result = await investigateIRSite(page, url, options.wait, keywords, options.mode);
        result.metadata = entry;
        allResults.push(result);
        consecutiveErrors = 0;

        console.log(`\n進捗: ${i + 1}/${urls.length} 完了`);

        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`致命的エラー: ${url} - ${error.message}`);
        consecutiveErrors++;

        if (consecutiveErrors >= 3 && browser) {
          console.log('  ページを再作成します...');
          try {
            await page.close();
          } catch (closeError) {
            console.error(`  ページクローズ失敗: ${closeError.message}`);
          }
          try {
            page = await browser.newPage();
            await page.setUserAgent(
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            );
            consecutiveErrors = 0;
          } catch (newPageError) {
            console.error(`  新規ページ作成失敗: ${newPageError.message}`);
            encounteredError = encounteredError || newPageError;
            break;
          }
        }

        const errorResult = {
          url,
          actualUrl: '',
          items: createDefaultItems(),
          error: error.message,
          metadata: entry,
        };
        Object.values(errorResult.items).forEach((item) =>
          setItemNote(item, `調査エラー: ${error.message}`),
        );
        allResults.push(errorResult);
      }
    }
  } catch (error) {
    encounteredError = encounteredError || error;
    console.error(`\n⚠️ 調査処理中にエラーが発生しました: ${error.message}`);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error(`ブラウザ終了時のエラー: ${closeError.message}`);
        encounteredError = encounteredError || closeError;
      }
    }

    try {
      summary = writeSurveyOutputs(options, allResults, urlEntries, encounteredError);
    } catch (writeError) {
      console.error(`CSV出力中のエラー: ${writeError.message}`);
      encounteredError = encounteredError || writeError;
    }
  }

  if (encounteredError) {
    console.log(`⚠️ 未処理エラー: ${encounteredError.message}`);
    throw encounteredError;
  }

  return { options, results: allResults, urlEntries, summary };
}

module.exports = {
  runSurvey,
  buildOptionsFromArgs,
  applyOptionDefaults,
  generateCsv,
  generateCompactCsv,
};
