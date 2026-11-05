import assert from 'node:assert/strict';
import test from 'node:test';
const root = process.env.BLOCK_EDITOR_BRANCH_TEST_DIST ? new URL(process.env.BLOCK_EDITOR_BRANCH_TEST_DIST) : new URL('../dist/', import.meta.url);
const {createFixedInputEditor, captureFixedInputEditorDefinition} = await import(new URL('fixed-input-editor.js', root));
const {captureFixedInputDeclaration} = await import(new URL('fixed-input-snapshot.js', root));
const {resolveFixedBranches, validateFixedBranchChanges} = await import(new URL('fixed-input-branches.js', root));
const canonical = {repository: 'example', path: 'choice.schema.json'};
const schema = document => ({identity: {ownerId:'example', contractId:'branch', revision:'1', variantId:'value'}, dialect:'draft-07',
  root:{retrievalUri:'https://schema.invalid/branch', document, artifact:{role:'canonical-schema',source:canonical}},resources:[],
  provenance:{canonicalSources:[canonical],generatedFiles:[],referenceSchemas:[],generationSources:[]}});
const binding = (argument, document = {type:'string'}, extra = {}) => ({argument, schemaBundle:schema(document), read:value=>value,
  encode:value=>value, validateCandidate:()=>[], ...extra});
function fixture({selector='first', item='20', context='ready', requiredSource='shadow', bindingExtra={}, cases, extraBindings=[]}={}) {
 const counters={encode:0,owner:0,provider:0};
 const valueBinding=binding('ITEM',{type:'string'},bindingExtra);
 const policies=[{selector:'SELECTOR',normalize:{trim:true,lowercase:true},cases:cases??[
  {values:['first'],activeDependents:['ITEM']},
  {values:['second'],activeDependents:['ITEM'],bindings:[binding('ITEM',{type:'string',pattern:'^[0-9]+$'},
    {encode:value=>{counters.encode++;return value;},validateCandidate:(value,_ctx,snapshot)=>{counters.owner++;assert.equal(snapshot.arguments.SELECTOR.value,'second');return []}})]},
  {values:['hidden'],activeDependents:[],requireOnSelectorChange:[{argument:'CONTEXT',rule:'nonempty-string'}]}
 ]}];
 const options={apiVersion:1,extensionId:'example',editorId:'branch',opcodes:['example_branch'],contractId:'example.branch',contractRevision:'1',
   dependencies:[{selector:'SELECTOR',dependents:['ITEM']}],readOnlyArguments:['CONTEXT'],
   bindings:[binding('SELECTOR',{type:'string'}),valueBinding,...extraBindings],branchPolicies:policies,
   validationContext:()=>{counters.provider++;return{consumerId:'test',nowMs:0,settings:null}}};
 const fields={SELECTOR:selector,ITEM:item,CONTEXT:context};const args={};const inputs={};
 for(const [name,value]of Object.entries(fields)){
  args[name]=value&&typeof value==='object'?value:{kind:'literal',value};
  const source=name==='CONTEXT'?requiredSource:args[name].kind==='reporter'?'reporter':'shadow';
  inputs[name]={role:name==='CONTEXT'?'readonly':'editable',source,identity:name,
   ...(source==='shadow'?{field:{blockId:name,name:'TEXT',type:'FieldTextInput'}}:{}),...(source==='unsupported'||source==='missing'?{reason:'not available'}:{})};
 }
 for(const b of extraBindings){args[b.argument]={kind:'literal',value:'old'};inputs[b.argument]={role:'editable',source:'shadow',identity:b.argument,field:{blockId:b.argument,name:'TEXT',type:'FieldTextInput'}}}
 const snapshot={targetId:'target',blockId:'block',opcode:'example_branch',revision:'r1',arguments:args,
  fixedContext:{contractId:'example.branch',contractRevision:'1',generation:'g1',readOnlyArguments:['CONTEXT'],dependencies:options.dependencies,inputs}};
 const definition=createFixedInputEditor(options);const draft=structuredClone(definition.readFixed(snapshot));
 return{options,definition,draft,snapshot,counters};
}
function change(f,name,value,extras={}){f.draft.inputs[name]={value,changed:true,...extras}}

test('finite branch authority is immutable and rejects ambiguous cases and overlapping groups',()=>{
 const f=fixture();const declaration=captureFixedInputDeclaration(f.definition);
 assert.ok(Object.isFrozen(declaration.branchRules[0].cases[0].values));
 assert.deepEqual(declaration.branchRules[0].cases[1].activeDependents,['ITEM']);
 assert.equal('bindings'in declaration.branchRules[0].cases[1],false);
 assert.throws(()=>createFixedInputEditor({...f.options,branchPolicies:[{selector:'SELECTOR',normalize:{trim:true},cases:[{values:['a',' a '],activeDependents:[]}]}]}));
 assert.throws(()=>createFixedInputEditor({...f.options,branchPolicies:[{selector:'SELECTOR',cases:[{values:['first'],activeDependents:['CONTEXT']}]}]}));
 assert.throws(()=>createFixedInputEditor({...f.options,dependencies:[...f.options.dependencies,{selector:'ITEM',dependents:['SELECTOR']}]}));
});
test('branch option accessors are rejected without invocation',()=>{
 const f=fixture();let calls=0;const rule={...f.options.branchPolicies[0]};Object.defineProperty(rule,'cases',{get(){calls++;throw Error('unsafe')}});
 assert.throws(()=>createFixedInputEditor({...f.options,branchPolicies:[rule]}));assert.equal(calls,0);
});
test('known alias opens its declared branch and a no-op preserves all original literals',()=>{
 const f=fixture({selector:' FIRST ',item:' OLD '});assert.equal(resolveFixedBranches(f.definition,f.snapshot)[0].status,'alias');
 const result=f.definition.prepareFixedSave(f.draft,f.snapshot);assert.equal(result.kind,'ready');assert.deepEqual(result.changes,[]);assert.equal(f.counters.owner,0);
});
test('selector change checks an unedited active dependent without encoding it',()=>{
 const f=fixture({item:'20'});change(f,'SELECTOR','second');const result=f.definition.prepareFixedSave(f.draft,f.snapshot);
 assert.equal(result.kind,'ready');assert.deepEqual(result.changes,[{argument:'SELECTOR',value:'second'}]);assert.equal(f.counters.encode,0);assert.equal(f.counters.owner,1);
 const bad=fixture({item:'abc'});change(bad,'SELECTOR','second');assert.equal(bad.definition.prepareFixedSave(bad.draft,bad.snapshot).kind,'invalid');
});
test('each changed active candidate is encoded once before schema and owner validation',()=>{
 const f=fixture();change(f,'SELECTOR','second');change(f,'ITEM','25');const result=f.definition.prepareFixedSave(f.draft,f.snapshot);
 assert.equal(result.kind,'ready');assert.equal(f.counters.encode,1);assert.equal(f.counters.owner,1);assert.deepEqual(result.changes,[{argument:'SELECTOR',value:'second'},{argument:'ITEM',value:'25'}]);
});
test('selector changes cannot accept reporter dependents or silently replace their shadows',()=>{
 const f=fixture({item:{kind:'reporter'}});change(f,'SELECTOR','second');const result=f.definition.prepareFixedSave(f.draft,f.snapshot);
 assert.equal(result.kind,'invalid');assert.ok(result.issues.some(x=>x.message.includes('dependency-unverifiable')));assert.equal(f.snapshot.arguments.ITEM.kind,'reporter');
});
test('unknown selector group is readonly while independent input remains editable',()=>{
 const f=fixture({selector:'future',extraBindings:[binding('OTHER')]});const description=f.definition.describeFixed(f.draft,f.snapshot);
 assert.equal(description.inputs.ITEM.state,'readonly');change(f,'OTHER','new');const result=f.definition.prepareFixedSave(f.draft,f.snapshot);
 assert.equal(result.kind,'ready');assert.deepEqual(result.changes,[{argument:'OTHER',value:'new'}]);
 change(f,'ITEM','99');assert.equal(f.definition.prepareFixedSave(f.draft,f.snapshot).kind,'invalid');
});
test('unknown literal selector can be repaired after active dependency verification',()=>{
 const f=fixture({selector:'future',item:'20'});change(f,'SELECTOR','second');const result=f.definition.prepareFixedSave(f.draft,f.snapshot);
 assert.equal(result.kind,'ready');assert.deepEqual(result.changes,[{argument:'SELECTOR',value:'second'}]);
});
test('selector changes require only the declared final readonly context',()=>{
 for(const context of ['  ',{kind:'reporter'}]){
  const f=fixture({context,requiredSource:typeof context==='object'?'reporter':'shadow'});change(f,'SELECTOR','hidden');
  assert.equal(f.definition.prepareFixedSave(f.draft,f.snapshot).kind,'invalid');
 }
 const f=fixture({selector:'future',context:{kind:'reporter'},requiredSource:'reporter'});change(f,'SELECTOR','second');
 assert.equal(f.definition.prepareFixedSave(f.draft,f.snapshot).kind,'ready');
});
test('unchanged selector permits active value edits with an unreadable unrelated context',()=>{
 const f=fixture({selector:'second',context:{kind:'reporter'},requiredSource:'reporter'});change(f,'ITEM','30');
 assert.equal(f.definition.prepareFixedSave(f.draft,f.snapshot).kind,'ready');assert.equal(f.definition.describeFixed(f.draft,f.snapshot).inputs.CONTEXT.unverified,true);
});
test('inactive invalid buffers remain in the same draft and never become a patch',()=>{
 const f=fixture({selector:'first',item:'10'});change(f,'ITEM',10,{buffer:'1e'});change(f,'SELECTOR','hidden');
 const before=structuredClone(f.draft);assert.equal(f.definition.describeFixed(f.draft,f.snapshot).inputs.ITEM.state,'hidden');
 const result=f.definition.prepareFixedSave(f.draft,f.snapshot);assert.equal(result.kind,'ready');assert.deepEqual(result.changes,[{argument:'SELECTOR',value:'hidden'}]);assert.deepEqual(f.draft,before);
 change(f,'SELECTOR','first');assert.equal(f.definition.prepareFixedSave(f.draft,f.snapshot).kind,'invalid');assert.equal(f.draft.inputs.ITEM.buffer,'1e');
});
test('readonly field and inactive patches are rejected by the shared host/session gate',()=>{
 const f=fixture({selector:'hidden'});
 assert.ok(validateFixedBranchChanges(f.definition,f.snapshot,[{argument:'CONTEXT',value:'x'}]).length);
 assert.ok(validateFixedBranchChanges(f.definition,f.snapshot,[{argument:'ITEM',value:'x'}]).length);
 const noPolicy={...f.definition};delete noPolicy.branchRules;
 assert.ok(validateFixedBranchChanges(noPolicy,f.snapshot,[{argument:'SELECTOR',value:'second'}]).length);
});
test('live description never calls candidate encode, owner validation or context provider',()=>{
 const f=fixture();change(f,'SELECTOR','second');change(f,'ITEM','30');f.definition.describeFixed(f.draft,f.snapshot);
 assert.deepEqual(f.counters,{encode:0,owner:0,provider:0});
});
test('registered captured definition retains describe method and canonical policy without callbacks',()=>{
 const f=fixture();const registered=captureFixedInputEditorDefinition(f.definition);assert.equal(registered.describeFixed,f.definition.describeFixed);
 assert.equal('bindings'in registered.branchRules[0].cases[1],false);
});
test('branch switch between different projections validates unchanged raw without fabricating a draft edit',()=>{
 const f=fixture({item:'20',cases:[{values:['first'],activeDependents:['ITEM']},{values:['second'],activeDependents:['ITEM'],bindings:[binding('ITEM',{type:'number',exclusiveMinimum:0},{read:value=>Number(value),encode:value=>String(value)})]}]});
 change(f,'SELECTOR','second');const result=f.definition.prepareFixedSave(f.draft,f.snapshot);assert.equal(result.kind,'ready');assert.deepEqual(result.changes,[{argument:'SELECTOR',value:'second'}]);assert.equal(f.draft.inputs.ITEM.value,'20');
});

test('owner callbacks cannot mutate the final candidate map used by a later validator',()=>{
 const f=fixture({bindingExtra:{validateCandidate:(_value,_context,snapshot)=>{assert.ok(Object.isFrozen(snapshot.arguments.ITEM));assert.throws(()=>{snapshot.arguments.ITEM.value='forged'});return []}}});
 change(f,'ITEM','30');const result=f.definition.prepareFixedSave(f.draft,f.snapshot);assert.equal(result.kind,'ready');assert.deepEqual(result.changes,[{argument:'ITEM',value:'30'}]);
});
