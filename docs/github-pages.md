# GitHub Pages提供の廃止とTurboWarp-Plus-Editorへの移管

本ライブラリのGitHub Pages提供は廃止します。旧URLでEditorやリダイレクトを提供しません。
ライブラリのnpm公開、API、単体テストは維持します。

統合Editorの正式名称は **TurboWarp-Plus-Editor** です。ビルド・統合E2E・GitHub Pages配信は、下流の [kubohiroya/turbowarp-plus-editor](https://github.com/kubohiroya/turbowarp-plus-editor) が所有します。

- 案内画面: https://kubohiroya.github.io/turbowarp-plus-editor/
- Editor: https://kubohiroya.github.io/turbowarp-plus-editor/editor.html
- 固定GUI/coreのソース設定・公開手順・再利用できる編集ボタン: [TurboWarp-Plus-EditorのREADME](https://github.com/kubohiroya/turbowarp-plus-editor#edit-button)

## 責務

本リポジトリのCIはライブラリと互換配布物を検証します。下流GUIの取得・ビルド・配信・統合E2Eを実行しません。
GUIのコードはscratch-guiフォークが所有し、そのGUIにライブラリを組み込んだ静的Editorの配布をTurboWarp-Plus-Editorが担当します。

`site/`、`scripts/site/`、GUI統合E2E、GUI用composite action、Pages/配信後検証workflowを本リポジトリから除去します。
同リポジトリ内のCI再実行・ゲート検証は維持し、下流GUIやPagesの稼働を前提にしません。

## 移行の確認

1. TurboWarp-Plus-Editorのビルド・統合E2E・Pages配信と、作品URLを指定した読み込みを確認します。
2. README・Docs・Samplesの入口を新しい編集ボタンへ更新します。`project_url`と`lang`は新URLへ渡します。
3. 本リポジトリのPagesをUnpublishし、GitHub Pages設定そのものを無効化します。workflow削除だけでは既存の公開ファイルは消えません。
4. 旧URLがEditorを配信していないことと、新URLが固定ソースどおりの版を配信することを確認します。

## DoD・切戻し

DoDは、上流に下流GUIを取得するビルド/配信処理がないこと、npmライブラリ検証が成功すること、新サイトと参照先の移行、旧Pagesの停止です。

問題があればTurboWarp-Plus-Editor側の固定ソース設定を直前の検証済み版へ戻して再配信します。
本ライブラリの配信workflowや旧Pagesを復活させず、npmの既存版やSB3の保存形式を変更しません。
