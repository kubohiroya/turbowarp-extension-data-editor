# ドキュメント一覧

本リポジトリはライブラリAPIとホスト接続の文書を管理します。統合Editorのビルド・E2E・配信手順は下流の[TurboWarp-Plus-Editor](https://github.com/kubohiroya/turbowarp-plus-editor)で管理します。

## 利用・GUI接続・公開

- [GUIの起動・専用編集・制約](block-editor.md)
- [子孫ブロックの一括編集](block-editor-descendants.md)
- [GitHub Pages廃止とTurboWarp-Plus-Editorへの移管](github-pages.md)
- [専用エディターと.sb3の継続E2E・CI](block-editor-e2e.md)

GUI接続ガイドの `src/` とホスト接続用コマンドはscratch-guiのパスです。共通API用コマンドは本リポジトリ、統合E2Eと配信コマンドはTurboWarp-Plus-Editorで実行します。通常のライブラリ検証に隣接GUI checkoutは不要です。

## 共通APIとアダプター

- [APIとホスト契約](api.md)
- [タブ・グループ・グリッドの共通レイアウト（既定OFF）](common-layout.ja.md)
- [階層セッションの契約](descendants.md)
- [TurboWarpアダプターAPI](turbowarp-adapter.md)
- [webpack 4互換配布物と設定API](webpack4.md)

## 検証記録

- [初版の受け入れ確認](block-editor-acceptance.md)
- [.sb3保存・再読込の初期検証](block-editor-sb3-validation.md)
- [Issue #12 公開配信後E2Eの画像・実測JSON](editor/issue-12-public-validation/README.md)

過去の記録にあるSHA・テスト件数・未確認項目は、その検証時点の結果です。最新の実装・CI・公開状況は[共通 #7](https://github.com/kubohiroya/turbowarp-extension-data-editor/issues/7)、[GUI #15](https://github.com/kubohiroya/scratch-gui/issues/15)、[E2E #12](https://github.com/kubohiroya/scratch-gui/issues/12)で管理します。
