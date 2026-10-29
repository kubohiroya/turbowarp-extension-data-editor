import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import YAML from 'yaml';
import {repository, fixtureFile, probeFile, scenarios} from '../../scripts/ci/assert-rerun-probe.mjs';
import {verifyWeekly, checkPermissions, commentBody, requestAPI, evidenceAPI, driverFile} from '../../scripts/ci/report-weekly-ci.mjs';

const otherRepository = 'example/unrelated-project';
const revision = 'a'.repeat(40), reporterSha = 'b'.repeat(40);
const date = n => new Date(1_800_000_000_000 + n * 1000).toISOString();
const log = permissions => `##[group]GITHUB_TOKEN Permissions\n${Object.entries({...permissions, Metadata: 'read'})
    .map(([k, v]) => `timestamp ${k}: ${v}`).join('\n')}\n##[endgroup]`;
const identity = (id, workflow, title) => ({id, workflow_id: workflow, head_sha: revision, head_branch: 'main',
    repository: {full_name: repository}, head_repository: {full_name: repository}, event: 'workflow_dispatch',
    run_attempt: 1, status: 'completed', conclusion: 'success', display_title: title});

function fixture() {
    const root = {...identity(10, 1), event: 'schedule', created_at: date(0), run_started_at: date(1), updated_at: date(100)};
    const ci = {...identity(20, 2, 'CI rerun fixture 10-1'), run_attempt: 3};
    const runs = new Map([[10, root], [20, ci]]), jobSets = new Map([['10-1', [{id: 100, name: 'orchestrate'}]]]);
    const logs = new Map([[100, log({Actions: 'write', Contents: 'read'})]]), artifacts = new Map();
    const e = {repository, sha: revision, branch: 'main', suite: '10-1', trigger: 'schedule', schedule: '37 2 * * 1',
        status: 'success', fixture: ci, probes: {}, pending: {},
        mutations: ['dispatch', 'dispatch', 'rerun', 'dispatch', 'dispatch', 'rerun', 'dispatch']
            .map(operation => ({operation, ...(operation === 'rerun' ? {runId: 20} : {})}))};
    let id = 30;
    for (const [scenario, expected] of Object.entries(scenarios)) {
        const run = {...identity(id++, 3, `CI rerun observer 10-1 ${scenario}`), conclusion: expected.conclusion};
        runs.set(run.id, run);
        const positive = expected.conclusion === 'success';
        const jobs = [{id: run.id * 10, name: 'gate / gate', conclusion: expected.conclusion, completed_at: date(70)},
            {id: run.id * 10 + 1, name: 'publish-sentinel', conclusion: positive ? 'success' : 'skipped', started_at: positive ? date(71) : undefined},
            {id: run.id * 10 + 2, name: 'assert-probe', conclusion: 'success'}];
        jobSets.set(`${run.id}-1`, jobs);
        for (const job of jobs) logs.set(job.id, log({Actions: 'read', Contents: 'read'}));
        const decision = {repository, workflowFile: fixtureFile, workflowId: 2, expectedRevision: revision,
            branch: 'main', event: 'workflow_dispatch', runId: 20, attempt: expected.attempt, status: 'completed',
            conclusion: expected.conclusion, decision: positive ? 'accepted' : 'rejected', observedAt: date(60),
            reason: positive ? 'Latest matching normal CI workflow succeeded' : 'Normal CI concluded failure'};
        const {workflowId, ...fields} = decision;
        e.probes[scenario] = {run, proof: {...fields, scenario, gate: expected.conclusion, sentinel: positive ? 'success' : 'skipped'}};
        artifacts.set(`${run.id}/normal-ci-gate-${run.id}-1`, decision);
        jobSets.set(`20-${expected.attempt}`, [{id: 200 + expected.attempt, name: 'fixture', started_at: date(10), completed_at: date(50)}]);
        logs.set(200 + expected.attempt, log({Contents: 'read'}));
        if (['pending-failure', 'success-after-wait'].includes(scenario)) e.pending[scenario] = {
            observedAt: date(30), before: {...ci, run_attempt: expected.attempt, status: 'in_progress', conclusion: null},
            after: {...ci, run_attempt: expected.attempt, status: 'in_progress', conclusion: null},
            jobs: [{name: 'gate / gate', status: 'in_progress', steps: [
                {name: 'Require the latest matching normal CI to succeed', status: 'in_progress'}]}]};
    }
    artifacts.set('10/ci-rerun-test-10-1', e);
    let freshReads = 0;
    const api = {
        async get(path) {
            const workflow = path.match(/^actions\/workflows\/(.+)$/);
            if (workflow) return {id: [driverFile, fixtureFile, probeFile].indexOf(workflow[1]) + 1,
                path: `.github/workflows/${workflow[1]}`};
            const historical = path.match(/^actions\/runs\/20\/attempts\/(\d+)$/);
            if (historical) return {...ci, run_attempt: Number(historical[1]), conclusion: Number(historical[1]) === 2 ? 'failure' : 'success'};
            const detail = path.match(/^actions\/runs\/(\d+)$/);
            assert.ok(detail, path); if (Number(detail[1]) === 10) freshReads++;
            return structuredClone(runs.get(Number(detail[1])));
        },
        async jobs(id, attempt) {return structuredClone(jobSets.get(`${id}-${attempt}`));},
        async log(id) {return logs.get(id);},
        async artifact(id, name) {assert.ok(artifacts.has(`${id}/${name}`)); return structuredClone(artifacts.get(`${id}/${name}`));},
        async source(_sha, file) {
            assert.equal(_sha, revision);
            const source = YAML.parse(readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8'));
            // Preserve the historical scheduled source independently of today's manual-only entry.
            if (file === driverFile) source.on.schedule = [{cron: '37 2 * * 1'}];
            return YAML.stringify(source);
        }
    };
    return {root, ci, runs, e, api, logs, jobSets, execute: () => verifyWeekly(10, {api, reporterSha}), freshReads: () => freshReads};
}

test('a genuine completed schedule is independently verified with exact artifacts, permissions', async () => {
    const h = fixture(), result = await h.execute();
    assert.equal(result.status, 'verified-success'); assert.equal(result.eligible, true);
    assert.equal(result.observers.length, 4);
    assert.equal(result.gui, undefined);
    assert.equal(h.freshReads(), 2);
    assert.match(commentBody(result), /ci-weekly-report:10:1/);
    assert.match(commentBody(result), /検証結果の草案/);
});

for (const [name, mutate] of Object.entries({
    'manual source': h => {h.root.event = 'workflow_dispatch';},
    'wrong repo': h => {h.root.repository.full_name = otherRepository;},
    'wrong branch': h => {h.root.head_branch = 'feature';},
    'wrong workflow': h => {h.root.workflow_id = 7;},
    'pending latest attempt': h => {h.root.run_attempt = 2; h.root.status = 'in_progress';},
    'wrong schedule proof': h => {h.e.trigger = 'workflow_dispatch';},
    'wrong cron': h => {h.e.schedule = '0 * * * *';},
    'wrong SHA': h => {h.e.sha = 'f'.repeat(40);},
    'old attempt proof': h => {h.e.probes['failed-fresh'].proof.attempt = 1;},
    'missing pending proof': h => {delete h.e.pending['pending-failure'];},
    'premature sentinel': h => {h.e.pending['pending-failure'].jobs.push({name: 'publish-sentinel', status: 'in_progress'});},
    'early success sentinel': h => {h.jobSets.get('33-1')[1].started_at = date(3);},
    'fixture advanced': h => {h.ci.run_attempt = 4;},
    'publication permission': h => {h.logs.set(100, log({Actions: 'write', Contents: 'read', Pages: 'write'}));},
    'OIDC permission': h => {h.logs.set(330, log({Actions: 'read', Contents: 'read', 'IdToken': 'write'}));},
    'missing runtime permissions': h => {h.logs.set(100, 'empty');},
    'API failure': h => {h.api.jobs = async () => {throw new Error('secret');};},
    'missing artifact': h => {h.api.artifact = async () => {throw new Error('missing');};},
    'malicious source permissions': h => {h.api.source = async () => 'permissions: write-all\njobs: {bad: {run: evil}}';}
})) {
    test(`weekly success is not claimed for ${name}`, async () => {
        const h = fixture(); mutate(h); const result = await h.execute();
        assert.notEqual(result.status, 'verified-success');
        assert.ok(!JSON.stringify(result).includes('secret'));
    });
}

test('a rerun starting during verification invalidates the old success', async () => {
    const h = fixture(), get = h.api.get;
    h.api.get = async path => {
        const value = await get(path);
        return path === 'actions/runs/10' && h.freshReads() > 1 ? {...value, run_attempt: 2, status: 'in_progress'} : value;
    };
    assert.equal((await h.execute()).status, 'unconfirmed');
});

test('failed/cancelled source runs remain failed and are eligible for honest reporting', async () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
        const h = fixture(); h.root.conclusion = conclusion;
        const result = await h.execute();
        assert.equal(result.status, 'source-failed'); assert.equal(result.eligible, true);
        assert.match(commentBody(result), /成功以外/);
    }
});

test('permission parsing requires an exact allowlist, including unknown write scopes', () => {
    checkPermissions(log({Contents: 'read'}), {Contents: 'read'});
    assert.throws(() => checkPermissions(log({Contents: 'read', Deployments: 'write'}), {Contents: 'read'}));
    assert.throws(() => checkPermissions(log({Contents: 'read'}) + log({Contents: 'read'}), {Contents: 'read'}));
});

test('signed downloads never forward tokens; errors never expose API responses', async () => {
    const calls = [];
    const api = requestAPI('secret', async (url, options) => {
        calls.push({url, options});
        return calls.length === 1 ? {status: 302, headers: new Headers({location: 'https://storage.example/log'})} :
            {ok: true, arrayBuffer: async () => new TextEncoder().encode('proof').buffer};
    });
    assert.equal(await api.download(`/repos/${repository}/log`), 'proof');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer secret');
    assert.equal(calls[1].options.headers, undefined);
    await assert.rejects(requestAPI('secret', async () => {throw new Error('secret');})(`/repos/${repository}/test`),
        error => !error.message.includes('secret'));
    await assert.rejects(requestAPI('secret', async () => ({status: 302,
        headers: new Headers({location: 'http://storage.example'})})).download(`/repos/${repository}/test`), /Unsafe/);
});

test('artifact downloads require one exact unexpired source artifact and read JSON without extraction', async () => {
    const {default: JSZip} = await import('@turbowarp/jszip');
    const zip = new JSZip(); zip.file('evidence.json', JSON.stringify({status: 'success'}));
    const bytes = await zip.generateAsync({type: 'uint8array'});
    for (const variant of ['valid', 'expired', 'wrong-run', 'duplicate', 'missing-file']) {
        const fetchImpl = async (url, options) => {
            if (url.includes('/runs/10/artifacts?')) {
                const a = {id: 3, name: 'ci-rerun-test-10-1', expired: variant === 'expired',
                    workflow_run: {id: variant === 'wrong-run' ? 11 : 10}, size_in_bytes: bytes.length};
                const artifacts = variant === 'duplicate' ? [a, a] : [a];
                return {ok: true, status: 200, json: async () => ({total_count: artifacts.length, artifacts})};
            }
            if (url.endsWith('/artifacts/3/zip')) return {status: 302, headers: new Headers({location: 'https://storage.example/artifact'})};
            assert.equal(options.headers, undefined);
            return {ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)};
        };
        const promise = evidenceAPI('read-only', fetchImpl).artifact(10, 'ci-rerun-test-10-1', variant === 'missing-file' ? 'other.json' : 'evidence.json');
        if (variant === 'valid') assert.deepEqual(await promise, {status: 'success'});
        else await assert.rejects(promise);
    }
});

test('historical reporting stays manual with read-only verification and no publishing credentials', () => {
    const w = YAML.parse(readFileSync(new URL('../../.github/workflows/ci-gate-rerun-report.yml', import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(w.on), ['workflow_dispatch']);
    assert.deepEqual(Object.keys(w.jobs), ['verify', 'record']);
    assert.deepEqual(w.jobs.record.permissions, {contents: 'read', actions: 'read', issues: 'write'});
    assert.deepEqual(Object.keys(w.on.workflow_dispatch.inputs), ['run_id']);
    assert.deepEqual(w.permissions, {contents: 'read', actions: 'read'});
    assert.doesNotMatch(JSON.stringify(w), /secrets\.|PRIVATE_KEY|CI_REPORT_APP/);
    assert.doesNotMatch(JSON.stringify(w.jobs), /publish/);
    for (const job of Object.values(w.jobs)) {
        assert.equal(job.environment, undefined);
        assert.equal((job.permissions || w.permissions).pages, undefined);
        assert.equal((job.permissions || w.permissions)['id-token'], undefined);
        assert.doesNotMatch(JSON.stringify(job), /deploy-pages|npm publish|secrets: inherit/);
        for (const step of job.steps.filter(s => s.uses?.startsWith('actions/checkout'))) {
            assert.equal(step.with.ref, '${{ github.sha }}'); assert.equal(step.with['persist-credentials'], false);
        }
    }
});


test('the reader uses only GET and refuses other repositories or App endpoints', async () => {
    const calls = [];
    const api = requestAPI('read-token', async (url, options) => {
        calls.push({url, options}); return {ok: true, status: 200, json: async () => ({ok: true})};
    });
    await api(`/repos/${repository}/actions/runs/10`, 'POST', {body: 'ignored'});
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.body, undefined);
    await assert.rejects(api('/repos/example/unrelated-project/issues/12/comments'));
    await assert.rejects(api('/app/installations/1/access_tokens'));
    assert.equal(calls.length, 1);
});


test('same-repository reporting needs no App and writes only the approved operations Issue once', async () => {
    const {postLocalReport, issuePath} = await import('../../scripts/ci/post-local-report.mjs');
    const h = fixture(), report = await h.execute(); let stored, posts = 0;
    const env = {GITHUB_REPOSITORY: repository, GITHUB_REF: 'refs/heads/main',
        GITHUB_SHA: reporterSha, CI_RERUN_REPORT_ENABLED: 'true', GH_TOKEN: 'own-issue-token'};
    const fetchImpl = async (url, options) => {
        const path = new URL(url).pathname;
        if (options.method === 'POST') {
            assert.equal(path, issuePath); posts++;
            stored = {id: 55, body: JSON.parse(options.body).body, user: {login: 'github-actions[bot]', type: 'Bot'}};
            throw new Error('lost response');
        }
        return {ok: true, status: 200, json: async () => path.endsWith('/runs/10') ? h.root : stored ? [stored] : []};
    };
    assert.equal((await postLocalReport(report, env, {fetchImpl})).status, 'already-posted');
    assert.equal((await postLocalReport(report, env, {fetchImpl})).id, 55); assert.equal(posts, 1);
    assert.equal(issuePath, `/repos/${repository}/issues/26/comments`);
    h.root.run_attempt = 2;
    await assert.rejects(postLocalReport(report, env, {fetchImpl}));
    await assert.rejects(postLocalReport(report, {...env, CI_RERUN_REPORT_ENABLED: ''}, {fetchImpl}));
    await assert.rejects(postLocalReport(report, {...env, GITHUB_REPOSITORY: otherRepository}, {fetchImpl}));
    assert.equal(posts, 1);
});
