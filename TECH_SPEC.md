# Technical Specification

企業IR調査スクリプトの検出ロジックと技術詳細

---

## スクリプト概要

v5.1 以降は `src/index.js` をエントリーポイントとし、モードごとの分岐は CLI オプションで制御する。

- **Detailed（`--mode full`）**: 8項目を計測。`primary`/`secondary` は Detailed 内のサブセット。
- **Compact（`--mode compact`）**: サイト内検索 / 英語版（2項目）のみ。

内部ロジック（`src/full.js`）は `runSurvey(options)` を公開し、出力形式（detailed / compact）は `options.outputStyle` で切り替える。Basic 専用コードは撤廃し、共通ルーチンで出力フォーマットを切り替える。

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
対象URL,調査項目,Value,ヒットしたURL,検出セレクタ,検出要素タイプ
https://example.com/ir/,サイト内検索がある,1,https://example.com/ir/,input[type="search"],search-element
https://example.com/ir/,IR英語版サイトがある,1,https://example.com/en/,a[href*="/en/"],search-element
```

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
// メッセージ本文が存在するか
document.body.textContent.length > 500 &&
  (text.includes('社長') ||
    text.includes('代表') ||
    text.includes('株主の皆様') ||
    text.includes('投資家の皆様'));
```

#### 検出精度

**実測値**: 約88.9%（9社中8社で検出）

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
// 経歴キーワードまたは年号情報
text.includes('経歴') ||
  text.includes('略歴') ||
  text.includes('学歴') ||
  text.includes('職歴') ||
  (text.includes('代表取締役') && text.match(/昭和|平成|令和|19\d\d年|20\d\d年/));
```

#### 検出精度

**実測値**: 約44.4%（9社中4社で検出）

**未検出の主な理由**:

- 経歴情報を公開していない企業が多い
- 名前と役職のみの掲載

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

```javascript
// 統合報告書のキーワード
text.includes('統合報告書') ||
  text.includes('Integrated Report') ||
  text.includes('アニュアルレポート') ||
  text.includes('Annual Report') ||
  // PDFリンクの存在
  Array.from(document.querySelectorAll('a')).some(
    (a) =>
      (a.textContent.includes('統合報告書') || a.textContent.includes('Integrated')) &&
      (a.href.includes('.pdf') || a.textContent.includes('PDF')),
  );
```

#### 検出精度

**実測値**: 約33.3%（9社中3社で検出）

**未検出の主な理由**:

- 統合報告書を発行していない企業が多い
- 「事業報告書」のみ掲載

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
// canvas/svg要素
document.querySelector('canvas') ||
  document.querySelector('svg') ||
  // グラフテキスト
  text.match(/売上高.*百万円|営業利益.*百万円|当期純利益.*百万円/) ||
  // グラフ画像
  Array.from(document.querySelectorAll('img')).some(
    (img) => img.alt && (img.alt.includes('グラフ') || img.alt.includes('推移')),
  );
```

#### 検出精度

**実測値**: 約44.4%（9社中4社で検出）

**未検出の主な理由**:

- 表形式のみでグラフがない
- グラフがJavaScriptで遅延ロード

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

```javascript
text.includes('株主還元') ||
  text.includes('配当') ||
  text.includes('株主優待') ||
  text.includes('Dividend') ||
  text.includes('還元方針') ||
  text.includes('優待制度');
```

#### 検出精度

**実測値**: 約88.9%（9社中8社で検出）

---

### 8. サステナビリティメニューの検出仕様

#### 検出原理

グローバルナビゲーション（第1階層メニュー）にサステナビリティ関連のメニューが存在するかを検出

#### 検出対象要素

```javascript
セレクタ: -'header a' - 'nav a' - '.global-nav a' - '.header a' - '.gnav a';

キーワード: -'サステナビリティ' - 'Sustainability' - 'ESG' - 'CSR' - 'SDGs';
```

#### 判定基準

グローバルナビゲーション内のリンクテキストに上記キーワードが含まれる場合、Value=1

**注意**: 「企業情報」の下層ページにのみ存在する場合はValue=0

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
