# 階層セッションと一括保存の追加 API

対象は [共通基盤 #2](https://github.com/kubohiroya/turbowarp-extension-data-editor/issues/2)。既存の `apiVersion: 1` の登録定義と本文 UI を使い、複数ノードの下書き・検証・変更案を集約します。GUI の探索・階層モーダル・実 workspace トランザクションは [scratch-gui #2](https://github.com/kubohiroya/scratch-gui/issues/2) で接続する契約です。現在の GUI が階層編集に対応済みという意味ではありません。

## 能力の交渉と開始

`BlockEditorHost.descendants` は任意の追加ポートです。`capability: 'descendant-editing-v1'`、同期の `readSubtree(reference)`、`commitSubtree(request)` を明示的に提供します。`supportsDescendantEditing(host)` はこの組み合わせを検査します。既存の `readBlock` / `commit` の意味は変わりません。

```js
import {supportsDescendantEditing} from '@kubohiroya/turbowarp-extension-data-editor';

// The GUI owns startup flags and all modal/save/close controls.
const useDescendants = flags.blockEditorDialogs && flags.blockEditorDescendants &&
  supportsDescendantEditing(host);
const session = useDescendants
  ? registry.openDescendants(reference, host)
  : registry.open(reference, host);
```

`openDescendants()` は未対応ホスト、存在しない範囲、編集 UI のない根に対して `undefined` を返します。不正な構造・上限超過は例外です。対応ホストで開始に失敗した場合に、エラーを隠して一部の単一編集へ切り替えてはいけません。フォールバックはフラグ OFF または能力未対応の場合に行います。単一 commit を複数回呼んで一括保存を代用しません。

コアはフラグの読み取りや GUI の初期化を行いません。上記 `flags` は GUI の起動時設定を指します。GUI は `src/lib/tw-feature-flags.js` へ `blockEditorDescendants` を起動時固定・既定 OFF として追加し、基盤フラグも有効な場合だけ使う設計です。このリポジトリの変更では GUI のフラグを追加・有効化しません。

## 完全な範囲のスナップショット

`SubtreeSnapshot` は `{targetId, blockId, generation, nodes}` を持ちます。`blockId` は根です。各ノードは `{block: BlockSnapshot, branches}`。`branches` は `{input, blockIds}` の配列で、statement 入力名と枝内の順序を表します。

```js
{
  targetId: 'sprite', blockId: 'root', generation: 'project-1/session-1',
  nodes: [
    {block: rootSnapshot, branches: [{input: 'SUBSTACK', blockIds: ['first', 'middle']}]},
    {block: firstSnapshot, branches: []},
    {block: unregisteredMiddleSnapshot, branches: [{input: 'SUBSTACK', blockIds: ['grandchild']}]},
    {block: grandchildSnapshot, branches: []}
  ]
}
```

ホストは根の statement/substack 入力から内側の列をたどり、列内の next と各ノード内の statement 枝を探索します。根自身の外側の next、接続 reporter は含めません。未登録の中間ノードも必ず含め、その内側の探索を継続します。parent ポインターだけでは範囲を決めません。

コアは Blockly/VM の表現を読みません。ホストが省略した実ブロックをコアだけで発見することはできないため、完全な探索と reporter の除外はホストの契約です。各ブロックの revision は、同じ ID の再作成、shadow の付け替え、固定値、reporter 接続、編集可能性の変更も反映してください。未登録ノードにも revision と枝構造が必要です。

`generation` は project/session の世代を表す不透明な文字列です。project 再読込、target 切替、編集セッションの失効時に更新し、同じ target / block ID が再利用されても同じ世代へ戻してはいけません。無効・非アクティブな根に対する読み取りは `null` を返します。

コアは全データを複製・凍結し、構造を根からの走査順に正規化します。重複 ID、二重接続、循環、異なる target、欠落した参照、切断されたノード、重複した入力名を拒否します。枝の名前・順序・ノードの順序も競合確認の対象です。

## 規模の上限

既定かつ上限は **500ノード・深さ32**。未登録ノードも件数に含み、根は1ノード・深さ0です。深さは statement 枝への入れ子数であり、同じ枝の next 列は深さを増やしません。`openDescendants(reference, host, {maxNodes, maxDepth})` で低い値に制限できます。`maxNodes` は1〜500、`maxDepth` は0〜32の整数です。

不正な構造や上限超過では `BlockEditorStructureError` を返すのではなく throw します。`code` は `invalid-structure` / `cycle` / `limit`。GUI は開始エラーとして表示し、対象を省略した「すべて保存」を提示しません。ホストの探索自体も循環・上限を検査し、部分的な snapshot を正常結果として返さないでください。

## ノードの本文と下書き

- `session.reference` と `session.generation` は対象の根・世代を保持します。
- `getNodes()` は全ノードの不変な記述子を走査順に返します。記述子は `reference`、`opcode`、`inputPath`、任意の `editor` を持ちます。
- `inputPath` は祖先ごとの `{blockId, input, index}`。未登録の中間ノードも含み、GUI は祖先の展開・項目への移動に使えます。同じ opcode の兄弟は block ID と経路で区別します。
- `getEditor(blockId)` は登録済みノードだけに本文用の API を返します。`getDraft` / `setDraft` / `setValidationIssues` / `getState` / `subscribe` / `mount` があり、独立した `save` / `cancel` / `dispose` やホストは渡しません。

`read(snapshot)` は各ノードにつき開始時に1回だけ呼びます。本文は `mount(container, context)` の既存契約で描画し、本文を unmount しても正本の下書き・エラーを保持します。折りたたみや遅延 mount はビューの寿命だけを変えます。古いビューの context は更新・購読を拒否し、ビューの購読を解除します。

各ノードの `getState()` は既存の `SessionState` です。全体の保存中は全ノードが `saving` となり、入力を拒否します。全体が `invalidated` の場合、既存フォームには `disposed` として通知します。全体の `getState()` は `DescendantSessionState` で、エラーをノードと `inputPath` へ対応づけます。`ValidationIssue.path` はフォーム内の項目、省略時はフォーム全体のエラーです。

標準 RJSF フォームは `div` を描画し、フィールド ID を mount ごとに分けます。本文にモーダルや保存ボタンはありません。GUI が1つのモーダルと1組の下部ボタンを所有し、全体の `canSave` を参照してください。非表示ノードの初回検証がまだ走っていなくても、実際の保存は必ず全ノードを検証します。

## 全体の保存と失敗

1. 全体を `saving` にし、二重保存と全ノードの変更を拒否します。
2. 表示状態によらず、すべての登録ノードの `validate` を実行します。1件でも問題があれば全ノードのエラーを集約し、commit せず `editing` に戻ります。
3. 全体が有効な場合だけ各 `createPatch` を呼びます。許可外・存在しない引数、reporter、重複書き込み、非有限値などを拒否します。変更先の block ID はコアが付与し、ノードの変更案から他ノードへの書き込みを指定できません。
4. `readSubtree()` で全体を再取得し、世代・全ノードの値・revision・枝構造と登録定義を照合します。未編集・未登録ノードの変更も対象です。
5. 変更があれば `commitSubtree({expected, changes, signal})` を1回だけ呼びます。各変更は `{blockId, argument, value}`。変更がなければ commit を呼ばず、dirty / Undo / Redo を変えません。
6. 成功後だけ `saved` として全ビュー・下書き・購読を解放します。競合は `conflict`、検証エラーは `invalid`、コールバック・適用失敗は `failed`。失敗時は全下書きを保持します。コールバック例外は `DescendantNodeError` に reference / inputPath / cause を持たせます。

ホストは**実書き込み境界でも**、signal、世代、全体の構造・値・編集可能性・登録状態を再確認してください。非同期の待機を挟む場合は待機後に確認します。通常の Blockly/Scratch イベント経路で画面・VM・キャッシュを同期し、全体を Undo/Redo 各1回にまとめます。イベントグループを非同期の検証・待機中に開き続けてはいけません。

グループ化だけでは原子性を保証しません。適用途中で例外が出た場合は、値・接続・dirty・Undo/Redo 履歴をすべて復元してから reject します。resolve は全体成功、reject は変更なしを意味します。コアは workspace を持たず、契約違反のホストの部分変更を復元できません。

## キャンセル・終了・無効化

`cancel()` / `dispose()` は全ノードをまとめて終了します。検証待ちでは即座に終了でき、保存の待機も `closed` で終了し、遅れて返る結果を破棄します。一括 commit を呼び出した後の通常終了は `false` を返し、ホストの原子的な完了を待ちます。

project / target の変更などはホストの `subscribeInvalidation(reference, listener)` または GUI からの `session.invalidate(reason)` で通知します。`invalidate` は検証・commit 待ちでも全体を `invalidated` にし、signal を abort してビュー・下書き・購読を解放します。進行中の `save()` は `invalidated` を返します。ホストは abort 後に遅延書き込みを行ってはいけません。書き込みが完了してから発生した外部の無効化で、過去に成功した変更をコアが取り消すことはありません。

登録解除や対象 opcode の登録定義変更はコアが検知し、全体を無効化します。未登録だった中間ノードへのエディター追加も対象です。無関係な opcode の登録は影響しません。初版の単一セッションは従来どおり開始時の定義を保持します。

## サンプル・検証・連携の残り

業務非依存の [サンプル](../examples/descendant-properties.ts) は group / item の同じ Schema フォームを複数ノードへ登録し、未登録の中間ノード、孫、複数枝を含む完全な snapshot を作ります。

`test/descendants.test.ts` は構造・下書き・全体検証・競合・無効化・一括 commit 契約を確認します。途中失敗の補償と Undo/Redo はメモリホストでの契約テストです。`test/schema-editor.test.ts` は実 RJSF 本文の入れ子構成、フィールド ID、unmount 後の孫の検証、1回の変更要求を確認します。

実 GUI の子孫探索、階層モーダル、フラグ、実 workspace の一括適用・失敗復元・Undo/Redo、階層編集した `.sb3` の実保存・再読込は scratch-gui #2 の接続後に結合確認が必要です。初版の検証結果を階層編集の実証として扱いません。この追加 API は結合確認前の実験的な契約です。

切戻しは GUI の `blockEditorDescendants` を OFF にして再読込し、単一編集へ戻します。`blockEditorDialogs` も OFF にすれば従来 GUI へ戻ります。UI、階層、下書き、generation は作品へ保存せず、確定値だけを通常の引数へ保存する契約を維持します。既定 ON への変更はこのタスクに含めません。
