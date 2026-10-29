# 通常CI成功ゲート

本リポジトリはライブラリCIと、同リポジトリのActionsに限定したゲートの検証コードを管理します。
TurboWarp-Plus-Editorの統合ビルド・Pages・配信前後のE2Eは下流の [kubohiroya/turbowarp-plus-editor](https://github.com/kubohiroya/turbowarp-plus-editor) が所有します。本リポジトリはGUIを取得・ビルド・配信しません。

ゲートはrepo/head repo、workflow ID、event、branch、完全SHAと最新attemptを照合し、失敗・実行中・API確認不能を成功へ変換しません。
ゲート自身は読み取り専用です。判定を `normal-ci-gate-<run id>-<attempt>` のdecision.jsonとsummaryへ保存します。
境界のローカル検証は `node --test test/ci/*.test.mjs` です。

下流GUIのbranchやPagesの観測は廃止しました。CI再実行の検証は、このリポジトリのfixture・observerの証跡と権限だけで完結します。

## 最新attemptの自動実検証

共通側の `ci-gate-rerun-test.yml` は必要なときに手動で起動します。定期起動は設定しません。同一SHA・同一CI runの3 attemptと4つの読み取り専用observerを自動で検査します。GUIの変更、通常CIの書換え、一時branchの作成/削除、PATの登録は不要です。

```sh
gh workflow run ci-gate-rerun-test.yml \
  --repo kubohiroya/turbowarp-extension-data-editor --ref main
```

統括・fixture・observerは手動dispatchのみです。実GitHubテストをpush/PRから自動起動しません。通常CIは既存の `node --test test/ci/*.test.mjs` により、統括ロジック・fixture・誤run/attempt・権限境界・timeout等のローカルテストを実行します。変更時の通常CIと、必要時の手動検証で運用します。

### 確認する順序

1. 専用fixtureの初回attemptを成功させ、baseline observerが通過することを確認。
2. 同じfixture runを再実行。最新attempt 2実行中に、CI状態をobserver job取得の前後で照合し、ゲートが待機中で後続sentinelが未開始であることを確認。
3. attempt 2を意図的に失敗させ、ゲートが最新failureを拒否し、後続がskipされることを確認。失敗後に新しく起動するobserverでも古いsuccessを採用しないことを確認。
4. 同じrunをattempt 3へ再実行。実行中は待機し、最新successの後だけ通過することを確認。CI終了→ゲートの観測→ゲート完了→後続開始の時刻順序も検査。

fixtureは `ci-gate-rerun-fixture.yml` の専用workflowで、通常CIとは別です。観測用の待機はattempt 2/3で各180秒、fixture jobは5分上限です。テスト全体の待機上限は25分、統括jobは35分上限。runner混雑により実行中の観測窓を逃した場合は成功扱いせず失敗させ、summary/evidenceを確認してsuiteを再実行します。

統括のconcurrencyはrepository/ref単位で直列です。親run ID/attemptからsuite IDを作り、子runのworkflow ID・title・repo/head repo・SHA・branch・eventを照合します。子workflowの初回起動は新しいrun、fixture再実行だけは同じrunのattempt 2/3です。branchが途中で進んだ場合や、別fixture runが割り込んだ場合は拒否します。

### 権限と証跡

統括jobだけが `contents: read` / `actions: write` を持ちます。Actionsのwrite権限はrepo単位ですが、統括コードはこの共通repoと専用のfixture/observer workflowに限定し、自分で生成・照合したfixture runだけを再実行します。GUIを対象にできず、git/contentsへのwriteもありません。

fixture、observer、呼び出す公開ゲートはread-onlyです。すべての経路にPages/OIDCのwrite権限・environment・deploy処理はありません。sentinelは依存関係を確かめるためのログ出力だけです。新たなCI起動と再実行は統括へ置き、公開ゲートAPI自身のread-onlyという責務を維持します。

observerの `assert-probe` がゲートのJSON artifactを読み、fixture run ID・完全SHA・最新attempt・結論を再照合します。統括はassert-probeの成功と構造化proofを確認し、API snapshotと時刻順序も照合します。ログのダウンロード先へGitHub tokenを転送しません。

- 親run: `ci-rerun-test-<run ID>-<attempt>` artifactに途中経過を含む `evidence.json`、summaryに結果とfixture runリンク。
- 子observer: 既存の `normal-ci-gate-<run ID>-1` と `ci-rerun-proof-<run ID>-1` artifactに判断と照合結果。
- artifactの保持は7日。意図した負の対照は子workflow全体がfailureになりますが、assert-probeがsuccessであることを親が検査し、suite全体はsuccessとなります。

失敗時にも途中のrun ID・API観測・理由を保存します。自動のbranch削除や他workflowのcancel/retryは行いません。親が失敗しても子workflowはそれぞれのtimeout内で終了し、実公開には影響しません。実公開版のE2Eやdeploymentはこのsuiteで起動しません。

[workflow_dispatchはGITHUB_TOKENからも子workflowを起動できる](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)仕組みを使います。公開後E2Eや通常CIへの呼出しは追加しません。

手動suite全体を止める場合は統括workflowを無効化します。GUIの固定SHA、アプリ配布版、公開ゲートの運用は変更不要です。

## 過去のschedule証跡の検証

`ci-gate-rerun-report.yml` は過去のschedule run IDを手動指定して証跡を照合するために保持します。workflow_runによる自動起動は行いません。現在の運用ではscheduleの初回確認や自動Issue報告は不要です。

記録jobは `CI_RERUN_REPORT_ENABLED` 未設定またはfalseで停止します。通常はOFFとし、将来明示的に利用する場合も標準GITHUB_TOKENで同repoの固定Issue #26へ記録する範囲に限定します。App/PAT/秘密鍵は使いません。検証jobはcontents:read/actions:read、記録jobのみIssues:writeで、Pages/OIDCやコードwriteはありません。

```sh
gh workflow run ci-gate-rerun-report.yml \
  --repo kubohiroya/turbowarp-extension-data-editor --ref main \
  -f run_id=<historical-scheduled-run-id>
```

定期実行を再導入する場合は別途判断します。今回の公開移行・通常CI・公開ゲートにscheduleの稼働は必要ありません。
