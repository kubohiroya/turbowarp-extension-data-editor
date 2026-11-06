import {build} from 'esbuild';
import {rm} from 'node:fs/promises';

// Share chunks across all entry points to preserve registry and error class identities.
await rm('dist/webpack4', {recursive: true, force: true});
await build({
    entryPoints: ['webpack4.cts'],
    outfile: 'webpack4.cjs',
    platform: 'node',
    format: 'cjs',
    target: 'node24'
});
await build({
    entryPoints: ['dist/index.js', 'dist/rjsf.js', 'dist/react.js', 'dist/turbowarp.js', 'dist/schema.js'],
    outdir: 'dist/webpack4',
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2018',
    plugins: [{name: 'host-react', setup(builder) {
        builder.onResolve({filter: /^(react|react-dom)$/}, args => ({path: args.path, external: true}));
        builder.onResolve({filter: /^react\/jsx-(dev-)?runtime$/},
            args => ({path: `${args.path}.js`, external: true}));
    }}],
    chunkNames: 'shared-[hash]',
    sourcemap: true,
    metafile: true
}).then(async result => {
    const {writeFile} = await import('node:fs/promises');
    await writeFile('dist/webpack4/metafile.json', JSON.stringify(result.metafile, null, 2));
});
