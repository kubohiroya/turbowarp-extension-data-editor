# API v1 とホスト契約（設計・最小実装）

現行GUIの編集機能は標準ONです。有効化用URLスイッチは撤去しました。旧フラグの説明は段階導入時の履歴で、現在の起動・切戻し方法は[README](../README.ja.md#標準動作とロールバック)に従ってください。

対象: [共通基盤 #1](https://github.com/kubohiroya/turbowarp-extension-data-editor/issues/1)。この文書の API は本パッケージ独自であり、TurboWarp 標準 API ではありません。GUI の最小接続を検証中であり、互換性を確定した安定版ではありません。

## 登録

`EditorRegistry.register(definition)` は解除関数を返します。定義には `apiVersion: 1`、`extensionId`、`editorId`、`opcodes`、`editableArguments`、`read`、`validate`、`createPatch` と任意の `mount` を指定します。

- `extensionId` は TurboWarp の拡張 ID に合わせた英数字、`editorId` は英数字から始まり英数字・`.`・`_`・`-` を使用できます。
- `opcodes` は `story_scene` のような完全な opcode。1個以上、同じ拡張に属し、重複しないことを要求します。
- `extensionId + editorId` と opcode の重複登録は例外とし、一部だけ登録されることはありません。暗黙の上書きはしません。
- 解除関数は冪等です。古い解除関数が後から登録された定義を消すことはありません。開始済みセッションは元の定義を保持します。
- `resolve(opcode)` は表示判断に必要なデータだけを返します。UI がなければ `undefined` です。
- メタデータの `editorId` を GUI へ渡す経路は未検証です。最小実装は明示的な opcode 登録を使います。UI 関数を `getInfo()` や `.sb3` へ直列化しません。

## スナップショットと下書き

`open(reference, host)` は配置済みブロックの `targetId` と `blockId` を固定します。ホストが編集可能なブロックを返さない、または opcode が未登録なら `undefined` を返します。ホストの不正データや `read()` の失敗は例外となるため、GUI は捕捉して起動エラーを表示します。

`session.reference` は凍結した `{targetId, blockId}` を返す読み取り専用プロパティです。終了後も参照でき、同じ opcode の別インスタンスを識別できます。`ValidationIssue.path` があれば項目のエラー、省略時はフォーム全体のエラーとして扱います。エラーはこの reference、変更案は reference と `LiteralArgumentChange.argument` を組み合わせて対象へ対応づけます。opcode や表示名をインスタンスの識別子には使いません。

`BlockSnapshot` は参照 ID、`opcode`、不透明な `revision`、引数スロットの集合を持ちます。引数は `{kind: 'literal', value: string | number | boolean}` または `{kind: 'reporter'}` です。reporter を評価したり、その計算結果を固定値として扱ったりしません。メニュー・変数参照など編集対象外のスロットはホストが除外します。

ホストは同じ ID の削除・再作成、スプライト切替、shadow の付け替え、引数変更、編集可能性の変更を revision や `null` に反映する必要があります。単に block ID を revision に流用してはいけません。コアは revision に加え opcode と引数値も比較しますが、ホストのライフサイクルを推測できません。

`read(snapshot)` は JSON オブジェクトの下書きを返します。スナップショットは凍結したコピーです。`getDraft()` / `setDraft()` でも毎回複製し、UI、検証、patch 作成と内部下書きで参照を共有しません。有限数値、文字列、真偽値、null、配列、通常のオブジェクトだけを許可します。undefined、非有限数値、Date、循環参照などは拒否します。コールバックは副作用を持たせず、`this` に依存しない関数として定義してください。

## 保存

1. `editing → saving`。二重保存は `busy`、終了済みは `closed` を返します。
2. 下書きのコピーを `validate(draft, snapshot)` に渡します。非同期処理も可能です。問題があれば `invalid` を返し、`editing` に戻します。
3. 別のコピーを `createPatch(draft, snapshot)` に渡し、`{argument, value}` の配列を取得します。これは同期関数です。
4. 許可リスト外、存在しない引数、reporter、重複、非有限数値などを適用前に拒否します。元と同じ値は変更要求から除きます。
5. `readBlock()` を再実行し、開始時点と比較します。削除・不一致なら `conflict` を返します。競合後の自動上書きやリベースはしません。
6. 変更があれば `commit({expected, changes})` を1回呼びます。変更がなければ commit しません。
7. ホストの成功後だけ `saved` とし、本文 UI と下書きを破棄します。検証・patch・ホスト適用の例外は `failed`、`BlockEditorConflictError` は `conflict` として保持し、再編集できる状態へ戻します。

### GUI ホストが保証すること

コアの事前確認とホストの実適用の間には競合する余地があります。ホストは**書き込み直前にも** `expected` を照合し、全引数・shadow・編集可能性を確認します。非同期 commit なら待機後の書き込み境界で再確認します。競合は `BlockEditorConflictError` で通知します。

適用は Blockly/Scratch のイベント経路を通し、画面と VM、dirty 状態、キャッシュを整合させます。保存全体が Undo/Redo 各1回になるようにします。イベントグループは非同期の検証や待機中に開き続けません。

複数フィールドのイベントを同じグループにするだけではトランザクションになりません。ホストは全変更の事前検証と失敗時の補償を設計し、適用失敗ではデータ、dirty、Undo/Redo 履歴を元に戻してから reject する必要があります。コアは workspace を持たないため、契約違反のホストの部分変更を復元できません。テストホストはメモリ上のデータ交換でこの契約を確認しているだけで、GUI アダプターは通常の text shadow に限定し、実 ScratchBlocks / VM の適用途中失敗と復元もテストします。

## 表示と終了

`mount(container, context)` は本文だけを描画し、必ず終了処理を返します。context は `getDraft`、`setDraft`、`getState`、`setValidationIssues`、`subscribe` です。VM、workspace、保存処理は渡しません。既存 React に依存させない境界なので、React、通常 DOM、他の描画方法を使えます。

`session.mount()` の戻り値を呼ぶと本文ビューだけを解除し、下書き・検証エラー・保存エラー・セッションを保持します。同じセッションを別の container へ再マウントできます。解除は冪等です。ビューの context で登録した購読は、解除時や mount 失敗時にセッションが解放します。解除済み context の `setDraft` / `setValidationIssues` / `subscribe` は例外となり、遅れて届いた入力や非同期結果が次のビューを変更することを防ぎます。タイマーや外部イベント、DOM 等の解除は本文実装の終了処理で行ってください。

セッション自身の `subscribe()` はビューとは独立し、手動の解除またはセッション終了まで有効です。本文を外してもホストは保存状態を監視でき、保存・キャンセル・dispose はセッション単位で実行します。複数セッションを同時に作成でき、GUI の「モーダルは1つ」という表示方針をフォーム API の制約にはしません。

標準ダイアログは共通側の `/react` に置き、タイトル・エラー・下部の保存/キャンセル・本文と階層の表示を担当します。scratch-gui は既存 Modal / ReactModal、翻訳済み文言、テーマを注入し、フォーカストラップと復帰を担当します。Escape、背景クリック、閉じるはすべて `cancel()` へ接続します。`saving` の間は `cancel()` / `dispose()` が `false` を返すため、終了操作を抑止します。target の消失などはホストが commit 前に確認し、失敗後に安全に終了します。

既存モーダルを選んだ理由は、GUI の React 16.14、フォーカス管理、テーマと既存の経路を共有できるためです。Radix Dialog の追加や React 本体の更新を初版の条件にしません。

`subscribe` は状態／下書きの変更を通知し、解除関数を返します。開始直後の通知はしないため、ビューは初期描画を自分で行います。保存成功・キャンセル・dispose は本文の終了処理を呼び、通知先を解除します。表示側のコールバックや終了処理の例外は console へ報告し、成功した commit を失敗扱いに変更しません。`mount` 自体が例外を出す場合は、その途中で作成した UI 資源を本文実装側で解放してください。

## 標準 JSON Schema フォーム

`/rjsf` サブパスの `createSchemaEditor(options)` は通常の `EditorDefinition` を作ります。
共通の識別情報に加え、JSON/YAML 文字列を保存する `argument`、`format: 'json' | 'yaml'`（省略時 JSON）、`schema`、任意の JSON `uiSchema` を指定します。
GUI の `Scratch.gui.blockEditors.register()` は `mount` がなく `schema` がある定義にこれを適用します。
`registerSchema()` による明示指定も可能です。登録解除は通常と同じです。

JSON の object / array / scalar を内部の `{data: value}` に包んで下書きとして扱います。
引数が文字列でない場合、不正な JSON/YAML の場合は起動を拒否します。
YAML は単一の YAML 1.2 core 文書、文字列キー、JSON 互換値に限定します。
未解決 tag、重複キー、循環 alias、非有限数値等は診断可能な例外として拒否します。
詳細な制約と書式保持の範囲は README を参照してください。
データの変更がない保存は元文字列を返し、コメント・空白の正規化による Undo を作りません。
`read()` で初期下書きを作るときに RJSF の `default` を補完します。元の引数は保存するまで変更しません。
表示・再表示時には既定値を再補完せず、消した入力や検証エラーを保持します。
自動生成するフィールド ID は mount ごとに分け、複数フォームで label の参照先が重複することを防ぎます。独自 `uiSchema` で固定 ID を指定する場合は呼び出し側で一意性を確保してください。
AJV の型変換・検証による default 補完・余剰プロパティの削除は無効です。
draft-07 を基本とし、未解決の外部参照や不正な schema は登録時に拒否します。

初期表示と入力時に検証し、`setValidationIssues()` で共通フッターへ状態を通知します。
`SessionState.canSave` は editing かつ検証エラーがない場合に true です。
この表示状態は保存時の検証を省略する根拠にはしません。直接 `save()` を呼んでも schema 違反は拒否します。
独自 UI でも `setValidationIssues()` を利用でき、入力変更は `setDraft()` 後に検証結果を通知します。
任意の `validateData(data, snapshot)` はスキーマ検証に成功した保存時だけ実行します。非同期を許可します。
業務検証はライブ実行しないため、初回の保存操作でエラーになる場合があります。エラー後は修正するまで保存を無効化します。

標準フォームは React / ReactDOM 16.14・17・18 を peer とし、GUI と同じ React を使用します。
`uiSchema` に widget 関数は渡せません。任意の UI コードが必要なら独自 `mount` を利用します。

## ホストから使う登録サービスと React ダイアログ

`/rjsf` の `createBlockEditorService()` は `{registry, api, subscribe}` を返します。
`api` は凍結された `apiVersion: 1` / `register()` / `registerSchema()` です。
`register()` は独自 `mount` がある場合はそれを使用し、ない場合に `schema` を標準フォームへ変換します。
登録・解除の成功で購読先へ通知し、解除関数は冪等です。不正な定義・重複登録は例外となります。
サービスはVM/workspaceを保持しません。GUIがVMごとのWeakMapで寿命を管理します。
ルート入口はReact/Blockly非依存のままです。標準フォームを使わない利用者は引き続き `EditorRegistry` を直接使用できます。

`/react` の `BlockEditorDialog` に以下を渡します。

- `session`: 単一または階層セッション。本文mount契約は従来どおりです。
- `ModalComponent`: `id`, `className`, `contentLabel`, `onRequestClose`, `children` を受けるホストのModal。
  portal・フォーカストラップ/復帰・Escape/背景/閉じるボタンを所有し、終了操作を `onRequestClose` へ渡します。
  根ブロックのアイコンがある場合は `headerImage` も渡します。
  `headerClassName` を見出しのコンテナへ設定すると、アイコン寸法と長い見出しの折り返しを制御します。
- `messages`: title / saving / cancel / save / saveAll / structureError / conflict / failed / structuralNode の翻訳済み文字列。
- `styles`: `/react/styles.css` をCSS Modulesで読み込んだcamelCaseのクラス名対応表。
- 任意の `className`: ホストテーマを設定するクラス。任意の `nodeLabels` / `nodeAppearances` は表示専用のメタデータ。
- `onClose`: ホスト側のModal状態を閉じる処理。任意の `onError` はビュー例外の報告先。

CSSはJS入口から自動importしません。ホストが `/react/styles.css` を読み込み、CSS ModulesのcamelCaseを有効にして渡します。
見出しは根ブロックの `nodeAppearances.name` または `nodeLabels` を使用します。
`messages.title` に `{name}` があれば置換し、従来の「ブロックを編集」/「Edit block」も名前を含む見出しへ置換します。
表示用メタデータがない場合は従来の見出しを維持します。
標準フォームの追加項目は番号と薄い枠を持ち、key-valueは「キー」「値」のラベルと入力欄を横並びにした2行で表示します。
項目の削除は「…」メニューの「🗑️この項目を削除」から行い、追加は「➕項目を追加」ボタンで行います。
テーマは `--block-editor-background`, `--block-editor-text`, `--block-editor-input`,
`--block-editor-button`, `--block-editor-border`, `--block-editor-radius` をModalのクラスへ設定します。
省略時は明るい背景の既定値を使用します。GUIの翻訳/Redux/テーマモジュールを共通側からimportしません。
RJSFの項目別invalid表示とARIA補完も共通UIが所有し、validへの修正や終了で属性/監視を復元します。
GUI developのinvalid強調を維持し、配列並べ替え、グループ制約、階層の折りたたみも既存テストで確認します。
エラー色はホストの `--block-editor-error-border`, `--block-editor-error-text`,
`--block-editor-error-tint` を使用し、省略時は明色の既定値を使います。
ReactとReactDOMはホストの同一インスタンスを共有してください。
webpack 4ではpackage exportsに対応していないため `/rjsf`, `/react`, `/react/styles.css` のaliasが必要です。
TurboWarp接続は `/turbowarp` の [アダプターAPI](turbowarp-adapter.md) に集約しています。
互換配布物の整備とE2E本体の移管は後続です。

## API v1 と次版の境界

初版は単一ブロックの編集です。`read` は初期下書き、`validate` は検証、`createPatch` は変更案だけを扱い、実際の書き込みはホストの `commit` に集約します。本文 UI は外側のモーダルや HTML form を所有しません。標準フォームも本文を `div` として描画します。

[次版 #2](https://github.com/kubohiroya/turbowarp-extension-data-editor/issues/2) の階層編集は、[追加 capability と階層セッション](descendants.md) として実装しています。ノードごとの検証・変更案を集め、全体を1回で commit します。単一ブロックの `EditorSession` / `commit` は維持し、子セッションの `save()` を順に呼ぶ方法では代用しません。構造変更は対象外で、実 GUI の探索・一括適用は scratch-gui #2 で接続する契約です。機能の世代と `apiVersion: 1` を混同せず、未実装・未結合のホスト機能を対応済みとは扱いません。

## 検証状況と後続

共通 API と RJSF の限定テスト、GUI の実 ScratchBlocks / VM と ReactModal の限定テスト、開発 webpack のコンパイルを確認します。
ブラウザで Schema の範囲違反と必須項目、保存・キャンセル・Undo/Redo を確認します。
現在の GUI は配置済みブロックの既存アイコンと通常の text shadow のみ対象です。
GUI で `.sb3` を実保存し、新しい画面の標準 `project_url` 経路で JSON 値・拡張登録・専用エディターが復元されることを確認しました。OS picker、アイコンなしへの入口追加、テーマ・翻訳・全対応環境は後続です。
検証手順・結果は[GUIの.sb3保存・再読込記録](block-editor-sb3-validation.md)を参照してください。
フラグの読み取りは GUI の `src/lib/tw-feature-flags.js`、起動時固定・既定 OFF。URL から `blockEditorDialogs=1` を外して再読込するとロールバックできます。
