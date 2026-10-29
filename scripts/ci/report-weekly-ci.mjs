import assert from 'node:assert/strict';
import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtureFile, probeFile, repository, scenarios, verifyDecision} from './assert-rerun-probe.mjs';

export const driverFile = 'ci-gate-rerun-test.yml';
const positive = value => Number.isSafeInteger(value) && value > 0;
const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const stamp = value => {const n = Date.parse(value); assert.ok(Number.isFinite(n), 'Invalid timestamp'); return n;};
const same = (value, fields) => {
    for (const [key, expected] of Object.entries(fields)) assert.deepEqual(value?.[key], expected, `Unexpected ${key}`);
};
const runURL = id => `https://github.com/${repository}/actions/runs/${id}`;

export function requestAPI(token, fetchImpl = fetch) {
    const request = async path => {
        assert.ok(path.startsWith(`/repos/${repository}/`), 'Only common repository reads are allowed');
        assert.match(path, /^\/repos\/[A-Za-z0-9_./?=&%-]+$/);
        let response;
        try {
            response = await fetchImpl(`https://api.github.com${path}`, {
                method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(20_000),
                headers: {Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
                    'X-GitHub-Api-Version': '2022-11-28'}
            });
        } catch {throw new Error('GitHub request failed');}
        return response;
    };
    const api = async path => {
        const response = await request(path);
        assert.ok(response.ok, `GitHub HTTP ${response.status}`);
        return response.status === 204 ? undefined : response.json();
    };
    api.download = async (path, binary = false) => {
        const response = await request(path);
        assert.equal(response.status, 302, 'Missing signed download URL');
        const url = new URL(response.headers.get('location'));
        assert.ok(url.protocol === 'https:' && !url.username && !url.password, 'Unsafe signed URL');
        // Signed storage URLs must never receive the GitHub token.
        let download;
        try {download = await fetchImpl(url.href, {redirect: 'error', signal: AbortSignal.timeout(30_000)});}
        catch {throw new Error('Evidence download failed');}
        assert.ok(download.ok, 'Evidence download failed');
        const bytes = new Uint8Array(await download.arrayBuffer());
        assert.ok(bytes.byteLength <= 10_000_000, 'Evidence download too large');
        return binary ? bytes : new TextDecoder().decode(bytes);
    };
    return api;
}

export async function pages(api, path, key) {
    const result = [];
    for (let page = 1; page <= 100; page++) {
        const data = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
        const rows = key ? data[key] : data;
        assert.ok(Array.isArray(rows), 'Incomplete API page');
        result.push(...rows);
        if (rows.length < 100) {
            if (key) assert.equal(result.length, data.total_count, 'Incomplete API listing');
            return result;
        }
    }
    throw new Error('API pagination limit exceeded');
}

export function evidenceAPI(token, fetchImpl = fetch) {
    const api = requestAPI(token, fetchImpl);
    const base = `/repos/${repository}`;
    return {
        get: path => api(`${base}/${path}`),
        jobs: (id, attempt) => pages(api, `${base}/actions/runs/${id}/attempts/${attempt}/jobs`, 'jobs'),
        log: id => api.download(`${base}/actions/jobs/${id}/logs`),
        source: async (revision, file) => {
            assert.ok(sha(revision)); assert.match(file, /^[a-z0-9-]+\.yml$/);
            const value = await api(`${base}/contents/.github/workflows/${file}?ref=${revision}`);
            assert.equal(value.encoding, 'base64');
            return Buffer.from(value.content, 'base64').toString('utf8');
        },
        artifact: async (id, name, filename) => {
            const rows = await pages(api, `${base}/actions/runs/${id}/artifacts`, 'artifacts');
            const found = rows.filter(a => a.name === name);
            assert.equal(found.length, 1, 'Missing or ambiguous evidence artifact');
            const artifact = found[0];
            assert.equal(artifact.expired, false); assert.equal(artifact.workflow_run?.id, id);
            assert.ok(positive(artifact.id) && artifact.size_in_bytes <= 10_000_000);
            const bytes = await api.download(`${base}/actions/artifacts/${artifact.id}/zip`, true);
            const {default: JSZip} = await import('@turbowarp/jszip');
            const zip = await JSZip.loadAsync(bytes);
            assert.ok(Object.keys(zip.files).length <= 20, 'Too many artifact entries');
            const file = zip.file(filename);
            assert.ok(file && file._data?.uncompressedSize <= 5_000_000, 'Missing or oversized evidence JSON');
            return JSON.parse(await file.async('string'));
        }
    };
}

export function checkPermissions(log, expected) {
    const groups = log.split('##[group]GITHUB_TOKEN Permissions').slice(1);
    assert.equal(groups.length, 1, 'Missing runtime permissions');
    const text = groups[0].split('##[endgroup]')[0];
    const actual = {};
    for (const line of text.split('\n')) {
        const match = line.match(/(?:^|[\t ])([A-Z][A-Za-z -]*): (read|write|none)\s*$/);
        if (match) {assert.equal(actual[match[1]], undefined); actual[match[1]] = match[2];}
    }
    assert.deepEqual(actual, {...expected, Metadata: 'read'}, 'Unexpected runtime permissions');
}

export async function checkSources(api, revision) {
    const {parse} = await import('yaml');
    for (const file of [driverFile, fixtureFile, probeFile, 'require-successful-ci.yml']) {
        const source = await api.source(revision, file);
        const workflow = parse(source);
        assert.ok(!workflow.environment && !workflow.secrets);
        const expected = file === driverFile ? {contents: 'read', actions: 'write'} :
            file === fixtureFile ? {contents: 'read'} : {contents: 'read', actions: 'read'};
        for (const job of Object.values(workflow.jobs)) {
            assert.ok(!job.environment && !job.secrets, 'Unexpected environment or secrets');
            const permissions = job.permissions || workflow.permissions;
            assert.deepEqual(permissions, expected);
            if (job.uses) assert.equal(job.uses, './.github/workflows/require-successful-ci.yml');
        }
        assert.doesNotMatch(source, /deploy-pages|npm publish|secrets\./);
        if (file === driverFile) assert.deepEqual(workflow.on.schedule, [{cron: '37 2 * * 1'}]);
        if ([fixtureFile, probeFile].includes(file)) assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
    }
}

function identity(run, {id, workflow, revision, event = 'workflow_dispatch', title}) {
    assert.ok(positive(id) && positive(run.run_attempt));
    same(run, {id, workflow_id: workflow, head_sha: revision, head_branch: 'main', event});
    assert.equal(run.repository?.full_name, repository);
    assert.equal(run.head_repository?.full_name, repository);
    if (title) assert.equal(run.display_title, title);
}

export async function verifyWeekly(runId, {api, reporterSha, now = Date.now} = {}) {
    assert.ok(positive(runId) && sha(reporterSha));
    const report = {version: 1, status: 'unconfirmed', eligible: false, reporterSha, stage: 'source',
        observedAt: new Date(now()).toISOString(), source: {id: runId}};
    try {
        const workflow = await api.get(`actions/workflows/${driverFile}`);
        assert.equal(workflow.path, `.github/workflows/${driverFile}`);
        const source = await api.get(`actions/runs/${runId}`);
        assert.ok(sha(source.head_sha));
        identity(source, {id: runId, workflow: workflow.id, revision: source.head_sha, event: source.event});
        if (source.event !== 'schedule') return {...report, status: 'ineligible'};
        assert.ok(positive(source.run_attempt));
        report.source = {id: runId, attempt: source.run_attempt, sha: source.head_sha, event: source.event,
            conclusion: source.conclusion, createdAt: source.created_at, startedAt: source.run_started_at,
            updatedAt: source.updated_at};
        assert.equal(source.status, 'completed', 'Latest attempt is not completed');
        report.eligible = true;
        const fresh = async () => {
            const value = await api.get(`actions/runs/${runId}`);
            identity(value, {id: runId, workflow: workflow.id, revision: source.head_sha, event: 'schedule'});
            same(value, {run_attempt: source.run_attempt, status: 'completed', conclusion: source.conclusion});
        };
        report.stage = 'permissions';
        await checkSources(api, source.head_sha);
        const parentJobs = await api.jobs(runId, source.run_attempt);
        assert.equal(parentJobs.length, 1); assert.equal(parentJobs[0].name, 'orchestrate');
        checkPermissions(await api.log(parentJobs[0].id), {Contents: 'read', Actions: 'write'});
        report.permissions = 'verified';
        if (source.conclusion !== 'success') {
            await fresh(); return {...report, status: 'source-failed'};
        }
        report.stage = 'suite';
        const e = await api.artifact(runId, `ci-rerun-test-${runId}-${source.run_attempt}`, 'evidence.json');
        same(e, {repository, sha: source.head_sha, branch: 'main', suite: `${runId}-${source.run_attempt}`,
            trigger: 'schedule', schedule: '37 2 * * 1', status: 'success'});
        assert.deepEqual(Object.keys(e.probes).sort(), Object.keys(scenarios).sort());
        assert.deepEqual(Object.keys(e.pending).sort(), ['pending-failure', 'success-after-wait']);
        const fixtureId = e.fixture.id;
        assert.ok(positive(fixtureId));
        const fixtureWorkflow = await api.get(`actions/workflows/${fixtureFile}`);
        const probeWorkflow = await api.get(`actions/workflows/${probeFile}`);
        assert.equal(fixtureWorkflow.path, `.github/workflows/${fixtureFile}`);
        assert.equal(probeWorkflow.path, `.github/workflows/${probeFile}`);
        const fixture = await api.get(`actions/runs/${fixtureId}`);
        identity(fixture, {id: fixtureId, workflow: fixtureWorkflow.id, revision: source.head_sha,
            title: `CI rerun fixture ${e.suite}`});
        same(fixture, {run_attempt: 3, status: 'completed', conclusion: 'success'});
        assert.equal(e.mutations.length, 7);
        assert.deepEqual(e.mutations.map(m => m.operation), ['dispatch', 'dispatch', 'rerun', 'dispatch', 'dispatch', 'rerun', 'dispatch']);
        assert.deepEqual(e.mutations.filter(m => m.operation === 'rerun').map(m => m.runId), [fixtureId, fixtureId]);
        const observers = [];
        for (const [scenario, expected] of Object.entries(scenarios)) {
            const c = e.probes[scenario], id = c.run.id;
            assert.ok(!observers.some(o => o.id === id));
            const observer = await api.get(`actions/runs/${id}`);
            identity(observer, {id, workflow: probeWorkflow.id, revision: source.head_sha,
                title: `CI rerun observer ${e.suite} ${scenario}`});
            same(observer, {run_attempt: 1, status: 'completed', conclusion: expected.conclusion});
            const jobs = await api.jobs(id, 1);
            assert.equal(jobs.length, 3);
            const byName = Object.fromEntries(jobs.map(j => [j.name, j]));
            const sentinel = expected.conclusion === 'success' ? 'success' : 'skipped';
            assert.deepEqual(Object.fromEntries(jobs.map(j => [j.name, j.conclusion])),
                {'gate / gate': expected.conclusion, 'publish-sentinel': sentinel, 'assert-probe': 'success'});
            for (const job of jobs.filter(j => j.conclusion !== 'skipped')) {
                checkPermissions(await api.log(job.id), {Contents: 'read', Actions: 'read'});
            }
            const decision = await api.artifact(id, `normal-ci-gate-${id}-1`, 'decision.json');
            const proof = verifyDecision(decision, {sha: source.head_sha, branch: 'main', runId: fixtureId,
                scenario, gate: byName['gate / gate'].conclusion, sentinel});
            assert.equal(decision.workflowId, fixtureWorkflow.id);
            same(c.proof, proof);
            const historical = await api.get(`actions/runs/${fixtureId}/attempts/${expected.attempt}`);
            identity(historical, {id: fixtureId, workflow: fixtureWorkflow.id, revision: source.head_sha});
            same(historical, {run_attempt: expected.attempt, status: 'completed', conclusion: expected.conclusion});
            const ciJobs = await api.jobs(fixtureId, expected.attempt);
            assert.equal(ciJobs.length, 1);
            checkPermissions(await api.log(ciJobs[0].id), {Contents: 'read'});
            if (expected.conclusion === 'success') {
                const times = [ciJobs[0].completed_at, proof.observedAt, byName['gate / gate'].completed_at,
                    byName['publish-sentinel'].started_at].map(stamp);
                assert.ok(times.every((t, i) => !i || t >= times[i - 1]), 'Premature sentinel');
            }
            if (e.pending[scenario]) {
                const p = e.pending[scenario];
                for (const snapshot of [p.before, p.after]) {
                    identity(snapshot, {id: fixtureId, workflow: fixtureWorkflow.id, revision: source.head_sha});
                    same(snapshot, {run_attempt: expected.attempt, status: 'in_progress', conclusion: null});
                }
                assert.ok(!p.jobs.some(j => j.name === 'publish-sentinel' && (j.status !== 'queued' || j.started_at)));
                const gate = p.jobs.find(j => j.name === 'gate / gate');
                assert.equal(gate?.status, 'in_progress');
                assert.ok(gate.steps.some(s => s.name === 'Require the latest matching normal CI to succeed' && s.status === 'in_progress'));
                assert.ok(stamp(p.observedAt) >= stamp(ciJobs[0].started_at) && stamp(p.observedAt) <= stamp(ciJobs[0].completed_at));
            }
            observers.push({scenario, id, attempt: expected.attempt, decision: proof.decision});
        }
        report.stage = 'freshness';
        await fresh();
        return {...report, stage: 'complete', status: 'verified-success', fixture: fixtureId, observers};
    } catch {
        // Never render untrusted error messages, API bodies or log contents in an Issue.
        return report;
    }
}

export function commentBody(report) {
    assert.ok(positive(report.source?.id) && positive(report.source.attempt) && sha(report.source.sha));
    assert.equal(report.source.event, 'schedule');
    assert.equal(report.eligible, true);
    assert.ok(['verified-success', 'source-failed', 'unconfirmed'].includes(report.status));
    const marker = `<!-- ci-weekly-report:${report.source.id}:${report.source.attempt} -->`;
    const status = {'verified-success': '真正schedule実行の正常終了と証跡を確認',
        'source-failed': '真正schedule実行が成功以外で終了', unconfirmed: '真正schedule実行の検証は確認不能'}[report.status];
    const lines = [marker, '### 共通GitHub Actionsによる週次検証結果', '', `判定: **${status}**`, '',
        `- 元run: ${runURL(report.source.id)} / attempt ${report.source.attempt}`,
        `- 元イベント: schedule / SHA: \`${report.source.sha}\``,
        `- 確認時刻: ${report.observedAt}`, `- 報告コードSHA: \`${report.reporterSha}\``,
        `- トークン権限: ${report.permissions === 'verified' ? '元統括の実権限と関連workflow定義を確認（Pages/OIDC/デプロイ権限なし）' : '確認不能'}`];
    if (report.status === 'verified-success') {
        lines.push('- 親/子証跡: 同一SHA・fixtureの3 attemptsと4判定、実行中の待機、成功後だけsentinel開始を確認。子jobの実権限も照合。');
    } else lines.push('- suite成功の完全な検証を完了したとは扱いません。runとreport artifactを確認してください。');
    lines.push('', '検証・報告はこのライブラリのリポジトリ内に限定します。Editorの配信状態は検証対象に含めません。',
        'この文面は共通GitHub Actionsが生成した検証結果の草案です。');
    return lines.join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const env = process.env, mode = process.argv[2];
    const output = 'test-results/ci-weekly-report';
    mkdirSync(output, {recursive: true});
    try {
        assert.equal(env.GITHUB_REPOSITORY, repository);
        assert.equal(env.GITHUB_REF, 'refs/heads/main');
        assert.ok(sha(env.GITHUB_SHA));
        assert.ok(env.GH_TOKEN, 'Read-only token required');
        const api = evidenceAPI(env.GH_TOKEN);
        if (mode === 'verify') {
            assert.ok(['workflow_run', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME));
            const report = await verifyWeekly(Number(env.SOURCE_RUN_ID), {api, reporterSha: env.GITHUB_SHA});
            writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
            if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `eligible=${report.eligible}\n`);
            const summary = report.eligible ? commentBody(report) : `Weekly report: ${report.status}\n`;
            if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
            console.log(`Weekly verification: ${report.status}`);
            if (['source-failed', 'unconfirmed'].includes(report.status)) process.exitCode = 1;
        } else {
            assert.equal(mode, 'verify', 'Only read-only verification is supported');

        }
    } catch {
        console.error('Weekly report could not be completed; inspect the verification artifact and configuration.');
        process.exitCode = 1;
    }
}
