import {createBlockEditorService} from '../../../dist/rjsf.js';
import {layoutSchema, layoutUiSchema, layoutSchemaBundle} from '../../../examples/common-layout.ts';

window.editors = {};
for (const route of ['rjsf', 'source']) {
  const service = createBlockEditorService({commonLayout: !location.search.includes('off')});
  const definition = {apiVersion: 1, extensionId: 'fixture', editorId: route, opcodes: [`fixture_${route}`]};
  if (route === 'rjsf') service.api.registerSchema({...definition, argument: 'SOURCE', schema: layoutSchema, uiSchema: layoutUiSchema});
  else service.api.registerSourceEditor({...definition, validationContext: () => ({consumerId: 'browser', nowMs: 1, settings: null}),
    bindings: [{argument: 'SOURCE', variants: [{variantId: 'default', format: 'json', schemaBundle: layoutSchemaBundle, uiSchema: layoutUiSchema}],
      decode: source => ({source, format: 'json', variantId: 'default', data: JSON.parse(source)}),
      validateSource: source => ({source, result: {kind: 'valid', diagnostics: []}})}]});
  const raw = ' { "name":"camera", "width":640, "height":480, "other":"未分類の項目" }\n';
  const block = {targetId: 'sprite', blockId: route, opcode: `fixture_${route}`, revision: '1', arguments: {SOURCE: {kind: 'literal', value: raw}}};
  const commits = [];
  const session = service.registry.open(block, {readBlock: () => block, commit: request => {commits.push(request);block.arguments.SOURCE.value = request.changes[0].value;}});
  session.mount(document.getElementById(route));
  window.editors[route] = {session, block, commits};
}
