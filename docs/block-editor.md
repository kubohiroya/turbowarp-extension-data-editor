# 拡張ブロック編集の接続と受け入れ確認

現行GUIの編集機能は標準ONです。有効化用URLスイッチは撤去しました。旧フラグの説明は段階導入時の履歴で、現在の起動・切戻し方法は[README](../README.ja.md#標準動作とロールバック)に従ってください。

対象: [scratch-gui #1](https://github.com/kubohiroya/scratch-gui/issues/1)、依存: [共通 API #1](https://github.com/kubohiroya/turbowarp-extension-data-editor/issues/1)。
基盤はPR #3で`develop`へ、YAML互換はPR #5、初版受け入れ修正はPR #6で`feat/site/github-pages`へ統合しました。
開発の統合先である`develop`にも、公開ブランチのYAML互換・受け入れ修正とPages配信機構を取り込んでいます。
初版の検証記録は当時の`fix/editor/issue-1-acceptance`とサイト用ブランチを対象にした履歴です。
共通APIの固定参照は、scratch-guiの `.github/workflows/node.js.yml` / `pages.yml` / `block-editor-public.yml` で管理します。CI・公開版E2Eの手順は[共通E2Eガイド](block-editor-e2e.md)を参照してください。
ローカル受け入れ結果と公開状態は[検証記録](block-editor-acceptance.md)を参照してください。
Issue #2の階層編集は別の既定OFFフラグで追加しています。[階層編集の仕様と検証](block-editor-descendants.md)を参照してください。

## 起動

以下の `src/`・`test/`・`.github/` はscratch-gui内のパスです。GUI用コマンドはscratch-guiのルートで実行します。

Node.js 22.18 以降を使い、両リポジトリを同じ親ディレクトリへ置きます。
共通 API を先に `pnpm install`、`pnpm build` でビルドします。
GUIは `@kubohiroya/turbowarp-extension-data-editor` の公開版を固定versionで参照します。`npm ci`で配布物を取得でき、共通リポジトリのローカルリンクは不要です。

```sh
npm ci --ignore-scripts --no-audit --no-fund
node scripts/prepublish.mjs
CI=1 NODE_OPTIONS=--openssl-legacy-provider PORT=8000 npm start -- --host 127.0.0.1
```

`prepublish.mjs` は既存の micro:bit アセット生成です。レジストリへの公開は行いません。
webpack 4 のため Node の OpenSSL 互換設定が必要です。
[webpack 4互換配布物と設定API](webpack4.md)がRJSF/YAMLの変換とGUIのReact共有を担当します。GUIは共通設定APIを呼び出します。

次の URL でサンプルを読み込み、カテゴリ「Block editor demo」のブロックを配置します。
配置済みブロックのアイコンをクリックすると、label / duration のフォームが開きます。

<http://localhost:8000/editor.html?blockEditorDialogs=1&extension=http%3A%2F%2Flocalhost%3A8000%2Fstatic%2Fextensions%2Fblock-editor.js>

## 拡張作者向け API

unsandboxed 拡張の `Scratch.gui.blockEditors.register()` に `apiVersion: 1`、`extensionId`、`editorId`、完全な `opcodes`、保存先 `argument`、`schema`、任意の `uiSchema` を渡します。
`mount` の指定がなければ RJSF による標準フォームを使います。明示的な `registerSchema()` もあります。
例はscratch-guiの `src/examples/extensions/block-editor.js`、共通仕様は[APIとホスト契約](api.md)を参照してください。
`uiSchema` は JSON の指定に限定します。独自 widget などの関数を渡す場合は独自 `mount` を実装してください。
Schema が不正な場合や参照を解決できない場合は登録を拒否します。

入力のたびにスキーマを検証し、invalid では Save を無効化します。保存時も再検証してから適用します。
任意の `validateData` は保存時の追加の非同期検証です。その待機中は保存・閉じる・編集を抑止します。
保存成功以外は下書きを保持し、Cancel / Escape / 閉じるは下書きだけ破棄します。

## 適用範囲と受け入れ基準

- 起動時固定フラグは `src/lib/tw-feature-flags.js` の `blockEditorDialogs`。既定 OFF、値 `1` の場合だけ有効。
- 配置済み・編集可能・登録 opcode の既存アイコンだけに入口を付与。クリック、Enter、Space で開く。
- 通常の text shadow に保存された JSON/YAML 文字列を編集。reporter、メニュー、独自 validator は変更対象外。
- 開いている間は元ブロックを変更しない。保存時は revision / target / 引数の一致を再確認。
- 保存は Blockly のイベント経路で画面と VM を同期し、Undo/Redo 各1回。適用途中の失敗は値と履歴を復元。
- Schema に違反する入力は保存できない。キャンセルは dirty と履歴を変更しない。
- フラグ OFF の通常操作で登録 API、入口、モーダルを作らない。

`.sb3` の実保存・標準 `project_url` 経路での再読込を確認済みです。[検証ログ](block-editor-sb3-validation.md) を参照してください。
既存アイコンだけを入口とする初版です。アイコンなしのブロックへホストのアイコンを追加する機能は含めません。
代表的な明色/暗色、日本語/英語、倍率60%/100%/150%とproductionビルドを確認しています。
OSのネイティブpicker、全テーマ・全言語・全対応環境の組合せはリリース前検証と区別します。APIは実験的v1のままです。

## invalid項目の表示

[Issue #14](https://github.com/kubohiroya/scratch-gui/issues/14)では、単一・階層編集の標準RJSFフォームで、invalidな入力欄だけを赤枠・薄い赤背景で強調します。既存の項目別説明を赤系の説明領域に表示し、各階層の元ブロックの名前・アイコン・背景色・枠線を維持します。有効な兄弟・子項目にはエラー色を付けません。オブジェクト／配列全体の制約違反は、そのグループの説明領域で示します。

初期データの検証と既存のlive validationに追従し、validに直すと強調を解除します。階層を折りたたんで再展開した場合も状態を再反映し、全体のエラー案内から展開・フォーカス移動できます。入力中のフォーカス表示と、invalid時の保存抑止は従来どおりです。

共通パッケージの`/react`にある項目表示処理はモーダル本文内のRJSFの項目別エラーDOMを監視し、入力欄の`aria-invalid`と`aria-describedby`を補完します。グループ制約は子の入力欄ではなくグループに対応づけます。validへの修正や終了時には補完した属性を復元し、監視を解除します。RJSF側が更新した属性は上書きせず、配列を並べ替えて項目IDが変わった場合も現在の説明を参照します。検証ルールやメッセージを再実装せず、カスタム非RJSFフォームは対象外です。

明色／暗色それぞれの`block-editor-error-border`、`block-editor-error-text`、`block-editor-error-tint`を使います。既存の起動時固定・既定OFFの`blockEditorDialogs`配下で動作し、階層編集は`blockEditorDescendants`に従います。フラグの正本は`src/lib/tw-feature-flags.js`です。共通API、スキーマ、保存形式の変更やデータ移行はありません。

RJSF 5.24.13の標準DOM（`.rjsf`、`.field.has-error`、`.error-detail`と項目別ID）を利用します。RJSFやテンプレート更新時は、子項目とグループの区別、説明への参照、配列の並べ替えを対象テストと実画面で確認してください。表示だけ切り戻す場合は、本Issueのアダプター・モーダル接続・CSS・テーマ定義をrevertし、スキーマ検証と保存抑止を維持します。機能全体は`blockEditorDialogs=1`を外して再読込すれば無効化できます。

### Issue #14のローカル検証（2026-10-18）

- `node --test test/unit/block-editor/modal.test.mjs`: 18件成功。実RJSFで初期invalid、必須・数値範囲・列挙値・パターン、入れ子、配列／オブジェクトのグループ制約、validへの修正、フォーカス、折りたたみ・再展開、監視解除、配列の並べ替え後の説明参照を確認。
- 変更したJS/JSXのESLint、`git diff --check`、開発用webpackのコンパイル成功。
- Chromiumの実画面で明色／暗色、異なる拡張の親子孫と有効な兄弟、単一フォームを確認。赤枠・薄い背景・説明文とブロック由来の装飾・フォーカス表示を目視し、配列の要素数エラー、修正後の解除、折りたたんだ項目へのエラー案内も確認。
- 入力中にVMを変更せず、invalid時の保存無効化、キャンセルで元データ維持、validな一括保存とUndo/Redo各1回を確認。画面確認用拡張は一時的なdata URIを用い、配布サンプルは変更していません。

これはローカル開発環境での限定検証です。公開ブランチへの反映、CI、GitHub Pages配信の確認は含みません。

## 限定検証とロールバック

```sh
npm run test:block-editor
```

実 ScratchBlocks / VM で適用・復元・Undo/Redo、実 ReactModal でポータルと保存状態、登録 API のスキーマ検証を確認します。
共通パッケージのテストでは RJSF の実入力と初期値、必須・型・範囲、非同期追加検証も確認します。
手動では上の URL で invalid 時の無効化、valid の保存、Cancel、Undo/Redo を確認します。
フラグを外した URL では入口が増えないことを確認します。

ロールバックは `blockEditorDialogs=1` を URL から外して再読込します。保存済み JSON/YAML 文字列は通常のブロック引数として残ります。
フラグを既定 ON に変更する前に `.sb3` と対応環境の回帰検証が必要です。

## upstream更新時の確認点

1. `tw-block-editor-bridge.js`の入口は、既知のブロックの先頭`FieldImage`と`fieldGroup_`だけを扱います。`inputList`、`isEditable()`、flyout/read-onlyの判定、SVGのフォーカス・pointer captureが維持されるか確認してください。アイコン以外のドラッグとクリック実行を両方試します。
2. `tw-block-editor-host.js`は通常の`text` shadowと標準`FieldTextInput`だけを更新します。validator、reporter、メニューへの接続、未反映のBlocklyイベントを受け入れないことを維持します。
3. `workspace.fireChangeListener`からVMの通常イベント経路へ通知する前提と、`Events.getGroup()`・`recordUndo`・`undoStack_`・`redoStack_`を確認します。非同期検証中に共有イベントグループを開きません。複数引数の保存とsetter/listener途中失敗のテストで、値・VM・dirty・Undo/Redoの復元を確認します。
4. target、block、shadow、field、VM blockの同一性とrevisionを保存直前に照合します。別作品の読込、target切替、削除、登録解除、遅い検証結果を組み合わせて確認します。ホスト自身の同期transaction中は外部変更による無効化と区別し、適用失敗時の下書きを保持します。
5. GUIのReact/ReactDOMを共通フォームと共有し、ReactModalのportal生成後に入力へフォーカスを移します。Cancel/Escape/閉じる/背景クリック、フォーカス復帰、Tab、composition中のEnter/Escapeと通常の複数行入力を確認します。本文とエラーだけがスクロールし、フッターへ到達できることも確認します。
6. React全体の更新や新しいBlockly APIを前提にしません。共通API更新時は通常CIとPagesの固定SHAをそろえ、共通のwebpack 4互換配布物、登録境界、型検査・ビルド・対象結合テストを確認します。未公開の`0.0.0`や`apiVersion: 1`だけを対応版の識別子にしません。
7. 明色/暗色、日英、代表倍率で、編集アイコン・通常操作・エラー・保存中表示を確認します。起動時固定フラグの正本は`src/lib/tw-feature-flags.js`です。既定OFFを維持し、OFFの別ページで保存済み作品の値と通常実行を確認します。

## 実行中の保存

モーダルは作品を停止せず、下書きを実行へ反映しません。インタープリタでは保存とUndo/Redoの確定値を実行中に読み取れます。
TurboWarpのコンパイラ有効時は、通常の引数編集と同様、既に走っているコンパイル済みスクリプトが開始時の値を使い続ける場合があります。次の実行で確定値を使うことを比較確認しています。専用エディターからスクリプトを自動で停止・再起動しません。

対象を無効化したときに非同期検証が残っていても、ホストのsnapshot照合でcommitを拒否します。通常終了とは区別し、検証が解決した時点で古いセッション・ビューを解放します。非同期検証は呼び出し側が完了するPromiseを返す契約です。

## 専用UI・登録サービスの責務分割（GUI #15 / 共通 #7）

共通パッケージの `/react` がダイアログ・階層ツリー・保存/キャンセル・エラー表示を提供し、
`/rjsf` の `createBlockEditorService()` がSchema検出と登録/解除・通知を担当します。
GUIの `tw-block-editor-modal.jsx` は既存Modal、翻訳文言、テーマCSS変数、エラーログを注入する接続です。
`tw-block-editor-service.js` はVMごとのWeakMap保持だけを担当します。
専用CSS本体は共通側の `/react/styles.css` をCSS Modules（camelCase）で読み込みます。
GUIのCSSにはテーマ変数だけを残します。React/ReactDOMの実体は共通のwebpack設定APIで共有します。

API v1の本文mount、起動時固定/既定OFFのフラグ、text shadowのJSON/YAML保存形式を維持します。
Blockly/VMアダプター・アイコン・階層探索・Undo/Redo/rollbackは共通側の `/turbowarp` に移管しました。
GUIは `attachTurboWarpBlockEditors()` へ実体とフラグ・画面コールバックを渡し、unmountでdisposeします。
既定OFF・破棄の冪等性・別workspaceの独立性はアダプターAPIで保証します。
webpack 4向け配布物・設定APIとE2E本体も共通側へ集約しています。GUIには設定APIと共通CI手順の呼出しを残します。
ロールバックはGUI接続と共通追加を対で戻し、以前の共通版とGUI内UIへ復帰します。
即時停止は `blockEditorDialogs` をOFFにして再読込します。

結合検証は[共通側のE2E runner](block-editor-e2e.md)からGUIのローカルPages形式ビルドまたは公開URLへ接続します。
公開版の結果と混同せず、両リポジトリの基準SHA・未コミット変更・ブラウザ・読込経路をIssueに記録します。
