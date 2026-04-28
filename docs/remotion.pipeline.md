# Remotion レンダリング構造仕様

> **対象**: `src/remotion/` 配下の構造  
> **前提**: `episode.json` を入力として受け取り、フレームベースで動画を合成する

---

## 1. episode.json と Remotion の関係

```
episode.json
     │
     ▼
Root.tsx (Composition 定義)
     │  defaultProps として注入
     ▼
Main.tsx (Composition 本体)
     │
     ├── VideoLayer     (元動画 + ズーム制御)
     ├── FixedTitleLayer (固定タイトル表示)
     ├── AudioLayer     (BGM + SE 再生)
     └── SegmentLayer   (字幕 + アニメーション)
         └── [segment ごとに Sequence を生成]
```

- `episode.json` は `Root.tsx` の `defaultProps` として Composition に注入される
- `calculateMetadata()` が `meta` フィールドから `fps` / `width` / `height` を取得し Composition のサイズを決定する
- レンダリング時は `Main.tsx` が props として `episode.json` の全フィールドを受け取る

---

## 2. Composition の構造

### Root.tsx（エントリポイント）

```
RemotionRoot
  └── <Composition id="MyComp">
        component={Main}
        fps={episode.meta.fps}
        width={episode.meta.resolution.width}
        height={episode.meta.resolution.height}
        durationInFrames={episode.meta.durationInFrames}
        defaultProps={episode}
```

- `calculateMetadata`: props の `meta` フィールドを参照し、動的に Composition サイズを決定するフック
- Composition は単一の `id` で識別され、レンダリング CLI から指定される

---

## 3. Frame の流れ

```
Composition 開始 (frame=0)
         │
         ▼
    useCurrentFrame()
         │
         ├── VideoLayer: zoom / translate 値を計算
         ├── SegmentLayer: activeSegment を特定
         └── isInCut: カット区間の暗幕表示を制御
```

- `useCurrentFrame()` は **Composition 開始からの絶対フレーム数** を返す
- すべてのレイヤーはこの単一の frame 値を参照して状態を決定する（宣言的レンダリング）

---

## 4. VideoLayer（元動画レイヤー）

| 要素                    | 役割                                     |
|------------------------|----------------------------------------|
| `<AbsoluteFill>`       | 画面全体に動画を配置するコンテナ                 |
| `<OffthreadVideo>`     | 元動画を `src` から再生するコアコンポーネント      |
| `transform: scale()`   | `segment.zoom` に基づくダイナミックズーム効果   |
| `transform: translate()` | `segment.zoomX / zoomY` によるパン効果      |
| `isInCut` 暗幕オーバーレイ | カット区間で `rgba(0,0,0,0.6)` のオーバーレイを表示 |

### ズーム制御の仕組み

```
frame → activeSegment を特定
      → zoom / zoomX / zoomY を取得
      → AbsoluteFill の CSS transform に適用
```

- `activeSegment`: `frame >= segment.start && frame < segment.end` で特定
- ズームは **カット後タイムライン**の `start/end` でそのまま判定（`afterToOriginal` 変換不要）

---

## 5. CaptionLayer（字幕レイヤー）

各 `segment` に対して `<Sequence>` を生成し、字幕テキストを表示する。

### Sequence の役割

```
segments.forEach(segment => {
  startFrame = afterToOriginal(segment.start, cuts)
  endFrame   = afterToOriginal(segment.end, cuts)
  duration   = endFrame - startFrame

  <Sequence from={startFrame} durationInFrames={duration}>
    <SegmentText />
  </Sequence>
})
```

- `<Sequence>` は指定した `from` フレームから `durationInFrames` の間だけ子要素を描画する
- Sequence の内部では `frame` が `0` にリセットされる（ローカルフレーム）
- `localFrame = frame - startFrame` でセグメント内相対時刻を計算

### SegmentText の役割

| 機能              | 説明                                            |
|-----------------|------------------------------------------------|
| テキスト2行分割      | BudouX で文節分割し、行数・文字数が均等になるよう自動分割する  |
| アニメーション制御    | `localFrame` を使い `pop` / `reveal` を実装         |
| スタイル適用         | `theme` と `segment.color / highlight` を合成して適用 |
| 絵文字分離           | 末尾の絵文字を分離して BudouX の脱落を防止する             |

---

## 6. AnimationLayer（アニメーション制御）

アニメーションは `SegmentText` 内部で直接実装される。独立したレイヤーコンポーネントではない。

| アニメーション | 実装                                               |
|------------|--------------------------------------------------|
| `pop`      | `interpolate(localFrame, [0,8], [1.2, 1.0])` でスケール補間 |
| `reveal`   | `charsToShow = Math.floor(localFrame / 2)` で文字数を増加 |
| `instant`  | アニメーションなし。テキストを即時全表示                     |

---

## 7. AudioLayer（音声レイヤー）

### BGM

```
<Audio src={staticFile(`audio/${audio.bgm}.mp3`)} volume={audio.bgmVolume} loop />
```

- Composition 全体を通して再生される
- `audio.bgm` が `null` の場合は描画しない

### SE（サウンドエフェクト）

```
// 各 Sequence 内部
<Audio src={staticFile(`se/${segment.se}.mp3`)} />
```

- `<Sequence>` 内に配置されるため、Sequence 開始フレームで自動的に再生が始まる
- `segment.se` が `null` または `"none"` の場合は描画しない

---

## 8. フレームベース同期の仕組み

```
frame = useCurrentFrame()
          │
          ├─ VideoLayer
          │    └─ activeSegment で zoom/translate を決定
          │
          ├─ CaptionLayer
          │    └─ afterToOriginal(segment.start) == frame で Sequence 開始
          │         └─ localFrame = frame - startFrame でアニメーション進行
          │
          └─ AudioLayer
               └─ Sequence 内 <Audio> が Sequence 開始と同時に再生
```

### 同期の原則

| 原則                         | 説明                                             |
|-----------------------------|-------------------------------------------------|
| 単一 frame の参照             | 全レイヤーが同一の `useCurrentFrame()` を参照する       |
| 宣言的レンダリング              | 各フレームの状態は frame 値から純粋に計算される            |
| Sequence による時刻管理        | 字幕・SEの開始・終了は `<Sequence>` の `from` で厳密に制御 |
| afterToOriginal の一貫適用    | CaptionLayer の全 Sequence 適用前に変換を行う          |

---

## 9. レイヤー構成と zIndex

```
AbsoluteFill (z=auto)
  │
  ├── AudioLayer        (音声のみ、視覚的な zIndex なし)
  │
  ├── VideoLayer        (z=auto / カット暗幕 z=5)
  │    └── OffthreadVideo
  │    └── CutOverlay (z=5, isInCut 時のみ)
  │
  ├── FixedTitleLayer   (z=10)
  │    └── fixedTitle テキスト
  │
  └── CaptionLayer      (z=20)
       └── Sequence × N
            └── SegmentText
```
