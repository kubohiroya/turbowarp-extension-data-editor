# Template用途依存からの試験分離

owner横断検証は14契約・8packageです。Templateの旧2サンプルは対象外にしました。JSON/YAML編集の任意サンプルはexamples/document-properties.mjs、対応する実serviceの試験はtest/generic-document.test.mjsで所有します。Templateやその公開APIをimportしません。

例には任意のtext/enabledと追加キーを使用します。required/defaultや業務条件はありません。新たなpackage exportや標準ブロックは追加せず、examplesはnpm配布APIにしません。登録は呼出側が明示的に行います。

旧16契約・9packageという過去結果は変更しません。旧2入力とprovenanceはtest/fixtures/schema-stage1/historyへ保持しました。共通src・8公開入口・依存pin/lock・CSS/buildは変更しません。

`docs/schema-stage1-contracts.json`は旧16契約の採取結果として保持します。現行の件数の正本は実行する`scripts/verify-schema-stage1.ts`であり、Templateのない8packageのisolation indexを渡して検証します。今回の結果・依存照合はTemplate側のローカル集約記録に保存し、過去結果を上書きしません。

<a id="current-verification"></a>

## 現行の再検証手順（14契約・8package）

対象は共通エディタと7つの実拡張packageです。Templateの`./editor-schema`は撤去済みで、共通依存も持ちません。Templateをこの手順のownerやindexに含めないでください。Template自体のhello/build/manifestはTemplate側で別に検証します。

まず各ownerの採用commit・依存pin/lock・実解決を確認し、その版のbuild生成物を用意します。共通repoの`scripts/verify-schema-package.ts`を各owner checkoutをcwdとして実行し、pure入口に必要なruntime依存だけを引数で指定します。共通自身の入口は`/schema`、7拡張の入口は`/editor-schema`です。新たな公開・install・依存更新を暗黙に行う手順ではありません。既存の検証済みartifactを使う場合も、その採取時のSHA・hash・実解決を確認します。

検証成功ログの`isolated:`に出力されたディレクトリを、次の**8 keyだけ**へ対応付けて`isolation-index.json`を作成します。値は例示なので、実際のsource-free package検証先の絶対パスへ置き換えてください。

```json
{
  "editor": "/path/to/isolated-editor",
  "aframe": "/path/to/isolated-aframe",
  "scene-graph": "/path/to/isolated-scene-graph",
  "3d-scene-runtime": "/path/to/isolated-3d-scene-runtime",
  "camera-source": "/path/to/isolated-camera-source",
  "camera-calibration": "/path/to/isolated-camera-calibration",
  "realtime-motion-capture": "/path/to/isolated-realtime-motion-capture",
  "time-space-sync": "/path/to/isolated-time-space-sync"
}
```

共通repoをcwdとして、同じindexで両方を実行します。

```sh
node scripts/verify-schema-stage1.ts /path/to/isolation-index.json
node scripts/verify-schema-dependencies.ts /path/to/isolation-index.json
```

前者は`contracts: 14`・`packageCount: 8`と各契約の成功を確認します。後者はScene Graph→Runtime、Camera Source→Calibration/Motionの実bundle一致と、7consumerの共通pureファイル一致を確認します。失敗したownerをindexから落として成功扱いにせず、依存pin・lock・実解決・生成物を確認してください。

この14契約は現行の本番owner契約です。共通examplesのJSON/YAML試験やTemplateのhello試験を本番契約へ足しません。段階2で新設予定の9固定契約は未実装の別計画で、現行検証が成功しても追加9件の実装済みを意味しません。旧16契約・9packageの再現にはその時点の旧commit/artifactを使い、ここに新Templateを混ぜません。過去の採取結果・手順は履歴として保持します。
