# episode.json 構造仕様

> **バージョン**: 2.0.0  
> **役割**: 動画編集エンジンの中心データ構造  
> **時間単位**: すべて **フレーム (frame)** 基準 (fps=30)

---

## 1. 役割概要

`episode.json` は動画自動編集パイプラインにおける **単一の真実源 (Single Source of Truth)** です。

- Remotion レンダリングエンジンへの **入力仕様** として機能する
- AI 解析結果・ユーザー編集・テーマ設定をすべて統合する
- `segments` の時刻定義はすべて **カット後（編集済み）タイムライン** を基準とする

```
Input Video → AI解析 → episode.json → Remotionレンダリング → MP4出力
```

---

## 2. トップレベル構造

| フィールド     | 型       | 説明                                    |
|--------------|---------|----------------------------------------|
| `version`    | string  | スキーマバージョン（現在 `"2.0.0"`）          |
| `template`   | string  | 使用テンプレート識別子                       |
| `meta`       | object  | 動画メタ情報（fps, 解像度, 尺）               |
| `theme`      | object  | フォント・カラーなどビジュアルテーマ              |
| `audio`      | object  | BGM 設定                                |
| `fixedTitle` | string  | 全区間に表示される固定タイトルテキスト            |
| `videoSrc`   | string  | 元動画の URL またはファイルパス               |
| `segments`   | array   | 字幕・アニメーション・SE の定義リスト            |
| `cuts`       | array   | カット（削除）区間のリスト *(省略可能)*          |

---

## 3. `meta` フィールド

```json
"meta": {
  "title": "動画タイトル",
  "fps": 30,
  "durationInFrames": 1170,
  "resolution": {
    "width": 1080,
    "height": 1920
  }
}
```

- `fps`: フレームレート。すべての frame 計算の基準となる
- `durationInFrames`: Composition 全体の長さ（フレーム数）

---

## 4. `theme` フィールド

```json
"theme": {
  "fontFamily": "源ノ角ゴシック Heavy",
  "mainTextColor": "#FFFFFF",
  "strokeColor": "#63BFA0",
  "strokeWidth": 20,
  "titleTextColor": "#007873",
  "titleBgColor": "#FFFFFF",
  "titleFontSize": 48,
  "captionFontSize": 72
}
```

- `SegmentText` コンポーネントが `theme` を参照してスタイルを決定する
- `segment.highlight === true` の場合は `fontSize × 1.2`、`strokeWidth × 1.5` が適用される

---

## 5. `audio` フィールド

```json
"audio": {
  "bgm": "bgm_name",
  "bgmVolume": 0.1
}
```

- `bgm`: `public/audio/{bgm}.mp3` のファイル名（拡張子なし）。`null` の場合 BGM なし
- `bgmVolume`: 全区間で一定の音量（0.0〜1.0）
- BGM は `<Audio loop />` で Composition 全体に流れ続ける

---

## 6. `segments` フィールド（字幕・SE・アニメーションの統合定義）

`segments` は動画編集の**中心ロジック**を担うフィールドです。各要素が1つの字幕ブロックを表します。

```json
{
  "id": 1,
  "type": "hook",
  "start": 0,
  "end": 120,
  "text": "表示テキスト",
  "animation": "pop",
  "se": "pikon",
  "color": "green",
  "highlight": true,
  "zoom": 1.05,
  "zoomX": 0.1,
  "zoomY": -0.1
}
```

### 6-1. 時刻フィールド（`start` / `end`）

| フィールド | 型     | 単位   | 説明                        |
|----------|--------|-------|----------------------------|
| `start`  | number | frame | セグメント表示開始フレーム（カット後基準） |
| `end`    | number | frame | セグメント表示終了フレーム（カット後基準） |

> **重要**: `start` / `end` は **カット後のタイムライン** を基準とした値である。  
> Remotion の `<Sequence from={}>` に渡す際は `afterToOriginal()` で元動画時刻に変換する。

### 6-2. `type` フィールド（セグメント種別）

| 値           | 意味                        |
|-------------|---------------------------|
| `hook`      | 冒頭の掴み字幕                 |
| `normal`    | 通常字幕                     |
| `emphasis`  | 強調字幕                     |
| `fact`      | 事実・データ表示                |
| `relief`    | 安心感を与える字幕               |
| `conclusion`| 結論字幕                     |

### 6-3. `animation` フィールド（キャプションアニメーション）

| 値         | 動作                                              |
|-----------|--------------------------------------------------|
| `instant` | 即時表示。アニメーションなし                            |
| `pop`     | フレーム 0〜8 でスケール `1.2→1.0` のポップイン効果       |
| `reveal`  | 1フレームごとに文字を1文字ずつ表示するタイプライター効果     |

### 6-4. `se` フィールド（サウンドエフェクト）

- `public/se/{se}.mp3` のファイル名（拡張子なし）
- セグメント表示開始フレームと同時に `<Audio>` で再生される
- `null` または `"none"` の場合は再生しない

### 6-5. ビジュアル修飾フィールド

| フィールド     | 型      | 説明                                            |
|--------------|--------|------------------------------------------------|
| `color`      | string | `"green"` → テキスト緑、`"red"` → テキスト赤。省略時は白 |
| `highlight`  | boolean| フォントサイズ・縁取りを強調倍率で描画                    |
| `zoom`       | number | 動画レイヤーの拡大率（1.0 = 等倍）                     |
| `zoomX`      | number | 動画の水平方向オフセット（0.1 = 右へ10%移動）              |
| `zoomY`      | number | 動画の垂直方向オフセット（-0.1 = 上へ10%移動）             |

---

## 7. `cuts` フィールド（カット区間）

```json
"cuts": [
  { "start": 300, "end": 450 }
]
```

- `start` / `end`: カット（削除）する元動画のフレーム範囲
- `segments` の時刻はカット後タイムライン基準のため、レンダリング時に `afterToOriginal()` で元動画時刻へ逆算する

---

## 8. `afterToOriginal()` の役割

```
カット後フレーム → 元動画フレーム への変換関数
```

### アルゴリズム概要

1. `cuts` をソートする（`start` 昇順）
2. カット後フレーム値から、フレームより前に存在するカット区間の長さを累積加算する
3. 結果として元動画における実際の再生位置を得る

### なぜ必要か

| 課題 | 理由 |
|------|------|
| `segments` はカット後の論理タイムライン | ユーザー・AIが「カットを除いた動画」を前提に字幕位置を定義できる |
| `<OffthreadVideo>` は元動画を参照 | 動画レイヤーは元動画を直接再生するためフレーム変換が必要 |
| `<Sequence from={}>` は元動画フレーム基準 | Remotion の Sequence は Composition の全体フレームを基準とする |

---

## 9. フィールド依存関係図

```
meta.fps
  └─ 全フレーム計算の基準単位

segments[].start / end  (カット後フレーム)
  └─[afterToOriginal()]→  Sequence.from / durationInFrames (元動画フレーム)
  └─ zoom, zoomX, zoomY → VideoLayer の transform
  └─ animation          → SegmentText のアニメーション制御
  └─ se                 → Audio の src
  └─ color, highlight   → theme を参照してスタイル決定

cuts[].start / end
  └─ afterToOriginal() の補正値として使用
  └─ isInCut 判定 → カット区間の暗幕オーバーレイ表示

audio.bgm / bgmVolume
  └─ Composition 全体に流れる Audio ループ

theme
  └─ segments 全体のスタイル基準
```

---

## 10. 時間同期の仕組み

### タイムライン二層構造

```
元動画タイムライン (Original)
  [0]---[300]XXXXXXXX[450]---[900]---...
                ↑カット区間

カット後タイムライン (After)
  [0]---[300]---[750]---...
  (カット区間を詰めた論理タイムライン)
```

### 同期ルール

| レイヤー           | 使用するタイムライン |
|------------------|----------------|
| `<OffthreadVideo>` | 元動画タイムライン（変換後） |
| `<Sequence>`       | Composition フレーム（変換後） |
| `segments` 定義    | カット後タイムライン（変換前） |
| `isInCut` 判定     | 元動画タイムライン |

- `useCurrentFrame()` は Composition 開始からの**絶対フレーム数**を返す
- セグメントの `localFrame` = `currentFrame - startFrame`（Sequence 内相対フレーム）
