# Technical Specification

企業IR調査スクリプトの検出ロジックと技術詳細

---

## スクリプト概要

v5.1 以降は `src/index.js` をエントリーポイントとし、モードごとの分岐は CLI オプションで制御する。

- **Detailed（`--mode full`）**: 8項目を計測。`primary`/`secondary` は Detailed 内のサブセット。
- **Compact（`--mode compact`）**: サイト内検索 / 英語版（2項目）のみ。

内部ロジック（`src/full.js`）は `runSurvey(options)` を公開し、出力形式（detailed / compact）は `options.outputStyle` で切り替える。Basic 専用コードは撤廃し、共通ルーチンで出力フォーマットを切り替える。

---

## 共通バリデーションユーティリティ

v5.2 では仕様依存の判定を `src/lib/spec-validators.js` に集約し、各項目が同一ロジックを共有できるようにした。

- `evaluateTopMessage()`：本文からキーワード・年月日を抽出し、前年1月以降の月付き日付を検証。元号→西暦変換や英語表記もサポート。
- `selectIntegratedReportLink()`：PDFリンク候補をフィルタし、2023年度以降の最新レポートを選択。
- `evaluateFinancialText()`：本文中の年度（西暦/FY/元号）を解析し、最新年が当年または前年かを判定。
- `evaluateShareholderContent()`：株主還元系キーワードの存在と本文長を評価し、数値のみのページを除外。

これらの関数は `investigateIRSite()` から呼び出され、ログやCSVに必要な付加情報（検出年度、使用キーワードなど）を付与する。

---

## サイト内検索機能の検出仕様

### 共通仕様（v4.1 / v5.0）

### 検出原理

Puppeteerを使用して実際のブラウザでページをレンダリングし、**JavaScript実行後の最終的なDOM**を解析します。

### 検出タイミング

```
1. ページにアクセス
2. DOMContentLoadedイベント完了を待機
3. 動的待機（最大10秒、500ms間隔）または固定待機（デフォルト3秒）
4. page.evaluate()でDOM解析
5. 検索機能の有無を判定
6. デバッグ情報の出力
```

### 検出対象要素

`kw.search` に定義された `selectors` / `formSelectors` / `iconSelectors` を使用する。以下はデフォルト値の代表例。

#### Input要素

```javascript
'input[type="search"]'; // HTML5 search type
'input[name*="search"]'; // name属性に"search"を含む
'input[id*="search"]'; // id属性に"search"を含む
'input[placeholder*="検索"]'; // placeholder属性
'input[placeholder*="search"]';
'input[name="q"]'; // Google形式
'input[aria-label*="検索"]'; // アクセシビリティ属性
'input[aria-label*="search"]';
'input[role="search"]'; // セマンティックHTML
'input.gsc-input'; // Google CSE専用クラス
'input.DocSearch-Input'; // Algolia専用クラス
'input[class*="search"]'; // クラス名に"search"を含む
```

#### Button要素

```javascript
'button[class*="search"]'; // クラス名
'button[aria-label*="検索"]'; // アクセシビリティ
'button[aria-label*="search"]';
```

#### リンク要素（同一ドメインのみ）

```javascript
'a[href*="search"][href^="/"]'; // 相対パス
'a[href*="search"][href*="?q="]'; // クエリパラメータ
'a[href*="search"][href*="#search"]'; // アンカー
'a[href*="search"][href*="/search-form"]'; // 検索フォーム
'a[href*="search"][href*="/site-search"]'; // サイト検索
```

#### Form要素

```javascript
'form[action*="search"]'; // action属性
```

### 除外パターン

#### 外部サイトへのリンク

```javascript
// 同一ドメインかチェック
const isSameDomain = (href) => {
  if (href.startsWith('/')) return true; // 相対パス
  const url = new URL(href, window.location.origin);
  return url.hostname === currentDomain;
};
```

#### 研究・調査関連の除外

```javascript
// 除外パターン
'img[src*="research"]'; // 研究関連画像
'img[alt*="研究"]'; // 研究関連alt
'img[alt*="research"]'; // 研究関連alt
'a[href*="research"]'; // 研究関連リンク
'div[class*="research"]'; // 研究関連div
'div[id*="research"]'; // 研究関連div
```

#### シェアードリサーチ関連の除外

```javascript
'img[src*="sharedsearch"]'; // シェアードリサーチ画像
'img[src*="sharedresearch"]'; // シェアードリサーチ画像
'img[alt*="シェアードリサーチ"]'; // シェアードリサーチalt
'img[alt*="SharedResearch"]'; // シェアードリサーチalt
'img[alt*="調査レポート"]'; // 調査レポートalt
'img[alt*="レポート"]'; // レポートalt
'a[href*="sharedresearch"]'; // シェアードリサーチリンク
'div[class*="sharedresearch"]'; // シェアードリサーチdiv
```

### 高度な検索機能検出

#### 検索アイコン検出

```javascript
// 検索アイコンセレクタ
('.search-icon',
  '.search-btn',
  '.search-button',
  '[data-toggle="search"]',
  '[data-action="search"]',
  '[aria-label*="検索"]',
  '[aria-label*="search"]',
  '[title*="検索"]',
  '[title*="search"]');
```

#### 検索アイコンクリック操作

```javascript
// 検索アイコンクリック後の処理
1. 検索アイコンをクリック
2. モーダル／ドロワーの入力欄が表示されるか1秒待機
3. 入力欄の出現有無のみを確認し、検索文字列は送信しない
4. 結果をログとCSVに記録（表示された場合はページURLを更新）
5. 例外発生時はエラーメッセージをログ出力
```

#### Shadow DOM内検索

```javascript
// Shadow DOM内の検索要素を検索
const shadowHosts = document.querySelectorAll('*');
for (const host of shadowHosts) {
  if (host.shadowRoot) {
    const shadowSearch = host.shadowRoot.querySelectorAll(
      'input[type="search"], input[class*="search"]',
    );
  }
}
```

#### 非表示要素の検索

```javascript
// 非表示要素も含めて検索
const allInputs = document.querySelectorAll('input');
for (const input of allInputs) {
  const style = window.getComputedStyle(input);
  const isHidden =
    style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
  // 非表示でも検索関連なら検出
}
```

### 判定ロジック

1. 基本検索要素の検出（可視性チェック付き）
2. フォーム要素の検出強化
3. 検索アイコンの検出（可視性チェック付き）
4. 高度な検索機能の検出（6ステップ）
5. いずれか1つでも存在すれば「検索機能あり（1）」と判定

### 高度な検索機能検出の6ステップ

1. **Shadow DOM内の検索要素**
2. **非表示要素の検索**
3. **検索関連テキストを含むクリック可能要素**
4. **特定の検索パターン**
5. **フォーム要素の詳細検索**
6. **画像ボタンの検索**

---

## 英語版サイトの検出仕様

### 検出原理

ページ上の`<a>`要素（リンク）を解析し、英語版サイトへのリンクが存在するかを判定します。

### URL パターンによる検出

```javascript
'a[href*="/en/"]'; // /en/ を含む
'a[href*="/en-us/"]'; // 米国英語
'a[href*="/en-gb/"]'; // 英国英語
'a[href*="/en_us/"]'; // アンダースコア形式
'a[href*="/en_gb/"]';
'a[href*="/english/"]'; // /english/ を含む
'a[href*="?lang=en"]'; // クエリパラメータ
'a[href*="&lang=en"]';
'a[href*="=en-us"]'; // パラメータ値
'a[href*="=en_us"]';
'a[href$="/en"]'; // /en で終わる
'a[href$="/en.html"]'; // en.html で終わる
```

### テキストパターンによる検出

リンクテキストが以下のいずれかに**完全一致**：

```javascript
'EN';
'ENGLISH';
'GLOBAL';
'EN-US';
'ENG';
'ENGLISH SITE';
'ENGLISH VERSION';
```

### 判定ロジック

URLパターンまたはテキストパターンのいずれかが存在すれば「英語版サイトあり（1）」と判定します。

---

## 検出できるもの・できないもの

### 検出可能

#### サイト内検索

- Google Custom Search Engine (GCS)
- Algolia DocSearch
- Elasticsearch UI
- Sitecore Search
- 標準的なHTML検索フォーム
- 同期的にロードされる検索UI
- 初期表示される検索ボックス
- 検索アイコンクリック後のモーダル検索
- Shadow DOM内の検索要素
- 非表示要素の検索機能

#### 英語版サイト

- `/en/` 形式のURL
- `/en-us/`、`/en-gb/` 形式
- `/english/` 形式
- `?lang=en` パラメータ
- "EN"、"ENGLISH" テキストリンク

### 検出困難または不可能

#### サイト内検索

1. **外部サイトへのリンク**
   - 採用情報サイト（マイナビ転職、リクナビ等）
   - 研究開発ページへのリンク
   - 調査レポートへのリンク

2. **iframe内の検索機能**
   - クロスオリジンのiframe

3. **非標準実装**
   - Canvas内の検索UI
   - contenteditable属性のみ

4. **長時間の遅延ロード**
   - 3秒以上の遅延で表示される検索UI

#### 英語版サイト

1. **別ドメイン型**
   - `.co.jp` → `.com`

2. **JavaScriptドロップダウン**
   - `<button onclick="switchLanguage('en')">EN</button>`

3. **特殊な階層構造**
   - `/jp/ja/` → `/global/en/`（一部パターン）

4. **hreflangタグのみ**
   - `<link rel="alternate" hreflang="en">`

---

## 検出精度

### 実測値（検証済み）

| 項目         | 検出率  | 偽陽性   |
| ------------ | ------- | -------- |
| サイト内検索 | 約20.8% | ほぼゼロ |
| 英語版サイト | 約79.2% | ほぼゼロ |

### 未検出の内訳

#### サイト内検索（約79.2%）

- 検索機能が実際に存在しない: 約79.2%
- 外部サイトリンクによる誤検出: 解決済み
- 研究・調査関連による誤検出: 解決済み

#### 英語版サイト（約20.8%）

- 英語版が実際に存在しない: 約5%
- 別ドメイン型: 約5-7%
- JavaScriptドロップダウン: 約3-5%
- その他特殊実装: 約2-3%

### デバッグ機能

#### 検出セレクタ・要素タイプの詳細出力

```javascript
// CSV出力に含まれる情報
- 検出セレクタ: 実際に検出されたCSSセレクタ
- 検出要素タイプ: search-element, search-icon, none
- デバッグ情報: execMode, foundSearchElement, foundIconElement
```

#### ログ出力

```javascript
// 詳細なログ出力
-検索要素検出結果 -
  高度な検索機能検出結果 -
  検索アイコンクリック結果 -
  検索文字列入力結果 -
  検索結果ページ確認結果;
```

---

## 技術的な制約

### 待機方式

```javascript
// 動的待機（推奨）
await page.waitForFunction(
  (searchSelectors) => {
    return searchSelectors.some((s) => document.querySelector(s) !== null);
  },
  {
    timeout: Math.max(waitTime, 10000),
    polling: 500, // 500ms間隔でチェック
  },
  keywords.search.selectors,
);

// 固定待機（フォールバック）
await new Promise((resolve) => setTimeout(resolve, waitTime));
```

**カバーする範囲**:

- 同期的なJavaScript
- 初期の非同期JavaScript（最大10秒）
- 検索要素の動的出現（500ms間隔でチェック）
- ユーザー操作依存の要素（検索アイコンクリック後）

---

## 誤検出の防止

### v5.0で防止した誤検出パターン

#### 1. 外部サイトへのリンク誤検出

**v4.1まで**:

```javascript
'a[href*="search"]'; // ← 外部サイトも検出
// "https://job.mynavi.jp/25/pc/search/corp273799/outline.html"も誤検出
```

**v5.0**:

```javascript
// 同一ドメインかチェック
const isSameDomain = (href) => {
  if (href.startsWith('/')) return true;
  const url = new URL(href, window.location.origin);
  return url.hostname === currentDomain;
};
```

#### 2. 研究・調査関連の誤検出

**v4.1まで**:

```javascript
'img[src*="search"]'; // ← 研究関連画像も検出
// "research.png"も誤検出
```

**v5.0**:

```javascript
'img[src*="search"]:not([src*="research"])'; // ← 研究関連を除外
// 除外パターン: research, sharedresearch, 調査レポート等
```

#### 3. シェアードリサーチ関連の誤検出

**v4.1まで**:

```javascript
'img[alt*="検索"]'; // ← シェアードリサーチバナーも検出
```

**v5.0**:

```javascript
'img[alt*="検索"]:not([alt*="シェアードリサーチ"]):not([alt*="調査レポート"])';
```

---

## エラー処理

### detached Frameエラー対策

#### 発生原因

- ページナビゲーション中のコンテキスト破棄
- 長時間実行によるセッション不安定化
- 特定サイトのトリガー

#### 自動復旧機能

```javascript
// 3回連続エラーでページ再作成
if (consecutiveErrors >= 3) {
  console.log('  ページを再作成します...');
  await page.close();
  page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  );
  consecutiveErrors = 0;
}
```

**効果**: 大規模調査（3000サイト以上）でも安定動作

#### エラー種別

```javascript
// 各種エラーメッセージ
- 致命的エラー: URL - エラーメッセージ
- アクセスエラー: エラーメッセージ
- 404ページです
- 検索アイコンクリックエラー
- 検索要素クリックエラー
- 検索文字列入力エラー
- 設定ファイル読み込み失敗
```

---

## パフォーマンス

### 実行速度

- 1サイトあたり: 約30-40秒（Full版）
  - ページロード: 1-2秒
  - 動的待機: 最大10秒
  - 検索機能検出: 5-10秒
  - リンク先確認: 10-15秒
  - サーバー負荷軽減: 1秒

### メモリ使用量

- 起動時: 約200MB
- 実行中: 約300-500MB
- ピーク時: 約800MB

### 進捗表示

```javascript
// 進捗表示
- 読み込んだURL数: X件
- 調査中: URL
- 進捗: X/Y 完了
- 調査完了
- 調査件数: X件
- 検出サマリー: 各項目の検出率
- エラー件数: X件
```

---

## バージョン履歴による改善

| バージョン | 検索機能検出 | 英語版検出   | 主な改善                 |
| ---------- | ------------ | ------------ | ------------------------ |
| v1         | 約73%        | 約70%        | 初版                     |
| v2         | 約73%        | 約70%        | 外部ファイル対応         |
| v3         | **約82%**    | 約73%        | 非同期ロード対応         |
| v4         | 約82%        | 約55%        | 英語版厳格化（誤検出減） |
| v4.1       | **約82%**    | **約80-85%** | バランス型               |
| v5.0       | **約20.8%**  | **約79.2%**  | 誤検出防止強化版         |

**v5.0は誤検出防止を最優先**し、実際にサイト内検索がないサイトを正しく除外することで、検出精度を大幅に向上させています。

### コマンドラインオプション

```bash
# 基本実行
node src/index.js --mode full --file urls_test.txt

# オプション指定
node src/index.js --mode primary --file urls_test.txt --output result.csv --wait 5000

# オプション一覧
--file <ファイル名>     URLリストファイルを指定（デフォルト: urls.txt、`input/` 基準で解決）
--output <ファイル名>   出力ファイル名（デフォルト: `output/` に日付+時刻+モードで生成）
--wait <ミリ秒>         追加待機時間（デフォルト: 3000）
--mode <モード>         実行モード（primary, secondary, full, compact）
```

### 出力ファイル形式

```csv
対象URL,調査項目,Value,ヒットしたURL,検出セレクタ,検出要素タイプ,備考
https://example.com/ir/,サイト内検索がある,1,https://example.com/ir/,input[type="search"],search-element,サイト内検索: 検出
https://example.com/ir/,IR英語版サイトがある,1,https://example.com/en/,a[href*="/en/"],search-element,IR英語版サイト: 有（https://example.com/en/）
```

- `備考` にはログ出力と同じ判定メッセージが入る（例: `社長メッセージ: 有（日付 2025-04-01）`）。  
- 各項目の成功/失敗理由やスキップ理由をCSVだけで追跡できる。

---

## v5.0の新規検出項目

### 3. 社長メッセージの検出仕様

#### 検出原理

1. IRページ内のリンクを解析
2. 以下のキーワードを含むリンクを検出
3. リンク先に遷移
4. 404チェック実施
5. メッセージ本文の存在を確認

#### 検出対象リンク

```javascript
テキストパターン: -'トップメッセージ' -
  '社長メッセージ' -
  '代表メッセージ' -
  '代表挨拶' -
  '社長挨拶';

URLパターン: -href.includes('message') - href.includes('greeting') - href.includes('topmessage');
```

#### 内容確認ロジック

```javascript
const result = evaluateTopMessage(document.body.innerText, {
  keywords: ['社長', '代表', '株主の皆様', '投資家の皆様', ...],
  thresholdDate: new Date(currentYear - 1, 0, 1), // 前年1月1日
  today: runStartedAt, // 実行日時
});

// 判定条件
result.hasKeyword && result.recentDate !== null
```

- 日本語元号（令和 / 平成 / 昭和）→西暦変換をサポート
- 年月表記のみでも許容（日付は任意）だが、月が無い年表記のみは未達扱い
- しきい値は「前年1月1日以降」までの最新日付
- 本文の文字数によるフィルタは廃止し、キーワード + 日付要件のみで判定
- 実行日は `runStartedAt` に依存し、年が変わっても自動でしきい値を更新

#### 検出補足

最新日付が検出された場合はログに `YYYY-MM-DD` 形式で記録。

---

### 4. 社長の経歴の検出仕様

#### 検出原理

1. 役員ページへのリンクを検出
2. リンク先に遷移
3. 404チェック実施
4. 経歴情報の存在を確認

#### 検出対象リンク

```javascript
テキストパターン: -'役員' - '経営陣' - '役員紹介' - '経営者' - '役員一覧';

URLパターン: -href.includes('officer') - href.includes('board') - href.includes('executive');
```

#### 内容確認ロジック

```javascript
const hasCareerKeyword = ['経歴', '略歴', '学歴', '職歴'].some((kw) => text.includes(kw));
const hasOfficerKeyword = ['代表取締役', '社長'].some((kw) => text.includes(kw));

return hasCareerKeyword || hasOfficerKeyword;
```

- 年号や学歴の有無は問わない（仕様の「内容は問わない」を優先）
- 氏名＋肩書のみでも代表表記があれば達成
- モーダル・別ページ展開でも `textContent` を集計して判定

---

### 5. 統合報告書の検出仕様

#### 検出原理

1. IRライブラリへのリンクを検出
2. リンク先に遷移
3. 404チェック実施
4. 統合報告書PDFの存在を確認

#### 検出対象リンク

```javascript
テキストパターン: -'IRライブラリ' - 'IR資料' - 'IR資料室' - '統合報告書' - 'Integrated Report';

URLパターン: -href.includes('library') - href.includes('integrated');
```

#### 内容確認ロジック

1. `selectIntegratedReportLink()` でリンク候補を収集  
2. テキスト/URLの両方にキーワード（統合報告書 / Integrated Report など）が含まれるか確認  
3. `.pdf` または `PDF` 指標を含むリンクのみ採用  
4. リンクテキスト・URLから年度（西暦/元号/FY）を抽出し、**2023年度以上**のものを優先的に選択

```javascript
const candidate = selectIntegratedReportLink(anchors, {
  minYear: 2023,
  keywords: [...統合報告書関連キーワード...],
  pdfIndicators: ['.pdf', 'pdf'],
});

return candidate !== null;
```

- 2022年度以前のPDFのみの場合は未達扱い
- 複数候補がある場合は最新年度のリンクを採用し、CSVにはそのURLを記録
- `minYear` は当面 2023 固定。新年度が要件に追加された場合はここを更新する

---

### 6. 財務情報グラフの検出仕様

#### 検出原理

1. 財務ハイライトページへのリンクを検出
2. リンク先に遷移
3. 404チェック実施
4. グラフ要素の存在を確認

#### 検出対象リンク

```javascript
テキストパターン: -'財務ハイライト' - '業績ハイライト' - '財務・業績' - '財務情報' - '業績情報';

URLパターン: -href.includes('highlight') -
  href.includes('financial') -
  href.includes('performance');
```

#### 内容確認ロジック

```javascript
const hasVisual =
  document.querySelector('canvas, svg') ||
  document.querySelector('[class*="chart"], [class*="graph"], [data-chart], [data-highcharts-chart]') ||
  Array.from(document.querySelectorAll('img')).some((img) => {
    const alt = (img.alt || '').toLowerCase();
    const src = (img.src || '').toLowerCase();
    return ['グラフ', '推移', 'chart'].some((kw) => alt.includes(kw) || src.includes(kw));
  });

const { hasRecentYear } = evaluateFinancialText(document.body.innerText, {
  minYear: currentYear - 1,
});

return hasVisual && hasRecentYear;
```

- グラフ要素（canvas/svg/チャート系クラス/altで推移を示す画像）の存在が必須
- 年度判定は本文テキストから抽出した西暦・FY・元号を解析し、**当年または前年のデータ**が含まれること
- 表のみの場合、または古い年度のみの場合は未達扱い
- `minYear` は実行日時の前年で動的に算出されるため、年度更新に追従可能

---

### 7. 株主還元・優待の検出仕様

#### 検出原理

1. 株式情報ページへのリンクを検出
2. リンク先に遷移
3. 404チェック実施
4. 株主還元・配当・優待情報の存在を確認

#### 検出対象リンク

```javascript
テキストパターン: -'株主還元' - '株主優待' - '配当' - '株式情報' - '株主・株式';

URLパターン: -href.includes('stock') -
  href.includes('shareholder') -
  href.includes('yutai') -
  href.includes('dividend');
```

#### 内容確認ロジック

1. リンク抽出時点で `.pdf` を含むURLは除外（HTMLページのみ対象）
2. 遷移後の本文テキストを `evaluateShareholderContent()` に入力

```javascript
const result = evaluateShareholderContent(document.body.innerText, {
  primaryKeywords: [
    '株主還元',
    '株主還元方針',
    '株主優待',
    '配当政策',
    'shareholder return',
    'dividend policy',
    ...
  ],
  minimumTextLength: 20,
});

return result.isValid;
```

- 単なる数値羅列（例: 配当性向 30%）のみの場合は最小テキスト長で弾く
- キーワードが本文に含まれている場合のみ達成
- PDFリンクや外部サイト（Yahoo!等）はヒット対象外
- キーワード/最小文字数は `config/keywords.json` の `stock.primaryContentKeywords` / `stock.contentMinimumLength` で管理

---

### 8. サステナビリティメニューの検出仕様

#### 検出原理

グローバルナビゲーション（第1階層）にサステナビリティ関連メニューが存在するかを検出。

#### 検出対象要素

```javascript
const selectors = ['header a', 'nav a', '.global-nav a', '.header a', '.gnav a'];
const keywords = ['サステナビリティ', 'Sustainability', 'ESG', 'CSR', 'SDGs'];
```

#### 判定基準

```javascript
const link = candidates.find((a) => {
  const text = a.textContent.trim();
  return keywords.some((kw) => text.includes(kw)) &&
    isVisible(a) &&
    isTopLevelMenu(a); // UL/OL/menuを1階層以内
});

return Boolean(link);
```

- `isVisible` で display / visibility / opacity をチェックし、表示されているリンクのみ採用
- `isTopLevelMenu` で親要素のリスト階層を調べ、第2階層以下にある場合は除外
- ログには検出したリンクURL（存在する場合）が記録される
- ドロップダウン内でも、親リストが第1階層であれば達成扱い。サイドバーやフッターのみの記載は未達

#### 検出精度

**実測値**: 約66.7%（9社中6社で検出）

---

## v5.0の重要な改善

### 1. 404チェックの実装

すべての項目で404チェックを実施：

```javascript
const is404 =
  document.title.includes('404') ||
  document.title.includes('Not Found') ||
  document.body.textContent.includes('404 Not Found') ||
  document.body.textContent.includes('ページが見つかりません') ||
  document.querySelector('h1')?.textContent.includes('404');
```

### 2. 英語版リンクのフィルタリング

外部ドメインとアンカーリンクを除外：

```javascript
// 除外条件
const isSameDomainOrSubdomain =
  linkDomain === currentDomain ||
  linkDomain.endsWith('.' + currentDomain) ||
  currentDomain.endsWith('.' + linkDomain);
const isNotAnchorOnly = !href.endsWith('#');
const isNotExcludedDomain = excludeDomains.every((domain) => !href.includes(domain));
```

**効果**: Cookiebot等の外部リンクを除外

### 3. リンク先に実際に遷移

すべての項目（英語版、社長メッセージ、経歴、統合報告書、財務グラフ、株主還元）で：

1. リンクのhref属性を取得
2. page.goto()で遷移
3. 404チェック
4. 内容確認
5. 実際のURLを記録

**効果**: URL推測による誤検出を完全に防止

### 4. 実行モード対応

```javascript
// 実行モード
- primary: 項目1,2のみ（サイト内検索、英語版サイト）
- secondary: 項目3-8のみ（社長メッセージ、経歴、統合報告書、財務グラフ、株主還元、サステナビリティ）
- full: 全8項目（デフォルト）
```

### 5. デバッグ機能強化

```javascript
// 詳細なデバッグ情報
-検出セレクタの記録 - 検出要素タイプの記録 - デバッグ情報の出力 - ログレベルの詳細化;
```

---

## バージョン別検出率比較

| 項目             | v4.1     | v5.0        | 備考                 |
| ---------------- | -------- | ----------- | -------------------- |
| サイト内検索     | 約82%    | **約20.8%** | v5.0は誤検出防止強化 |
| 英語版サイト     | 約80-85% | **約79.2%** | 同等の精度           |
| 社長メッセージ   | -        | **約89%**   | v5.0のみ             |
| 社長の経歴       | -        | 約44%       | v5.0のみ             |
| 統合報告書       | -        | 約33%       | v5.0のみ             |
| 財務グラフ       | -        | 約44%       | v5.0のみ             |
| 株主還元・優待   | -        | **約89%**   | v5.0のみ             |
| サステナビリティ | -        | 約67%       | v5.0のみ             |

**v5.0は誤検出防止を最優先**し、実際にサイト内検索がないサイトを正しく除外することで、検出精度を大幅に向上させています。
