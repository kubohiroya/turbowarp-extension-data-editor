# 共通編集ダイアログの移動・サイズ変更

関連: [共通UI契約 Issue #7](https://github.com/kubohiroya/turbowarp-extension-data-editor/issues/7)。2026-10-31のユーザー追加依頼によるローカル変更で、作業ブランチは `fix/ui/dialog-window` です。ユーザーの追加承認に基づき、今回の差分のcommit・push・PR作成・CI成功後のSquash Merge・npm/GitHub Release公開を行います。

`BlockEditorDialog` の単一編集・階層編集に共通して、次の操作を提供します。

- タイトルのドラッグで移動。
- 四辺・四隅のドラッグでサイズ変更。
- Xの左の「全画面化」でブラウザー内いっぱいに最大化し、「元のサイズに戻す」で以前の位置・サイズへ復元。

画面外への移動を制限し、最小サイズは360×280px、画面が小さい場合は画面内に収めます。本文はスクロールし、ヘッダーと保存・キャンセルは固定表示します。操作中もフォームを再mountせず、草稿・展開状態・編集セッションを保持します。閉じるとポインターと画面サイズ変更の監視を解放します。

ホストは従来どおり `ModalComponent` とCSSの対応表を注入します。モーダルの `role="dialog"` と、`headerClassName` または `header` 要素を使い、GUI内部をimportしません。共通コアへのReact依存も追加しません。`EditorDialogMessages.maximize`・`restore` は任意で、未指定の場合は画面の言語属性、URLの `lang`、ブラウザー言語から日本語／英語を選びます。

依存順は、既存共通UI→ウィンドウ操作とCSS→ホストの組み込みビルド→実Editor確認です。既存の `blockEditorDialogs` 等のフラグ運用を維持します。

## 受け入れ基準・検証

- [x] 単一・階層の両編集で移動・四辺四隅のリサイズ・最大化と復元ができる。
- [x] ウィンドウ操作でフォームを再mountせず、入力中の草稿を保持する。
- [x] 保存は既存のセッション経由で反映し、キャンセルでは変更を破棄する。
- [x] 最小サイズ・320px幅・390px幅でも閉じる・保存・キャンセルを操作できる。
- [x] 日英のボタン名、キーボードでの最大化、破棄時の監視解除を確認する。
- [x] 型検査・配布ビルド・既存ダイアログ表示テスト・実Editorの固定入力保存を確認する。

```sh
npm run build
node --test test/react-dialog.test.mjs test/fixed-dialog.test.mjs
node --test test/e2e/layout/dialog-window.mjs
```

## 運用ログ（2026-10-31 JST）

- start: 0.6.0の共通UIを基点に隔離ブランチで着手。元checkoutの既存WIPは保持。
- blocked: 初回の型検査でDOM要素のnull絞り込み、ブラウザー試験で初期高さと画面境界の条件を検出し、修正。
- done: 型検査と配布ビルド、既存表示4件・ウィンドウ操作のブラウザー4件が成功。画面サイズ変更の検証はresizeイベントの反映を待って確認。
- done: 実Editorの固定入力を10→37.5へ編集し、移動・最大化・狭幅・復元後の保存に成功。ページ例外0。

## 切戻し

即時の機能停止はホストの `blockEditorDialogs` をOFFにして再起動します。ウィンドウ操作だけを戻す場合は、本差分の `react.tsx`・`react.css`・`dialog-window.ts` を揃えて戻して共通配布物とホストを再ビルドします。保存済みの引数形式とSB3は変更しません。

## 公開手順（2026-10-31 JST）

- branch: `fix/ui/dialog-window` / base: `main`。対象は共通UI・CSS・型・関連テスト・CIと0.7.0の版更新。
- 直列: data-editor CI→Squash Merge→main CI→v0.7.0のRelease/npm公開→Editorの固定依存更新・公開。
- 既存結果の前提を維持し、今回追加した4ブラウザーケースを通常CIでも実行します。
- 受け入れ基準: 両CIとRelease成功、npmの版・merge revision一致、公開Editorで両ダイアログ操作を確認。
- ロールバック: Editorの固定core版を0.6.0へ戻し、対応する固定SHAと一緒に再配信。元SB3と作業ファイルは保持。
- start: ユーザーが今回の2リポジトリの公開操作を明示承認。
