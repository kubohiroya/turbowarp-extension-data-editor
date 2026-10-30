# ブロックのプレビュー

`Scratch.gui.blockEditors.registerPreview` は、既存フォームと同じ編集セッションにプレビューを併設するための任意APIです。APIがないホストやプレビューが登録されていないブロックの動作は変わりません。ホストは既存の起動時設定でエディター自体の有効・無効を管理します。

```js
const api = Scratch.gui?.blockEditors;
const unregister = api?.registerPreview?.({
  extensionId: 'story',
  opcodes: ['story_scene'],
  mount(container, context, snapshot) {
    // The visual and the existing form share a draft; no direct VM writes are allowed.
    const stop = context.subscribe(() => {
      if (context.getState().status === 'editing') {
        updateVisual(context.getDraft());
      }
    });
    return () => {
      stop();
      releaseVisual(container);
    };
  },
  hover(anchor, snapshot) {
    const controller = new AbortController();
    showStillPreview(anchor, snapshot, controller.signal);
    return () => {
      controller.abort();
      hideStillPreview();
    };
  },
});
```

`mount` と `hover` は同期的に解放関数を返します。内部で非同期処理を開始する場合、その処理のキャンセルと作成済みリソースの解放は登録側が所有します。古い処理の結果で、新しい下書きの画面や破棄済み画面を更新しないでください。

`mount` の `context` は既存フォームと共有されます。配置ドラッグなどの操作は `context.setDraft()` へ反映します。既存フォームの検証・保存パッチ・保存ボタン・Cancelが引き続き唯一の永続化経路となり、保存時の競合判定とUndo/Redoのトランザクションを維持します。プレビュー登録だけのブロックは読み取り専用であり、保存パッチを作成しません。数値やメニューの編集が必要な場合は、別途 `registerFixedInputEditor` で入力の契約を登録します。

`context.getSnapshot()` と第3引数 `snapshot` は、開始時点で取得した不変のブロック情報です。固定入力のスナップショットには元の `fixedContext` も含まれます。編集用データへ識別情報を混ぜたり、識別情報を作品データへ保存したりする必要はありません。

既存フォームの登録前にプレビューを登録することもできます。フォームが後から登録された場合、以降のセッションではフォームとプレビューを組み合わせます。プレビュー登録は同一opcodeについて1つです。解除は冪等で、元のフォームを解除しません。

TurboWarp連携はアイコンのpointer enter/leaveとfocus/blurに応じて `hover` を開始・解放します。クリックによる編集開始、対象変更、ワークスペース変更、登録変更、連携の破棄でも表示中のホバーを解放します。プレビューがあるアイコンは、子孫編集が有効でもそのブロックだけのセッションを開きます。sceneのクリックからすべての子actionのプレビュー環境を同時作成することはありません。プレビューのない既存ブロックの子孫編集は従来どおりです。

ロールバックはプレビュー登録の解除、既存のEditor有効化設定のOFF、またはこのAPIを使わない既知の配布物への復帰です。作品データの移行は不要です。

プレビュー付きの本文は、画面幅900px以上ではプレビューとフォームを横に並べます。長いフォームをスクロールしても、プレビューは列の上端に追従します。幅が狭い画面では縦並びへ戻ります。フォームがない読み取り専用プレビューは1列を使い、プレビューのないフォームの本文構造は変更しません。
