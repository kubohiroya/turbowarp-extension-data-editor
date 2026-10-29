import assert from 'node:assert/strict';
import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtureFile, marker, probeFile, repository, scenarios, verifyDecision} from './assert-rerun-probe.mjs';

export const weeklyCron = '37 2 * * 1';

const positive = value => Number.isSafeInteger(value) && value > 0;
export function configuration(env) {
    assert.equal(env.GITHUB_REPOSITORY, repository, 'Only the common test repository is allowed');
    assert.ok(['workflow_dispatch', 'schedule'].includes(env.GITHUB_EVENT_NAME), 'Unsupported test trigger');
    if (env.GITHUB_EVENT_NAME === 'schedule') {
        assert.equal(env.GITHUB_REF, 'refs/heads/main', 'Scheduled tests require the default main branch');
        assert.equal(env.CI_SCHEDULE, weeklyCron, 'Unexpected weekly schedule');
    }
    assert.match(env.GITHUB_SHA || '', /^[0-9a-f]{40}$/);
    assert.match(env.GITHUB_REF || '', /^refs\/heads\/[\w./-]+$/);
    assert.match(env.GITHUB_RUN_ID || '', /^[1-9]\d*$/);
    assert.match(env.GITHUB_RUN_ATTEMPT || '', /^[1-9]\d*$/);
    assert.ok(env.GH_TOKEN, 'GH_TOKEN is required');
    assert.ok(!env.GITHUB_API_URL || env.GITHUB_API_URL === 'https://api.github.com', 'Unexpected API host');
    return {sha: env.GITHUB_SHA, branch: env.GITHUB_REF.slice('refs/heads/'.length),
        suite: `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`, token: env.GH_TOKEN,
        event: env.GITHUB_EVENT_NAME, schedule: env.GITHUB_EVENT_NAME === 'schedule' ? weeklyCron : undefined};
}

export function githubAPI(config, fetchImpl = fetch) {
    const request = async (path, method = 'GET', body) => {
        let response;
        try {
            response = await fetchImpl(`https://api.github.com/repos/${repository}/${path}`, {
                method, headers: {Accept: 'application/vnd.github+json', Authorization: `Bearer ${config.token}`,
                    'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28'},
                body: body ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(15_000)
            });
        } catch { throw new Error('GitHub test API request failed'); }
        return response;
    };
    const api = async (path, method = 'GET', body) => {
        const response = await request(path, method, body);
        if (!response.ok) throw new Error(`GitHub test API returned HTTP ${response.status}`);
        if (method === 'POST') return;
        try { return await response.json(); } catch { throw new Error('Invalid GitHub test API JSON'); }
    };
    api.logs = async jobId => {
        assert.ok(positive(jobId), 'Invalid observer job ID');
        const response = await request(`actions/jobs/${jobId}/logs`);
        if (response.status !== 302) throw new Error('Observer logs did not provide a download redirect');
        let url;
        try { url = new URL(response.headers.get('location')); } catch { throw new Error('Invalid log download URL'); }
        assert.ok(url.protocol === 'https:' && !url.username && !url.password, 'Unsafe log download URL');
        // Never forward the repository token to signed log storage URLs.
        let download;
        try { download = await fetchImpl(url.href, {redirect: 'error', signal: AbortSignal.timeout(15_000)}); }
        catch { throw new Error('Observer log download failed'); }
        if (!download.ok) throw new Error('Observer logs are unavailable');
        return download.text();
    };
    return api;
}

export async function exerciseReruns(config, {api = githubAPI(config), now = Date.now,
    pause = ms => new Promise(resolve => setTimeout(resolve, ms)), record = () => {},
    timeoutMs = 25 * 60_000, intervalMs = 5_000} = {}) {
    const deadline = now() + timeoutMs;
    const evidence = {status: 'running', repository, sha: config.sha, branch: config.branch,
        suite: config.suite, trigger: config.event, schedule: config.schedule, probes: {}, pending: {}, mutations: []};
    const checkpoint = () => record(structuredClone(evidence));
    const wait = async (fn, label) => {
        while (now() < deadline) {
            const value = await fn();
            if (value) return value;
            await pause(Math.min(intervalMs, Math.max(0, deadline - now())));
        }
        throw new Error(`Timed out: ${label}`);
    };
    const source = async () => {
        const branch = await api(`branches/${encodeURIComponent(config.branch)}`);
        assert.equal(branch.commit?.sha, config.sha, 'Source branch advanced; refusing mixed revisions');
    };
    const workflow = async file => {
        const value = await api(`actions/workflows/${file}`);
        assert.ok(positive(value.id) && value.path === `.github/workflows/${file}` && value.state === 'active',
            'Unexpected test workflow identity');
        return value.id;
    };
    const identity = (run, workflowId, title) => {
        assert.ok(positive(run.id) && positive(run.run_number) && positive(run.run_attempt), 'Invalid run identity');
        for (const [key, value] of Object.entries({workflow_id: workflowId, head_sha: config.sha,
            head_branch: config.branch, event: 'workflow_dispatch', display_title: title})) {
            assert.equal(run[key], value, `Unexpected run ${key}`);
        }
        assert.equal(run.repository?.full_name, repository, 'Wrong run repository');
        assert.equal(run.head_repository?.full_name, repository, 'Wrong head repository');
    };
    const runs = async workflowId => {
        const query = new URLSearchParams({head_sha: config.sha, branch: config.branch,
            event: 'workflow_dispatch', per_page: '100'});
        const list = await api(`actions/workflows/${workflowId}/runs?${query}`);
        assert.ok(Array.isArray(list.workflow_runs), 'Invalid test run listing');
        return list.workflow_runs;
    };
    const dispatch = async (workflowId, title, inputs) => {
        await source();
        await api(`actions/workflows/${workflowId}/dispatches`, 'POST', {ref: config.branch,
            inputs: {suite_id: config.suite, expected_revision: config.sha, ...inputs}});
        evidence.mutations.push({operation: 'dispatch', workflowId, title}); checkpoint();
        return wait(async () => {
            const matches = (await runs(workflowId)).filter(run => run.display_title === title);
            assert.ok(matches.length <= 1, 'Ambiguous test run correlation');
            if (!matches[0]) return;
            identity(matches[0], workflowId, title);
            return matches[0];
        }, `registration of ${title}`);
    };
    try {
        checkpoint();
        const fixtureId = await workflow(fixtureFile), observerId = await workflow(probeFile);
        assert.notEqual(fixtureId, observerId, 'Fixture and observer must be distinct workflows');
        const fixtureTitle = `CI rerun fixture ${config.suite}`;
        const fixture = await dispatch(fixtureId, fixtureTitle, {});
        evidence.fixture = fixture; checkpoint();
        const currentFixture = async () => {
            const run = await api(`actions/runs/${fixture.id}`);
            identity(run, fixtureId, fixtureTitle);
            return run;
        };
        const latestFixture = async () => {
            const list = await runs(fixtureId);
            const newest = [...list].sort((a, b) => b.run_number - a.run_number)[0];
            assert.equal(newest?.id, fixture.id, 'Another fixture run interfered with this suite');
        };
        const complete = async (attempt, conclusion) => wait(async () => {
            const run = await currentFixture();
            assert.ok(run.run_attempt <= attempt, 'Unexpected external fixture rerun');
            if (run.run_attempt < attempt || run.status !== 'completed') return;
            assert.equal(run.conclusion, conclusion, 'Unexpected fixture conclusion');
            return run;
        }, `fixture attempt ${attempt} completion`);
        const probe = async scenario => {
            await latestFixture();
            const run = await dispatch(observerId, `CI rerun observer ${config.suite} ${scenario}`,
                {fixture_run_id: String(fixture.id), scenario});
            evidence.probes[scenario] = {run}; checkpoint();
            return run;
        };
        const finishProbe = async (scenario, run) => {
            const expected = scenarios[scenario];
            const finished = await wait(async () => {
                const value = await api(`actions/runs/${run.id}`);
                identity(value, observerId, run.display_title);
                assert.equal(value.run_attempt, 1, 'Observer was unexpectedly rerun');
                return value.status === 'completed' && value;
            }, `${scenario} observer completion`);
            assert.equal(finished.conclusion, expected.conclusion, 'Unexpected observer conclusion');
            const response = await api(`actions/runs/${run.id}/jobs?per_page=100`);
            const jobs = response.jobs;
            assert.ok(Array.isArray(jobs) && response.total_count === 3 && jobs.length === 3, 'Incomplete observer jobs');
            const results = Object.fromEntries(jobs.map(job => [job.name, job.conclusion]));
            assert.deepEqual(results, {'gate / gate': expected.conclusion,
                'publish-sentinel': expected.conclusion === 'success' ? 'success' : 'skipped', 'assert-probe': 'success'});
            const logs = await api.logs(jobs.find(job => job.name === 'assert-probe').id);
            const proofs = logs.split('\n').filter(line => line.includes(marker))
                .map(line => JSON.parse(line.slice(line.indexOf(marker) + marker.length)));
            assert.equal(proofs.length, 1, 'Missing or ambiguous observer proof');
            const proof = verifyDecision(proofs[0], {sha: config.sha, branch: config.branch,
                runId: fixture.id, scenario, gate: results['gate / gate'], sentinel: results['publish-sentinel']});
            const snapshot = await api(`actions/runs/${fixture.id}/attempts/${expected.attempt}`);
            identity(snapshot, fixtureId, fixtureTitle);
            assert.equal(snapshot.run_attempt, expected.attempt);
            assert.equal(snapshot.status, 'completed');
            assert.equal(snapshot.conclusion, expected.conclusion);
            const ciJobs = await api(`actions/runs/${fixture.id}/attempts/${expected.attempt}/jobs`);
            assert.ok(ciJobs.total_count === 1 && ciJobs.jobs.length === 1, 'Incomplete fixture jobs');
            if (expected.conclusion === 'success') {
                const gate = jobs.find(job => job.name === 'gate / gate');
                const sentinel = jobs.find(job => job.name === 'publish-sentinel');
                const times = [ciJobs.jobs[0].completed_at, proof.observedAt, gate.completed_at, sentinel.started_at].map(Date.parse);
                assert.ok(times.every(Number.isFinite) && times.every((time, i) => !i || time >= times[i - 1]),
                    'Downstream ran before the latest CI success was verified');
            }
            evidence.probes[scenario] = {run: finished, jobs, proof, ci: snapshot, ciJobs}; checkpoint();
        };
        const rerun = async (attempt, previousConclusion) => {
            await source(); await latestFixture();
            const current = await currentFixture();
            assert.equal(current.run_attempt, attempt - 1);
            assert.equal(current.status, 'completed'); assert.equal(current.conclusion, previousConclusion);
            await api(`actions/runs/${fixture.id}/rerun`, 'POST');
            evidence.mutations.push({operation: 'rerun', runId: fixture.id, attempt}); checkpoint();
            await wait(async () => {
                const run = await currentFixture();
                assert.ok(run.run_attempt <= attempt, 'Unexpected external fixture rerun');
                if (run.run_attempt < attempt) return;
                assert.notEqual(run.status, 'completed', 'Pending window missed before observer dispatch');
                return run.status === 'in_progress';
            }, `attempt ${attempt} start`);
        };
        const pending = async (scenario, run, attempt) => wait(async () => {
            const before = await currentFixture();
            assert.equal(before.run_attempt, attempt);
            assert.equal(before.status, 'in_progress', 'Pending observation window missed');
            assert.equal(before.conclusion, null);
            const response = await api(`actions/runs/${run.id}/jobs?per_page=100`);
            assert.ok(Array.isArray(response.jobs), 'Invalid pending observer jobs');
            assert.ok(!response.jobs.some(job => job.name === 'publish-sentinel' &&
                (job.status !== 'queued' || job.started_at)), 'Downstream started during CI execution');
            const gate = response.jobs.find(job => job.name === 'gate / gate');
            if (!gate || gate.status !== 'in_progress' || !gate.steps.some(step =>
                step.name === 'Require the latest matching normal CI to succeed' && step.status === 'in_progress')) return;
            const after = await currentFixture();
            assert.equal(after.run_attempt, attempt); assert.equal(after.status, 'in_progress'); assert.equal(after.conclusion, null);
            evidence.pending[scenario] = {observedAt: new Date(now()).toISOString(), before, jobs: response.jobs, after};
            checkpoint(); return true;
        }, `${scenario} live pending observation`);
        await complete(1, 'success');
        await finishProbe('baseline', await probe('baseline'));
        await rerun(2, 'success');
        const negative = await probe('pending-failure');
        await pending('pending-failure', negative, 2);
        await complete(2, 'failure'); await finishProbe('pending-failure', negative);
        await finishProbe('failed-fresh', await probe('failed-fresh'));
        await rerun(3, 'failure');
        const positive = await probe('success-after-wait');
        await pending('success-after-wait', positive, 3);
        await complete(3, 'success'); await finishProbe('success-after-wait', positive);
        await latestFixture();
        evidence.status = 'success'; checkpoint(); return evidence;
    } catch (error) {
        evidence.status = 'failure'; evidence.reason = error.message; checkpoint(); throw error;
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const redact = text => process.env.GH_TOKEN ? text.split(process.env.GH_TOKEN).join('[REDACTED]') : text;
    let latest;
    const save = state => {
        latest = state;
        mkdirSync('test-results/ci-rerun-test', {recursive: true});
        writeFileSync('test-results/ci-rerun-test/evidence.json', redact(JSON.stringify(state, null, 2)) + '\n');
    };
    let result;
    try {
        const config = configuration(process.env);
        result = await exerciseReruns(config, {record: save});
    }
    catch (error) { result = latest || {status: 'failure', reason: error.message}; console.error(redact(error.message)); process.exitCode = 1; }
    finally {
        if (!latest) save(result);
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
            `## Latest CI attempt test: ${result.status}\n\nTrigger: ${result.trigger || 'unverified'}\n\n` +
            (result.fixture ? `Fixture: https://github.com/${repository}/actions/runs/${result.fixture.id}\n\n` : '') +
            'The fixture and observers have no deployment credentials. See the evidence artifact and child runs.\n');
    }
}
