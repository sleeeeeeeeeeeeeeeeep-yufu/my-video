# プロジェクト概要：自動ショート動画生成システム

## 目的
クライアントが素材（動画・台本）をアップロードしてチャットで指示するだけで、
ショート動画が自動生成されてMP4ダウンロードできるシステム。

## 技術スタック
- フロントエンド: Next.js（Remotion SaaSテンプレート）
- 動画レンダリング: Remotion + AWS Lambda
- ホスティング: Vercel（https://my-video-rust.vercel.app）
- 動画素材保存: AWS S3（remotionlambda-useast1-9okgftsztm）
- AIチャット: OpenAI GPT-4o-mini
- 動画解析（予定）: Gemini 2.5 Pro API

## 動画仕様
- 縦型ショート動画（1080x1920 / 9:16）
- 30fps / 最大39秒（1170フレーム）
- テンプレート: educational-short-v1（教育・啓蒙系）

## episode.json（v2.0.0）の構造
動画の設計図。AIが生成・編集してLambdaに渡す。
- version: バージョン管理
- meta: タイトル・fps・解像度
- theme: フォント・色・サイズ（一元管理）
- audio: BGM設定
- fixedTitle: 画面上部に全編表示するタイトル
- videoSrc: S3の動画URL（アップロード時に自動セット）
- segments: カット単位の配列
  - id / type / start / end / text / animation / se / zoom

## セグメントの定義
- type: hook / normal / emphasis / fact / relief / conclusion
- animation: pop / reveal / instant
- se: dodon / quiz_correct / chan / pikon（無音ダミーMP3）
- zoom / zoomX / zoomY: 疑似マルチカメラ

## 現在の状態（MVP完了）
- チャットで指示→AIがepisode.jsonを生成→動画に反映→MP4ダウンロード
- 動画素材はS3にUUID名で保存（日本語ファイル名対応済み）
- OffthreadVideoでLambdaタイムアウト解消済み
- フル尺レンダリングは未対応（現在6.6秒のみ）

## 次にやること（優先順）
1. Gemini 2.5 Pro APIによる動画解析（無音・フィラー除去・発話タイミング検出）
2. 台本アップロード機能（.md / .txt対応）
3. エフェクト・AIプロンプト精度向上
4. フル尺レンダリング対応（frameRange修正）

## 注意事項
- .envは絶対にGitHubにアップしない
- PowerShell起動のたびに以下が必要：
  fnm env --use-on-cd | Out-String | Invoke-Expression
  fnm use 22
- S3バケットのCORS設定済み（GET/HEAD / AllowedOrigins: *）
- リロードするとvideoSrcが初期化される（再アップ必要）
