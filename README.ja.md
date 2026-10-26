# turbowarp-extension-data-editor

[English](README.md) | 日本語

TurboWarp拡張が扱う構造化データを、フォームや独自UIで編集するための実験的な共通API v1です。
[共通基盤 #1](https://github.com/kubohiroya/turbowarp-extension-data-editor/issues/1) と
[GUI 接続 #1](https://github.com/kubohiroya/scratch-gui/issues/1) に対応します。

日本語の利用手順・API・GUI接続・公開・検証記録は[ドキュメント一覧](docs/README.md)へ集約しています。

タブ・グループ・グリッドは[共通レイアウトガイド](docs/common-layout.ja.md)を参照してください。標準RJSFとSource/Formで同じJSON宣言を使用し、ホストの起動時フラグ `commonLayout` で有効にします（既定OFF）。

[公開エディター・日英案内](https://kubohiroya.github.io/turbowarp-extension-data-editor/) と
[公開・検証の運用Issue #26](https://github.com/kubohiroya/turbowarp-extension-data-editor/issues/26) も本リポジトリが所有します。

## 標準の JSON Schema エディター

JSON/YAML を格納する文字列引数と JSON Schema を宣言すると、react-jsonschema-form がフォームを生成します。
GUI の登録 API は `schema` を検出して標準エディターを選びます。本文 UI の実装は不要です。

```js
const unregister = Scratch.gui.blockEditors.register({
  apiVersion: 1,
  extensionId: 'story',
  editorId: 'properties',
  opcodes: ['story_scene'],
  argument: 'PROPERTIES',
  format: 'yaml', // Omit for JSON compatibility.
  schema: {
    type: 'object',
    properties: {
      label: {type: 'string', minLength: 1, title: '名前'},
      duration: {type: 'number', minimum: 1, maximum: 60, title: '秒数'}
    },
    required: ['label', 'duration'],
    additionalProperties: false
  },
  uiSchema: {'ui:order': ['label', 'duration']}
});
```

`registerSchema()` も同じ標準エディターを明示的に登録できます。
必須項目・型・範囲などの検証エラーがある間は保存ボタンを無効化し、保存時にも必ず再検証します。
任意の非同期 `validateData(data, snapshot)` による業務検証は保存時に追加実行されます。
スキーマの検証は AJV 8、描画は React 16.14 に対応する RJSF 5.24.13 を使用します。
対応の基本は JSON Schema draft-07 とローカル参照です。外部参照の取得は行わず、解決できない参照は登録時に拒否します。
`default` は下書きへ補完し、保存するまで元ブロックへ書き込みません。

`format: 'json' | 'yaml'` を指定できます。省略時は従来どおり JSON です。
YAML はホスト側の `yaml` 2.x で単一の YAML 1.2 core 文書を decode し、
JSON と同じ Schema で検証した後、指定形式で encode します。
文字列キーの mapping、sequence、有限数値・文字列・真偽値・null が対象です。
重複キー、非文字列キー、独自 tag、非有限数値、循環 alias、複数文書、YAML 1.1 は拒否し、元の引数は変更しません。
非循環 alias は制限付きで展開します。merge key の特別な展開は行いません。
変更なしの保存はコメント・空白を含む元文字列を保持し、commit しません。
変更がある保存はデータの意味を保持して再出力しますが、コメント・引用符・anchor・キー順の保持は保証しません。
フォームで編集しない追加プロパティも、Schema が許可する限り保持します。
GUIのwebpack 4接続では[互換配布物と設定API](docs/webpack4.md)を使い、RJSF/YAMLの変換を本パッケージ側で行います。

## API とトランザクション

ルートの `EditorRegistry` / `EditorSession` は React / Blockly に依存しません。
`@kubohiroya/turbowarp-extension-data-editor/rjsf` の `createSchemaEditor()` が標準フォームを提供します。
通常 DOM や独自 React UI の `mount()` を持つ定義も登録できます。
`/rjsf` の `createBlockEditorService()` がSchema検出・登録/解除・通知を提供します。
`/react` の `BlockEditorDialog` は保存/キャンセル・エラー・階層UIを提供し、ホストのModal・翻訳・テーマを注入します。
CSSは `/react/styles.css` をホストのCSS Modules経由で読み込みます。

開始時のスナップショットと独立した JSON の下書きを持ち、キャンセルでは変更を破棄します。
保存は検証、引数の許可リスト、reporter 保護、競合確認を通し、ホストへ1回だけ変更を要求します。
GUI ホストは画面と VM を同期し、保存を Undo/Redo 各1回にまとめます。失敗時の復元もホストの責務です。
`session.reference` で対象の target / block を識別できます。本文の unmount は下書きとエラーを保持し、再マウントできます。
解除済みビューからの更新を拒否し、ビューの購読を解放します。標準フォームのフィールド ID も各表示で分離します。
詳しくは [API とホスト契約](docs/api.md) を参照してください。

## TurboWarp 接続

`/turbowarp` の `attachTurboWarpBlockEditors()` にホストのScratchBlocks / VM / workspace、
登録サービスと画面コールバックを渡すと、アイコン装飾・セッション起動・VM同期・一括保存を接続します。
`enabled` / `descendants` は省略時OFF、戻り値は `refresh()` / 冪等な `dispose()` です。
GUIにはライフサイクル・Modal/翻訳/テーマの接続を残します。
詳細は [TurboWarp アダプターAPI](docs/turbowarp-adapter.md) を参照してください。

## 子孫をまとめる階層セッション

[共通基盤 #2](https://github.com/kubohiroya/turbowarp-extension-data-editor/issues/2) の追加 API として、
`EditorRegistry.openDescendants()` と `DescendantSession` を提供します。
ホストが `descendant-editing-v1` capability と完全な subtree snapshot / 一括 commit を提供する場合だけ使用します。
既存の API v1 の本文を再利用し、親子孫・複数枝の下書きと検証結果を保持して、全変更を1回でホストへ渡します。
未登録の中間ノードを構造として保持し、非表示ノードも検証します。構造・値・登録の競合、上限超過、非同期処理中の無効化に対応します。

上限は500ノード・深さ32。GUIは階層編集を標準で提供し、未対応ホストでは既存の単一編集を使います。
詳細と業務非依存サンプルは [階層セッションの契約](docs/descendants.md) を参照してください。
実 GUI の探索・階層モーダル・一括 Undo/Redo・`.sb3` 結合確認は scratch-gui #2 での接続が必要です。

## ローカル検証

Node.js 24 以降と pnpm を使用します。

```sh
pnpm install
pnpm typecheck
pnpm test
```

`pnpm test` は型宣言を含むビルド後、コアと標準フォームのテストを実行します。
パッケージは ESM です。ブラウザには ES2022 の組み込み API が必要です。
標準フォームの React / ReactDOM peer は 16.14 / 17 / 18。GUI は既存の 16.14 を共有します。
初回の実験版は `@kubohiroya/turbowarp-extension-data-editor@0.1.0` です。固定SchemaのSource/Form編集は `0.2.0`、既定OFFの固定入力契約・標準field transaction・固定フォームとGUI接続は `0.2.1` で追加しました。配布版 `0.2.2` は、編集見出しのブロック名・アイコン、項目の削除メニュー・追加ボタン、key-valueの2行表示を含みます。

```sh
npm install --save-exact @kubohiroya/turbowarp-extension-data-editor@0.2.2
```

配布物・改名時の互換性・公開手順は[パッケージ配布](docs/package-distribution.md)を参照してください。

## GUI で試す

`scratch-gui` は本パッケージを検証済みのnpm完全version、またはGitの完全SHAで固定参照します。通常のGUIビルドに共通リポジトリの隣接配置は不要です。
[GUIの起動・制約・検証手順](docs/block-editor.md) に従ってください。
既存の拡張アイコンをクリックすると、標準モーダルで下書きを編集できます。

既存のSOURCE経路は、配置済みブロックの通常の text shadow に保存された JSON/YAML 文字列を扱います。この経路でreporter、メニュー、独自validator付きfieldを書き換えません。固定入力経路は対応hostで静的menu・数値・色を扱い、reporterや動的menuを評価・置換しません。
`.sb3` の保存、`project_url` とOSのファイル選択による再読込、日英表示とテーマの検証手順・実行範囲は[GUI接続E2E](docs/block-editor-e2e.md)と[固定入力の契約](docs/fixed-input-contracts.md)を参照してください。

## 標準動作とロールバック

対応GUIはダイアログ、ソースフォーム、共通レイアウト、固定入力、子孫編集、一括セキュリティ確認を標準で提供します。
通常の `editor.html?lang=ja` で利用でき、有効化用URLスイッチは不要です。低水準APIのhost能力交渉は維持します。
切戻しはGUIの変更と公開ページのGUI pinを一組でrevertします。
確定値は既存引数へ保存し、UI・下書き・関数・revision をプロジェクトデータへ追加しません。

## webpack 4 / E2E

[webpack 4配布物と設定API](docs/webpack4.md)、[GUI接続E2EとCIの実行手順](docs/block-editor-e2e.md)を参照。専用編集UIから互換ビルド・E2Eまで共通側で管理し、GUIには明示的なホスト接続とCI呼出しを残す。

## Schemaの共通型と診断変換

`@kubohiroya/turbowarp-extension-data-editor/schema`はDOM・React・RJSFをロードせずに利用できる入口です。Schema bundle、正本・生成物・参照用の役割、処理段階別の診断・結果、同期owner検証の型を公開します。

`toValidationIssues()`は入力診断を既存の`ValidationIssue`へ変換し、JSON Pointerのpath・順序・件数を維持した凍結結果を返します。不正な診断やcompile/execution診断はTypeErrorで拒否します。既存RJSFのpathや保存時専用の非同期`validateData`の契約は変わりません。

`compileSchemaBundle()`はdraft-07/2020-12と同梱resourceからオフラインの同期validatorを生成します。Schemaと入力を変更せず、構造化診断を返します。[pure検証API](docs/schema.md)を参照してください。同期owner合成と明示bundleのRJSF経路も追加済みです。既存公開入口・webpack4/build-info・CSS buildを維持しています。

同期owner検証には`/schema`の`validateSchemaInput`を利用できます。明示bundleフォームは`/rjsf`の`createSchemaBundleEditor` / `registerSchemaBundle`で登録します。context providerは呼出しごとに時刻・設定を渡します。表示上の対応範囲と既存APIの扱いは[Schema基盤](docs/schema.md)を参照してください。

既存SOURCE契約の導入時に採取した横断検証記録は**14契約・8 package**です。[Template分離後の再検証手順](docs/template-fixture-separation.ja.md#current-verification)で、Templateを含まないisolation indexと2つの検証commandを確認してください。この導入時記録では14本番契約と9固定契約を区別しています。固定入力の実装・GUI接続は末尾の契約節を参照してください。旧16契約・9 packageの結果と当時の開始条件は[段階1の履歴](docs/schema-stage1.ja.md)として保持します。

## Optional editing examples

Repository examples are opt-in teaching code, not template blocks or additional package exports. See [the JSON/YAML document example](examples/document-properties.mjs) and [its guide](examples/README.ja.md). Each extension owns its actual data contract.

Prepared source editing is an optional host capability. See [the source/form contract](docs/source-forms.ja.md) for fixed-schema bindings, atomic saves, compatibility, and rollback.

## 固定入力とGUI接続（S3-1〜S3-3）

固定入力の型・Schema検査・同期prepared契約を追加しています。`createBlockEditorService({fixedInputs: true})`の明示時だけ新しい登録APIを提供し、対応hostがない場合は開けません。lower-level hostの`enableFixedInputs: true`で標準fieldの読取・原子的保存を利用できます。固定フォームとGUIの既定OFFフラグ接続も含みます。各拡張は正本Schema・codec・登録を所有します。[固定入力の契約](docs/fixed-input-contracts.md)を参照してください。配布物には元Git SHAと版更新を含むworking-tree release overlayの区分を記録しています。
