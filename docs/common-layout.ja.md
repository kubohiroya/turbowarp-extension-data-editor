# 共通フォームレイアウト（Issue #49）

タブ・ラベル付きグループ・グリッドをJSONの表示定義として宣言する。標準RJSFフォーム（`src/rjsf.ts`）と原文保持型Source/FormのReact Tree（`src/source-view.tsx`）で、`src/layout.ts` の検査と `src/layout-view.tsx` の描画を共有する。Schemaや保存データに表示用の階層を足さない。

## 起動時フラグ

ホストがサービス生成時に `createBlockEditorService({commonLayout: true})` を渡す。既定は **OFF**。`src/config/feature-flags.ts` が値をコピーして固定し、extensionの登録情報ではONにできない。既存 `fixedInputs` フラグの既定値は変更しない。

サービスを使わない場合も、ホストが `createSchemaEditor(options, {commonLayout: true})`、`createSchemaBundleEditor(options, {commonLayout: true})`、`createSourceEditor(options, {commonLayout: true})` と明示する。フラグOFFは従来の表示・コントロールを使う。ONで表示定義がない場合は、項目順は従来どおりで、以下のSchemaに沿った入力UIと共通スタイルだけを適用する。不正なレイアウトのfallbackも配置のみを戻し、ON時の入力UIとスタイルは維持する。

## 宣言形式 v1

`SchemaEditorOptions.uiSchema`、`SchemaBundleEditorOptions.uiSchema`、`SourceVariant.uiSchema` の対象objectに次を置く。配列要素は従来どおり `uiSchema.items`、入れ子objectはそのプロパティ名の下に宣言する。`ui:options.extensionDataLayout` は本パッケージ独自のオプションであり、RJSF標準オプションではない。型は `/rjsf` から `EditorLayout`・`EditorLayoutItem` としてexportする。

```js
const uiSchema = {
  'ui:options': {
    extensionDataLayout: {
      version: 1,
      items: [{tabs: [
        {label: '基本', items: [
          {group: '識別', items: [{field: 'name'}]}
        ]},
        {label: '画像', items: [
          {grid: 2, items: [{field: 'width'}, {field: 'height'}]}
        ]}
      ]}]
    }
  }
};
```

`field` は **当該objectの直下のリテラルなキー**。`a.b`、`a/b`、`a~b` はそれぞれ1つのキーで、パスには展開しない。入れ子の項目はそのobjectのuiSchemaで指定する。未分類の既知項目と追加プロパティはレイアウトの後に表示する。任意項目がまだ存在しないSource/Formでは、その値を自動作成せず、既存の追加コントロールから追加できる。

`items` の順が表示順・キーボードのTab移動順となる。グリッドは行優先で指定列数に配置し、600px以下で1列へ戻す。groupやgridやtabsは入れ子にできる。制限は深さ8・合計256ノード・tabsあたり16パネル・grid 1〜4列・ラベル128文字。未知バージョン・未知オプション・重複または不明なfield・上限制約違反は、対象object全体で適用を中止し、診断を表示して従来描画に戻す。Schemaに定義された任意項目への参照は、値が未作成でも有効。

定義はJSONのみ。関数、React要素、任意コンポーネントの評価は行わない。Schemaの制約、既定値、coercion、未知キーの保存方針は変更しない。現行RJSF v5自体の対応範囲も変わらない。特にRJSFの内部処理が落とすprototype名のプロパティは、このレイアウトでも新たに対応しない。Source/FormのTreeではそのようなリテラルキーも扱える。

完全なサンプルは [`examples/common-layout.ts`](../examples/common-layout.ts)。

## 入力・検証・アクセシビリティ

- タブの全パネルはマウントを維持し、非表示パネルだけ `hidden` にする。1つのdraftと保存トランザクションを共有し、パネルごとの別フォームや別保存を作らない。
- タブ移動では原文の再生成、format/variant変更、既定値挿入を行わない。Source/Formの既存の原文パッチ、未確定数値、Sourceでの修復、Discard form editsを維持する。
- 非表示パネルのエラーもタブの件数に反映する。保存検証に失敗した場合、エラーのある最初のパネルを開き、入力へフォーカスする。常時の検証更新だけでは選択中のタブを変えない。ルート単位の診断は既存ホストのエラー表示に残る。
- `tablist`・`tab`・`tabpanel`、`aria-selected`・`aria-controls`・`aria-labelledby`、エディター間で一意のIDを設定する。左右キー・Home・Endで選択とフォーカスを移動する。IME中のキーとEscapeは横取りしない。保存中はタブ操作も無効にする。
- RJSFの既存の項目番号、追加プロパティのキー編集、項目メニュー、追加・削除、エラー表示は既存テンプレートを使う。

## Schemaに沿った入力UIと共通スタイル

`commonLayout` がONの場合、両経路に同じ色・入力欄・タブ・グループ・グリッドのスタイルを同梱する。`src/form-presentation.tsx` がスタイルとラベル／説明表示、`src/schema-presentation.ts` が表示用の型判定を所有する。ホストの `--block-editor-*` 色指定を継承し、フラグOFFでは注入しない。スクリーンショット専用のCSSで入力欄を飾る実装にはしない。

Source/Formは次の規則で、汎用JSONツリーから設定フォームへ切り替える。

- `$ref`、`allOf`、`oneOf`／`anyOf`、`enum`／`const`、nullableの型制約を調べ、型が1種類に確定し現在の値と一致する場合だけ型選択を省く。選択中のunion分岐だけで型を固定しない。複雑な条件で型を証明できない場合、または保存済みデータの型が不正な場合は、修復用の型選択を残す。
- 必須の既知プロパティは削除操作を出さない。任意項目の明示的な追加／値解除は「項目を管理」にまとめる。閉じたobjectでは自由なキー追加を出さず、追加プロパティを許すobjectでは補助メニューから追加できる。保存済みの未知キーは表示して保持し、閉じたSchemaに違反するキーも勝手に削除しない。
- 固定長配列や閉じたtupleは不要な追加・削除・並べ替えを出さない。可変長配列の有効な操作は残す。明示追加時だけ型に合う空の値を作り、Schemaのdefaultを適用したり、マウント時に任意項目を生成したりしない。
- `if/then/else` の条件がtype・const・enum・required・properties・論理結合・参照だけで判断できる場合は、その配列制約も表示へ反映する。Camera Sourceの歪みモデル `none` では係数追加を出さず、固定長モデルへ変更すると必要な追加を出す。未対応の条件は推測せず保守的に扱い、正本の検証を継続する。モデル変更だけで係数を生成・削除しない。
- 型付きの1行文字列はtext input、複数行の値または `ui:widget: textarea` はtextarea、真偽値はcheckboxにする。固定値はreadonly表示。表示ラベルは `ui:title`、Schemaのtitleを優先し、fallbackのJSON PointerやcamelCaseキーは読みやすい項目名にする。保存キーは変えない。
- 長い説明は開閉できる「説明」にまとめ、Source/Form切り替えは上部の切り替えボタンへ配置する。format／variantの変更やDiscardは「文書の操作」へまとめる。隠すのは操作の常時表示であり、修復・破棄の機能は維持する。

RJSFは既存のSchema依存の構造操作を維持し、Field／Object／Array title・Descriptionテンプレートに同じラベル、説明、空配列表示を適用する。項目番号と追加プロパティのキー編集は既存実装を継続する。Source/Formの型判定やスタイルは正本Schema検証を置き換えず、保存直前のcanonical検証・原文パッチ・トランザクションは変更しない。

## RJSF公式ガイドと実装の対応

使用中のRJSFは5.24.13、Reactは16.14。公式v5ガイドの以下に従い、フォーム全体を置き換えず **ObjectFieldTemplateに渡されたproperties.contentを配置し直す**。元のテンプレートにタイトル・description・追加操作を任せ、共通側がグループとタブを描画する。

- [v5 ObjectFieldTemplate](https://rjsf-team.github.io/react-jsonschema-form/docs/version-5.24.10/advanced-customization/custom-templates/#objectfieldtemplate)
- [v5 uiSchema](https://rjsf-team.github.io/react-jsonschema-form/docs/version-5.24.10/api-reference/uiSchema/)
- [v5 Custom Widgets and Fields](https://rjsf-team.github.io/react-jsonschema-form/docs/version-5.24.10/advanced-customization/custom-widgets-fields/)
- [v5 Objects](https://rjsf-team.github.io/react-jsonschema-form/docs/version-5.24.10/json-schema/objects/)

v6のLayoutGridField/LayoutHeaderFieldは採用しない。Source/Formは再帰Schema・prefixItems・原文保持のため独立Treeのままとし、生成済みの子コントロールだけ共通配置コンポーネントへ渡す。

## Camera Source #52との依存

専用 `turbowarp-camera-source-block-editor` は作らない。Camera SourceはSchema bundle・uiSchema・純粋なowner検証callbackを渡し、ホストの共通data-editorがSchema compile、一般JSON/YAML codec、描画を所有する。Camera Source本体の編集用依存除去は別作業であり、#49の追加だけで自動的には起こらない。Camera Source #52の実装と組み合わせて利用する。既存API v1へ未知のui:optionsを渡せるため旧ホストは従来表示を継続し、共通機能を利用するホストのみ#49を含む配布物へ更新してフラグを有効にする。

## 受け入れ基準・検証

- [x] 既定OFF、起動時固定、定義なしと不正定義で従来の項目順にfallback。
- [x] RJSF通常／BundleとSource/Formで同じJSON契約、未分類項目を保持。
- [x] 隠れたパネルの入力とエラーを保持し、保存時に表示・フォーカス。
- [x] 原文no-op、コメント、未知キー、未確定数値、Cancelと1回の保存を検証。
- [x] React 16とwebpack4配布ビルドを維持。

最小の再実行コマンド（ビルド済みdistに対して）:

```sh
node node_modules/typescript/bin/tsc --noEmit
node --test test/layout.test.ts test/schema-presentation.test.ts test/schema-editor.test.ts test/schema-bundle-editor.test.ts test/source-view.test.ts test/source-prepared.test.ts test/react-dialog.test.ts test/webpack4.test.ts
node test/e2e/layout/browser.ts
# Optional: a built Camera Source checkout containing ./editor-metadata.
node test/e2e/layout/camera-dialog.ts /path/to/built/camera-source
```

ブラウザ検証はローカルHTTPとPlaywright Chromiumを使用し、実装された両経路の画面を `test-results/layout/desktop.png`・`mobile.png` に保存する。モックアップではない。ただし、この検証用ページは実TurboWarp GUI・実カメラ・packaged作品のE2Eを代替しない。

Playwright既定のブラウザがない環境では、`LAYOUT_CHROMIUM_EXECUTABLE` に検証対象のChromium実行ファイルを指定できる。

Camera Source検証は正本Schema・uiSchema・実データfixtureを共通 `BlockEditorDialog` に渡す。Source/Form・RJSFのProfile／Camera画面を `test-results/layout/camera-{source,rjsf}-{profile-,}after.png`、幅390pxの画面を `camera-{source,rjsf}-mobile-after.png` に保存する。モーダル枠は検証用ホストで、フォームのスタイルと操作は同梱コードそのもの。Schema固定項目の操作抑制、非表示エラーへの誘導、保存1回、Cancel時にcommitなしも確認する。

## ロールバック

ホストの `commonLayout` をfalseにしてサービスを再生成・アプリを再読込する。canonical Schemaと保存形式は変更していないため、保存済みJSON/YAMLの移行は不要。uiSchemaの宣言は旧ホストに残しても無視される。未保存draftを維持したままのホット切替は提供しないため、既存モーダルは保存またはCancelしてから再読込する。

## ローカル運用記録

- start: `feat/editor/common-form-layout` で #49 を実装。Camera Source #52は独立branchで並行実装し、layout契約確定後に接続検証。
- done: 共通契約・両描画経路・テスト・公式参照・ロールバックを追加。公開操作とGitHub Issueの更新は別途承認対象。
- 2026-10-20 検証: 対象107テスト中105成功、環境指定を要する既存の型・GUI能力検査2件はskip。プロジェクト型検査、webpack4ビルド、公開layout型consumer、Chromium/React 16での両描画経路・非表示エラー・数値入力保持・キー操作・幅390pxで1列・一括保存・フラグOFFを確認。Camera Source #52とのローカル接続4ケース（Source: twcs/legacy/ROS、RJSF: twcs）も成功。
- 2026-10-20 start（UI改善）: 利用者の指摘を受け、Schemaで確定する項目の操作抑制、余白・ラベル・タブ・グループ・グリッドの共通スタイルと、実データを使う再実行可能な画面検証を追加。既存の既定OFFフラグでまとめて切り戻せる。
- 2026-10-20 done（UI改善・local）: 対象113テスト成功、型検査・webpack4ビルド成功。追加の表示ポリシー検証では参照／union／固定tuple／任意項目／不正な型／明示タイトル／条件分岐／フラグOFFを確認。Chromiumで両経路の実Camera Sourceフォーム、非表示エラーのフォーカス、保存1回・Cancelでcommitなし、幅390pxの1列と横overflowなしを確認。検証用モーダルの枠以外は配布コードのスタイルで撮影。実TurboWarpアプリへの反映・公開は別工程。

## 0.3.0 の公開

共通レイアウトとSchemaに沿った表示を0.3.0として公開する。既定OFFを維持し、問題時はホストの `commonLayout` をfalseにして再読込する。旧版へ戻す場合は0.2.2にexact pinする。保存データの移行は不要。

## 0.3.1 の説明表示修正（#53）

RJSF と Source/Form 共通で、未指定・空文字・空白だけの description は表示しない。短い本文はそのまま表示し、長い本文は「説明を表示」の折りたたみと開閉マーカーから確認できる。Source/Form の aria-describedby も空の説明を参照しない。説明の有無でデータや保存処理は変わらない。

既定OFFの commonLayout を維持。切戻しはフラグOFF、または共通フォーム0.3.0と対応する GUI/site のピンへ戻して再デプロイする。保存データの移行は不要。

検証: 型を含むビルド、layout/source-view の50テスト成功。公開 Camera Source 0.18.0 のメタデータを用い、Chromium の両描画経路で説明なし項目の非表示・実本文の開閉・編集・保存・Cancel・非表示エラーのフォーカス・モバイル表示を確認。

## 0.3.2 の再公開（#53）

0.3.1 は npm CLI の成功終了後も公開APIで取得できず、再送は409（previously staged version）、stage listは空配列になった。npm/cli#9889 と同じ症状であり、0.3.1の再送・削除を避け、同じ修正を0.3.2として公開する。GUI/siteは公開APIと実際のtarballを確認した版を固定する。0.3.1向けのフォーム50テストと実画面検証はコードの差分がないため引き続き有効。ロールバック先は取得可能な0.3.0と対応するGUI/siteのピン。
