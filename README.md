# 企業IR調査スクリプト

企業IRサイトを自動調査し、CSV形式で結果を出力する Node.js ベースの CLI ツールです。`src/index.js` から実行モードを切り替えて利用します。

## 実行モード

| モード              | 調査範囲                                | 想定用途                   | 備考                                                        |
| ------------------- | --------------------------------------- | -------------------------- | ----------------------------------------------------------- |
| `full` (デフォルト) | 8項目（サイト内検索〜サステナビリティ） | 詳細調査、納品用データ生成 | 404チェック・リンク先検証を実施                             |
| `primary`           | 項目1-2（サイト内検索 / 英語版）        | 一次予選や大量調査         | Detailed形式で出力                                          |
| `secondary`         | 項目3-8                                 | 二次予選・追加調査         | Detailed形式で出力                                          |
| `compact`           | 項目1-2                                 | Basic版相当サマリー        | Compact形式で出力 |

`compact` モードは 1サイト4-5秒程度、`full` モードは 1サイト30-40秒程度を目安としてください。

## 実行準備（共通）

1. **Node.js のインストール**  
   [Node.js 公式サイト](https://nodejs.org/) から推奨 LTS 版（18 以上）をダウンロード・インストールします。インストーラを進めるだけで `npm` も自動で導入されます。
2. **リポジトリの配置**  
   ZIP を展開するか Git で複製し、任意の場所にフォルダを置きます。フォルダ名は例として `ir-ranking-screening` を使用します。
3. **キーワード設定ファイルの確認（必須）**  
   `config/keywords.json` が存在するか確認します。削除・改名されている場合は実行できません。案件ごとの調整もこのファイルに集約します。
4. **入力ファイルの確認**  
   `input/` フォルダに調査対象 URL リストを入れます。最初からサンプル (`urls_sample.json` / `urls_sample.txt`) が同梱されています。

## macOS / Linux での実行手順

1. **ターミナルを開く**  
   Finder でフォルダを開き、右クリック →「ターミナルで開く」や `cd` コマンドで移動します。
   ```bash
   cd /path/to/ir-ranking-screening
   ```
2. **初回セットアップ**  
   ```bash
   npm install
   ```
   依存パッケージがダウンロードされます。完了まで数分かかる場合があります。
3. **サンプルで動作確認**  
   ```bash
   npm run survey:sample
   ```
   実行後に以下を確認してください。
   - `output/` に `YYYYMMDDHHMMSS_IR調査結果_...csv` が生成される
   - `logs/` に `YYYYMMDDHHMMSS_ir-survey.log` が生成される
4. **自分のリストで実行**  
   `input/` にコピーしたファイル名を指定してコマンドを実行します。
   ```bash
   node src/index.js --mode full --file your_file.json
   ```
   `--mode` を `primary` や `secondary` に変更すると対象項目を絞れます。

## Windows での実行手順

1. **Node.js のインストール**  
   [ダウンロードページ](https://nodejs.org/) から Windows 用インストーラを取得し、画面の指示に従ってインストールします。
2. **PowerShell / Windows Terminal を開く**  
   スタートメニューで「PowerShell」または「Windows Terminal」を検索して起動し、フォルダへ移動します。
   ```powershell
   cd C:\path\to\ir-ranking-screening
   ```
3. **初回セットアップ**  
   ```powershell
   npm install
   ```
4. **サンプルで動作確認**  
   ```powershell
   npm run survey:sample
   ```
   - 出力 CSV: `output\YYYYMMDDHHMMSS_IR調査結果_...csv`
   - 実行ログ: `logs\YYYYMMDDHHMMSS_ir-survey.log`
5. **独自リストで実行**  
   `input\` にファイルを置き、次のように指定します。
   ```powershell
   node src/index.js --mode full --file your_file.csv
   ```

> 💡 **Chrome を指定したい場合**  
> Puppeteer は同梱 Chromium を利用します。既存の Google Chrome を使いたい場合は、コマンド実行前に `PUPPETEER_EXECUTABLE_PATH` 環境変数を設定してください。

## よく使うコマンド

```bash
npm run survey:full        # 8項目の詳細調査
npm run survey:primary     # 項目1-2（一次予選）のみ
npm run survey:secondary   # 項目3-8（追加調査）のみ
npm start                  # compactモード（一次予選相当サマリー）
node src/index.js --mode compact --file urls_sample.txt --dry-run  # 実行前チェック
```

実行後、`output/` 配下に CSV ファイル（モードと実行時刻を含む命名）が生成され、同時に `logs/` 配下に実行ログが追記されます。

## 入力ファイル形式

入力ファイルはリポジトリ直下の `input/` ディレクトリに配置してください。相対パスで指定した場合は自動的に `input/` 基準で解決されます。

- **TXT** (推奨)
  ```txt
  https://www.example.com/ir/
  https://www.sample.co.jp/investor/
  ```
- **CSV**（列構成: `企業名,URL` または `code,企業名,URL`）
- **JSON**（`urls` 配列内に `{ code, name, url }` オブジェクトを列挙）

## CLIオプション

```bash
node src/index.js [options]

--file, --file=<path>            入力ファイル（デフォルト: urls.txt、`input/` を基準に解決）
--output, --output=<path>        出力先（未指定時は日付+モードで自動生成）
--wait, --wait=<ms>              追加待機時間（デフォルト: 3000）
--mode, -m <mode>                full / primary / secondary / compact
--output-style <style>           detailed / compact（compact 指定時は一次予選に自動変換）
--dry-run                        URLリストと設定の検証のみを実施（ブラウザ処理なし）
```

## 出力形式

### Detailed（full / primary / secondary）

```
対象URL,調査項目,Value,ヒットしたURL,検出セレクタ,検出要素タイプ
https://example.com/ir/,サイト内検索がある,1,https://example.com/ir/,
https://example.com/ir/,IR英語版サイトがある,1,https://example.com/en/
...
```

### Compact（compact / legacy Basic）

```
コード,企業名,URL,実際のURL,サイト内検索機能,英語版サイト,備考
1234,サンプル,https://example.com/,https://example.com/,1,1,
```

Compact形式は旧 Basic 版と互換性のあるヘッダー構成です。

## 設定ファイル（`config/keywords.json`）

キーワードやセレクタのチューニングは `config/keywords.json` で行います。このファイルは必須であり、存在しない場合は CLI がエラーで停止します。変更時は顧客環境へ反映し、リポジトリにもコミットしてください。

主なキーは以下の通りです。

| キー                  | 主なプロパティ                                                                                                                              | 用途                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `search`              | `selectors`, `formSelectors`, `iconSelectors`, `modalSelectors`, `triggerTexts`, `specificPatterns`, `hiddenIndicators`, `excludeSelectors` | サイト内検索UI検出と誤検出除外 |
| `english`             | `urlPatterns`, `textPatterns`, `excludeDomains`                                                                                             | 英語版リンク検出               |
| `topMessage`          | `textPatterns`, `urlPatterns`, `contentKeywords`, `minContentLength`                                                                        | 社長メッセージ確認             |
| `profile`             | `careerKeywords`, `yearPatterns`, `ceoKeywords`                                                                                             | 経歴情報確認                   |
| `integratedReport`    | `textPatterns`, `reportKeywords`, `pdfIndicators`                                                                                           | 統合報告書検出                 |
| `financial` / `graph` | `textPatterns`, `selectors`, `imageAltKeywords`                                                                                             | 財務グラフ検出                 |
| `stock`               | `textPatterns`, `urlPatterns`, `contentKeywords`, `excludeUrls`                                                                             | 株主還元・優待確認             |
| `sustainability`      | `menuKeywords`, `selectors`                                                                                                                 | サステナビリティメニュー検出   |

設定例：

```json
{
  "search": {
    "triggerTexts": ["検索", "search", "find"],
    "iconSelectors": [".search-btn", ".search-icon"]
  }
}
```

## テスト / 品質チェック

```bash
npm run lint           # ESLint（--max-warnings=0）
npm run format         # Prettier チェック
npm test               # Vitest（ユーティリティの単体テスト）
npm run smoke          # サンプルURLに対するdry-run
```

## トラブルシューティング

### 入力ファイルが見つからない

```
Error: ENOENT: no such file or directory
```

対応: `input/` にファイルが配置されているか確認し、`ls input` で存在をチェックしてください。絶対パスを利用する場合は `--file /absolute/path/to/urls.txt` のように指定できます。

```bash
node src/index.js --mode full --file /absolute/path/to/urls.txt
```

### Puppeteer のセットアップに失敗する

```
Error: Failed to download Chromium
```

対応: ネットワーク/プロキシ設定を見直し `npm install` を再実行。Chromium を手動展開する場合は `PUPPETEER_SKIP_DOWNLOAD` を利用してください。

### 実行がタイムアウトする / 要素が検出できない

- `--wait` で追加待機時間を延長
- `config/keywords.json` の `search.triggerTexts` や `search.iconSelectors` に対象サイト固有の値を追加
- `--mode compact` で軽量チェックのみ行い、対象サイトの挙動を確認

### 途中でエラーが発生し CSV が生成されなかった

`logs/` には常に `YYYYMMDDHHMMSS_ir-survey.log` が追記されます。調査途中でプロセスが落ちた場合は、このログを解析して途中までの結果を CSV として復元できます。

```bash
node scripts/log-to-csv.js logs/20251015T012818_ir-survey.log output/20251015T012818_from_log.csv
```

- 第1引数に対象ログ、必要に応じて第2引数で出力CSVパスを指定します（省略時は `output/` 配下に自動生成）。
- ログに出力される `ヒットURL(社長メッセージ): ...` のような行を利用し、備考とともに復元します。
- 本来の調査が完了できなかった場合でも、進捗分の結果を引き継げます。

---

## 付録

- `config/keywords.json` が見つからない場合はデフォルト値（`src/config/keywords.js`）で動作しますが、納品時は必ず `keywords.json` を同梱してください。
