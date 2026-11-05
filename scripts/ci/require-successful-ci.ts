import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const pending = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);

export function configuration(env) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || '')) throw new Error('Invalid caller repository');
    if (!sha(env.EXPECTED_REVISION)) throw new Error('Expected revision must be a full SHA');
    if (!/^[\w.-]+\.ya?ml$/.test(env.CI_WORKFLOW_FILE || '')) throw new Error('Invalid workflow file');
    if (!env.CI_BRANCH || /[\s?#]/.test(env.CI_BRANCH)) throw new Error('Invalid CI branch');
    if (!/^[a-z_]+$/.test(env.CI_EVENT || '')) throw new Error('Invalid CI event');
    if (!env.GH_TOKEN) throw new Error('Read-only GH_TOKEN is required');
    const api = env.GITHUB_API_URL || 'https://api.github.com';
    const url = new URL(api);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        throw new Error('Invalid GitHub API URL');
    }
    return {repository: env.GITHUB_REPOSITORY, revision: env.EXPECTED_REVISION,
        workflowFile: env.CI_WORKFLOW_FILE, branch: env.CI_BRANCH, event: env.CI_EVENT,
        token: env.GH_TOKEN, api: api.replace(/\/$/, '')};
}

function validateRun(run, config, workflowId) {
    if (!positive(run?.id) || !positive(run.run_number) || !positive(run.run_attempt) ||
        run.workflow_id !== workflowId || run.repository?.full_name !== config.repository ||
        run.head_repository?.full_name !== config.repository || run.head_sha !== config.revision ||
        run.head_branch !== config.branch || run.event !== config.event ||
        typeof run.html_url !== 'string' || !run.html_url.endsWith(`/actions/runs/${run.id}`)) {
        throw new Error('CI run identity could not be verified');
    }
}

export async function requireSuccessfulCI(config, {fetchImpl = fetch, now = Date.now,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 1_800_000,
    intervalMs = 15_000, report = () => {}} = {}) {
    const deadline = now() + timeoutMs;
    const evidence = {stage: 'normal-ci-gate', repository: config.repository,
        expectedRevision: config.revision, workflowFile: config.workflowFile,
        branch: config.branch, event: config.event, decision: 'rejected'};
    const observe = detail => {
        Object.assign(evidence, detail, {observedAt: new Date(now()).toISOString()});
        report({...evidence});
    };
    const get = async path => {
        const remaining = deadline - now();
        if (remaining <= 0) throw new Error('Timed out waiting for normal CI');
        let response;
        try {
            response = await fetchImpl(`${config.api}/repos/${config.repository}/actions/${path}`, {
                headers: {Accept: 'application/vnd.github+json', Authorization: `Bearer ${config.token}`,
                    'X-GitHub-Api-Version': '2022-11-28'},
                signal: AbortSignal.timeout(Math.min(15_000, remaining)), redirect: 'error'
            });
        } catch {
            // Do not echo network errors, request headers or response bodies containing secrets.
            throw new Error('GitHub Actions API request failed');
        }
        if (!response.ok) throw new Error(`GitHub Actions API returned HTTP ${response.status}`);
        try { return await response.json(); } catch { throw new Error('Invalid GitHub Actions API JSON'); }
    };
    const wait = async reason => {
        observe({reason});
        if (now() >= deadline) throw new Error('Timed out waiting for normal CI');
        await sleep(Math.min(intervalMs, deadline - now()));
    };
    try {
        const workflow = await get(`workflows/${encodeURIComponent(config.workflowFile)}`);
        if (!positive(workflow.id) || workflow.path !== `.github/workflows/${config.workflowFile}` ||
            workflow.state !== 'active') throw new Error('CI workflow identity could not be verified');
        evidence.workflowId = workflow.id;
        while (now() < deadline) {
            const query = new URLSearchParams({head_sha: config.revision, branch: config.branch,
                event: config.event, per_page: '100'});
            const list = await get(`workflows/${workflow.id}/runs?${query}`);
            // A truncated listing could hide a newer run. Never guess from partial results.
            if (!Array.isArray(list.workflow_runs) || !Number.isSafeInteger(list.total_count) ||
                list.total_count !== list.workflow_runs.length || list.total_count > 100) {
                throw new Error('Incomplete CI run listing');
            }
            for (const run of list.workflow_runs) validateRun(run, config, workflow.id);
            const selected = [...list.workflow_runs].sort((a, b) => b.run_number - a.run_number || b.id - a.id)[0];
            if (!selected) { await wait('Waiting for the matching normal CI run to register'); continue; }
            const run = await get(`runs/${selected.id}`);
            validateRun(run, config, workflow.id);
            if (run.id !== selected.id || run.run_number !== selected.run_number ||
                run.run_attempt < selected.run_attempt) throw new Error('Inconsistent CI run/attempt');
            observe({runId: run.id, runUrl: run.html_url, attempt: run.run_attempt,
                status: run.status, conclusion: run.conclusion});
            if (run.status === 'completed') {
                if (run.conclusion !== 'success') throw new Error(`Normal CI concluded ${run.conclusion || 'unknown'}`);
                // Re-list and re-read immediately before accepting, including newly started reruns.
                const latest = await get(`workflows/${workflow.id}/runs?${query}`);
                if (!Array.isArray(latest.workflow_runs) || latest.total_count !== latest.workflow_runs.length ||
                    latest.total_count > 100) throw new Error('Incomplete final CI run listing');
                for (const item of latest.workflow_runs) validateRun(item, config, workflow.id);
                const newest = [...latest.workflow_runs].sort((a, b) => b.run_number - a.run_number || b.id - a.id)[0];
                if (!newest) throw new Error('CI run disappeared before acceptance');
                if (newest.id !== run.id || newest.run_attempt !== run.run_attempt) {
                    await wait('A newer normal CI run/attempt was observed'); continue;
                }
                const final = await get(`runs/${run.id}`);
                validateRun(final, config, workflow.id);
                if (final.id !== run.id || final.run_number !== run.run_number ||
                    final.run_attempt !== run.run_attempt || final.status !== 'completed' || final.conclusion !== 'success') {
                    await wait('Normal CI changed before acceptance'); continue;
                }
                observe({decision: 'accepted', reason: 'Latest matching normal CI workflow succeeded'});
                return {...evidence};
            }
            if (!pending.has(run.status) || run.conclusion !== null) throw new Error('Unverifiable CI run status');
            await wait('Waiting for the latest matching normal CI workflow to complete');
        }
        throw new Error('Timed out waiting for normal CI');
    } catch (error) {
        observe({decision: 'rejected', reason: error.message});
        throw error;
    }
}

export async function main(env = process.env) {
    const output = resolve('test-results/ci-gate/decision.json');
    let evidence = {stage: 'normal-ci-gate', decision: 'rejected', observedAt: new Date().toISOString()};
    let failed = false;
    const redact = text => env.GH_TOKEN ? text.split(env.GH_TOKEN).join('[REDACTED]') : text;
    try {
        await requireSuccessfulCI(configuration(env), {report: value => {
            evidence = value;
            console.log(redact(JSON.stringify(value)));
        }});
    } catch (error) {
        failed = true;
        evidence = {...evidence, decision: 'rejected', reason: error.message};
        console.error(redact(error.message));
    } finally {
        const json = redact(JSON.stringify(evidence, null, 2));
        mkdirSync(dirname(output), {recursive: true});
        writeFileSync(output, `${json}\n`);
        if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY,
            `## Normal CI publication gate: ${evidence.decision}\n\n\`\`\`json\n${json}\n\`\`\`\n`);
    }
    return failed ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    process.exitCode = await main();
}
