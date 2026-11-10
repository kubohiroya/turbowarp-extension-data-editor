import * as React from 'react';

/** Explicit schema/ui titles remain untouched; fallback property keys become readable labels. */
export function propertyLabel(key: string): string {
  if (/^[a-z]{1,3}$/.test(key)) return key;
  const text = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b(id|uri|url|json)\b/gi, word => word.toUpperCase());
  return text ? text[0]!.toUpperCase() + text.slice(1) : '設定';
}

export function FormHelp({description, id}: {description: unknown; id?: string}): React.ReactElement | null {
  if (typeof description !== 'string' || !description.trim()) return null;
  return description.length > 130 ? <details className="editor-form-help" id={id}><summary>説明を表示</summary><p>{description}</p></details>
    : <p className="editor-form-hint" id={id}>{description}</p>;
}

// Scoped to the opt-in form root; the same rules ship with both rendering paths.
export const formStyles = `
[data-editor-form]{--editor-accent:var(--block-editor-accent,#426ad6);--editor-line:var(--block-editor-border,#dde3ed);--editor-muted:var(--block-editor-muted,var(--block-editor-text,#637086));color:var(--block-editor-text,#25334a);font:14px/1.5 system-ui,sans-serif;min-width:0}
[data-editor-form] *,[data-editor-form] *:before,[data-editor-form] *:after{box-sizing:border-box}
[data-editor-form] fieldset{min-width:0}
[data-editor-form] fieldset.editor-form-binding,[data-editor-form] .editor-form-section,[data-editor-form] .rjsf fieldset{padding:0;border:0;margin:0 0 18px}
[data-editor-form] .editor-form-section>legend,[data-editor-form] .rjsf fieldset>legend{font-size:15px;font-weight:650;padding:0;margin:0 0 10px;color:inherit}
[data-editor-form] .editor-form-field,[data-editor-form] .rjsf .form-group{margin:0 0 14px;min-width:0}
[data-editor-form] .editor-form-field>label,[data-editor-form] .rjsf .control-label{display:block;font-size:13px;font-weight:600;margin:0 0 6px;color:inherit}
[data-editor-form] [data-block-editor-pair-row] label,[data-editor-form] .rjsf [data-block-editor-pair-row] .control-label{margin-bottom:0}
[data-editor-form] .required{color:var(--editor-accent);margin-left:3px}
[data-editor-form] input:not([type=checkbox]):not([type=radio]),[data-editor-form] select,[data-editor-form] textarea{display:block;width:100%;min-height:38px;margin:0;padding:8px 11px;border:1px solid var(--editor-line);border-radius:7px;background:var(--block-editor-input,white);color:inherit;font:inherit;box-shadow:0 1px 2px #172b4d05}
[data-editor-form] textarea{min-height:76px;resize:vertical}
[data-editor-form] input:not([type=checkbox]):not([type=radio])[data-block-editor-invalid="true"],[data-editor-form] select[data-block-editor-invalid="true"],[data-editor-form] textarea[data-block-editor-invalid="true"]{border-color:var(--block-editor-error-border,#c62828);box-shadow:0 0 0 1px var(--block-editor-error-border,#c62828);background:linear-gradient(var(--block-editor-error-tint,rgba(198,40,40,0.08)),var(--block-editor-error-tint,rgba(198,40,40,0.08))),var(--block-editor-input,white)}
[data-editor-form] input:focus-visible,[data-editor-form] select:focus-visible,[data-editor-form] textarea:focus-visible,[data-editor-form] button:focus-visible,[data-editor-form] summary:focus-visible{outline:2px solid var(--editor-accent);outline-offset:2px}
[data-editor-form] input[readonly]{background:var(--block-editor-subtle,var(--block-editor-background,#f5f7fb));color:var(--editor-muted)}
[data-editor-form] input[type=checkbox]{width:17px;height:17px;margin:0;accent-color:var(--editor-accent)}
[data-editor-form] .editor-form-field>label.editor-form-toggle,[data-editor-form] .rjsf .checkbox>label{display:flex;align-items:center;gap:8px;font-weight:500;margin:8px 0}
[data-editor-form] button{font:inherit;cursor:pointer;border:1px solid var(--editor-line);border-radius:6px;background:var(--block-editor-input,white);color:inherit;padding:6px 10px;margin:0}
[data-editor-form] button:disabled{cursor:default;opacity:.5}
[data-editor-form] .editor-form-hint,[data-editor-form] .editor-form-help{color:var(--editor-muted);font-size:12px;line-height:1.5;margin:5px 0 10px}
[data-editor-form] .editor-form-help>summary{display:list-item;list-style:disclosure-closed inside;cursor:pointer;width:fit-content;font-weight:500}
[data-editor-form] .editor-form-help[open]>summary{list-style-type:disclosure-open}
[data-editor-form] .editor-form-help p{margin:8px 0}
[data-editor-form] .block-editor-layout-tabs>[role=tablist]{display:flex;gap:4px;flex-wrap:wrap;padding:5px;background:var(--block-editor-subtle,var(--block-editor-background,#f1f4f9));border:1px solid var(--editor-line);border-radius:9px;margin:4px 0 20px}
[data-editor-form] .block-editor-layout-tabs>[role=tablist]>button{border:0;border-radius:6px;background:transparent;color:var(--editor-muted);padding:8px 18px;margin:0;font-weight:550;text-decoration:none;min-width:76px}
[data-editor-form] .block-editor-layout-tabs>[role=tablist]>[aria-selected=true]{background:var(--block-editor-input,white);color:var(--editor-accent);box-shadow:0 1px 4px #1d30431a}
[data-editor-form] .editor-form-error-badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;margin-left:7px;padding:0 5px;border-radius:10px;background:#fff0f0;color:#b53d45;font-size:11px}
[data-editor-form] fieldset.block-editor-layout-group{border:1px solid var(--editor-line);border-radius:10px;padding:16px 18px 4px;margin:0 0 18px;background:var(--block-editor-background,white)}
[data-editor-form] fieldset.block-editor-layout-group>legend{padding:0 6px;font-size:13px;font-weight:650}
[data-editor-form] .block-editor-layout-grid{display:grid;gap:0 18px;grid-template-columns:repeat(var(--editor-columns),minmax(0,1fr));align-items:start}
[data-editor-form] .block-editor-layout-grid>*{min-width:0}
[data-editor-form] .block-editor-layout-tabs>[hidden]{display:none!important}
[data-editor-form] .editor-form-toolbar{display:flex;align-items:start;justify-content:space-between;gap:12px;margin:0 0 18px;padding-bottom:14px;border-bottom:1px solid var(--editor-line)}
[data-editor-form] .editor-form-modes{display:flex;gap:3px;border:1px solid var(--editor-line);border-radius:8px;padding:3px;background:var(--block-editor-subtle,var(--block-editor-background,#f1f4f9))}
[data-editor-form] .editor-form-modes>button{border:0;border-radius:5px;padding:5px 14px;background:transparent;color:var(--editor-muted);margin:0}
[data-editor-form] .editor-form-modes>[aria-pressed=true]{background:var(--block-editor-input,white);color:var(--editor-accent);box-shadow:0 1px 3px #1d30431a}
[data-editor-form] .editor-form-tools{font-size:12px;color:var(--editor-muted);margin:0 0 12px}
[data-editor-form] .editor-form-tools>summary{cursor:pointer;padding:5px 0;list-style-position:inside}
[data-editor-form] .editor-form-tools[open]{padding:10px 12px;border:1px solid var(--editor-line);border-radius:8px;background:var(--block-editor-subtle,var(--block-editor-background,#f7f9fc))}
[data-editor-form] .editor-form-tools button{border:1px solid var(--editor-line);border-radius:6px;background:var(--block-editor-input,white);padding:5px 9px;margin:5px 5px 5px 0;color:inherit}
[data-editor-form] .editor-form-tools label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:5px 0}
[data-editor-form] .editor-form-invalid{font-size:12px;color:#b53d45;margin:5px 0}
[data-editor-form] [data-source-error=true]>input,[data-editor-form] [data-source-error=true]>textarea{border-color:#b53d45}
[data-editor-form] .editor-form-array-item{display:flex;align-items:start;gap:10px}
[data-editor-form] .editor-form-array-item>.editor-form-field{flex:1;min-width:0}
@media(max-width:600px){[data-editor-form] .block-editor-layout-grid{grid-template-columns:minmax(0,1fr)}[data-editor-form] fieldset.block-editor-layout-group{padding:12px 12px 0}[data-editor-form] .block-editor-layout-tabs>[role=tablist]>button{padding:7px 12px;min-width:60px}[data-editor-form] .editor-form-toolbar{flex-wrap:wrap}}
`;
