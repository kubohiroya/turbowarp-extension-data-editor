# パッケージ配布と改名

対象: [改名・初回公開 #10](https://github.com/kubohiroya/turbowarp-extension-data-editor/issues/10)、[GUI移行 #19](https://github.com/kubohiroya/scratch-gui/issues/19)。

## 名前と互換性

リポジトリは `kubohiroya/turbowarp-extension-data-editor`、npm名は `@kubohiroya/turbowarp-extension-data-editor`。初回実験版は `0.1.0`。
旧 `turbowarp-block-editor` からの改名であり、ブロック定義ではなく拡張が扱う構造化データの編集を提供する。

公開入口はroot、`/rjsf`、`/react`、`/react/styles.css`、`/turbowarp`、`/webpack4`、`/build-info`、`/schema`の8つ。`/schema`はDOM・React不要のpure入口です。
既存の型・関数・`Scratch.gui.blockEditors`・起動時固定で既定OFFの機能フラグは維持する。
importと依存のキーだけを新npm名へ移し、GUIの`file:`依存を公開versionまたは検証済みGit完全SHAへ固定する。

## ソースの追跡

`pnpm build`はGit HEADの完全SHA、package名、version、repositoryを `dist/build-info.json` に記録する。
Node.jsでは `require('@kubohiroya/turbowarp-extension-data-editor/build-info')` で取得できる。
GUIのPagesビルドとE2E準備はこのSHAを使い、node_modules内にGit checkoutを要求しない。
統合CIは下流のTurboWarp-Plus-Editorが所有し、公開配布物のSHAと固定ソース設定を照合する。

公開前は変更をcommitして作業ツリーが空であることを確認する。`npm pack`のprepackはビルドを実行するため、必ず公開対象のcommit上でpackする。

`0.2.2`はPR #41の編集見出し・項目操作・key-value表示の修正を配布します。
旧`0.2.1`のworking-tree release overlayを示す固定`gitHead` / `x-turbowarp-source`は引き継がず、cleanな公開コミットから生成する`dist/build-info.json`をソース照合に使用します。
GUIのmanifestとlockをnpm完全versionへ揃えた後、TurboWarp-Plus-EditorのGUI pinと実配布物のcore revisionを更新します。
受け入れ基準は全共通テスト・実ScratchBlocks/VMの境界・8公開入口・tarball照合、GUIの対象テストとproduction build、公開前後のE2E成功です。

## 初回公開の検証（移管前の履歴）

- `pnpm typecheck`、`pnpm test`、`pnpm test:e2e:infrastructure`。
- `npm pack`で内容を確認し、tarballをGit checkout外のconsumerへinstallする。
- 全公開入口、webpack 4 helper、CSS、source metadataを確認する。
- 同じtarballを `npm publish <tarball> --access public` で公開する。
- GUIの依存とlockを公開版に揃え、関連単体テスト・Pagesテスト・アプリビルドと限定E2Eを確認する。

安定版の全対応環境検証を完了したという意味ではない。別セッションの未コミットSchema作業は初回公開に含めない。

## 切り戻し

ソース・GUI依存は対応コミットをrevertする。公開済みnpm版は削除せず、必要なら修正版を別versionで公開する。
旧リポジトリURLのredirectを保つため、旧名の新リポジトリを作らない。保存データ形式と既定OFFのフラグは変更しない。
