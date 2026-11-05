import assert from 'node:assert/strict';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const index=JSON.parse(await readFile(process.argv[2],'utf8'));
const digest=value=>createHash('sha256').update(value).digest('hex');
async function producer(directory,repo){
 const path=join(directory,'producer-'+repo+'.mjs');await writeFile(path,`export * from '@kubohiroya/turbowarp-${repo}/editor-schema';\n`);return import(pathToFileURL(path));
}
const rows=[];
const liveScene=await producer(index['scene-graph'],'scene-graph');
const liveCamera=await producer(index['camera-source'],'camera-source');
for(const [consumer,repo,key,expected] of [['3d-scene-runtime','scene-graph','sceneSchemaBundles',liveScene.sceneSchemaBundles],['camera-calibration','camera-source','cameraProfileSchemaBundles',liveCamera.cameraProfileSchemaBundles],['realtime-motion-capture','camera-source','cameraProfileSchemaBundles',liveCamera.cameraProfileSchemaBundles]]){
 const actual=(await producer(index[consumer],repo))[key];assert.equal(JSON.stringify(actual),JSON.stringify(expected));
 const manifestPath=join(index[consumer],'node_modules','@kubohiroya','turbowarp-'+repo,'package.json');
 rows.push({consumer,producer:repo,installedVersion:JSON.parse(await readFile(manifestPath,'utf8')).version,bundleFingerprint:digest(JSON.stringify(actual)),activeProducerBundlesMatch:true});
}
const commonDirectory=directory=>join(directory,'node_modules/@kubohiroya/turbowarp-extension-data-editor/dist');
const pureFiles=(await readdir(commonDirectory(index.editor))).filter(file=>file.startsWith('schema')&&/\.(js|d\.ts)$/.test(file));
for(const [consumer,directory] of Object.entries(index)){
 if(consumer==='editor')continue;
 for(const file of pureFiles)assert.equal(digest(await readFile(join(commonDirectory(directory),file))),digest(await readFile(join(commonDirectory(index.editor),file))),consumer+' '+file);
 rows.push({consumer,producer:'extension-data-editor',pinnedPureFilesCompared:pureFiles.length,pureArtifactMatchesActiveSource:true,UIArtifactMayDiffer:true});
}
console.log(JSON.stringify({results:rows},null,2));
