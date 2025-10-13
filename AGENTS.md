# リポジトリガイドライン

このガイドは IR ranking screening automation に関する期待事項をまとめています。

## プロジェクト構成とモジュール整理
- `src/index.js` は CLI エントリであり、`src/full.js` に処理を委譲して調査を統括します。
- `src/lib/` には `url-loader.js` など入力リストを解析するユーティリティを配置しています。
- `config/keywords.json` は検出ロジックを定義する必須ファイルです。存在しない場合は実行が停止するため、案件ごとの調整はこの JSON に集約します。
- `input/` に調査対象リスト（サンプルや検証用ファイルを含む）を配置し、生成された CSV は `output/` に時刻付きファイル名で保存されます。
- ランタイムログは `logs/` に `YYYYMMDDHHMMSS_ir-survey.log` 形式で出力されます。
- `tests/` には Vitest のテストがまとまっています。

## ビルド・テスト・開発コマンド
- `npm start` は 2 項目の compact スキャンを実行します（`--mode compact` 相当）。
- `npm run survey:full|primary|secondary` で詳細調査と部分調査を切り替えます。
- `npm run survey:sample` は `input/urls_sample.json` を対象にフルワークフローの回帰確認を行います。
- `npm run smoke` は `input/urls_sample.txt` を使ったオフライン dry run で設定を検証します。
- `npm run lint`、`npm run format`、`npm test` で lint、整形、Vitest を順守し、必要に応じて `test:watch` や `test:coverage` を追加実行します。

## コーディングスタイルと命名規則
- リポジトリの Prettier 設定（`tabWidth: 2`、`singleQuote: true`、`printWidth: 100`、trailing commas）を適用します。
- ESLint（recommended + import）は `--max-warnings=0` で実行されるため、インポートを整理し明示的な export を優先してください。
- ランタイムモジュールは CommonJS（`require` / `module.exports`）を使用し、テストは ESM を活用します。ファイル名は kebab-case（例: `url-loader.js`）を維持します。
- 調査ステップを反映した説明的な関数名やオプション名（例: `runSurvey`、`buildOptionsFromArgs`）を選択してください。

## テスト指針
- 新しいケースは `.test.js` 接尾辞で `tests/` 配下に追加し、Vitest のグローバル設定は `vitest.config.cjs` で管理されています。
- `input/` のフィクスチャを活用して URL の端境事例を再現し、パーサーを検証します。
- PR を開く前に `npm test` を実行し、コアロジックを追加する際は `npm run test:coverage` を活用してください。

## コミットと Pull Request の方針
- コミットサマリは命令形の英語サブジェクト（約 50 文字）とし、必要に応じて範囲を示すヒントを加えます（例: `Add compact survey dry run`）。
- 変更理由と予想される CSV やコンソールへの影響をサマリに記載し、関連する issue ID があれば参照します。
- PR 説明には実行結果（`npm test`、`npm run lint`）と、調査挙動が変わる場合のスクリーンショットや CSV の抜粋を添付します。
- `config/keywords.json` の更新は顧客固有ロジックをレビューできるよう必ず強調します。

## セキュリティと設定のヒント
- 認証情報や proxy token をコミットせず、Puppeteer が利用する環境変数経由で注入してください。
- キーワードの上書きは PR で記録し、顧客固有の調整は `config/` ディレクトリ内に収めます。
