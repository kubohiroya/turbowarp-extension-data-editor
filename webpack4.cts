const path = require('node:path');

/** Connect webpack 4 to precompiled entries and the host's React singleton. */
interface WebpackConfig {
    resolve?: {alias?: Record<string, string>; symlinks?: boolean};
}
function withBlockEditorWebpack4(config: WebpackConfig, options: {hostRoot: string}): WebpackConfig;
function withBlockEditorWebpack4(config: WebpackConfig[], options: {hostRoot: string}): WebpackConfig[];
function withBlockEditorWebpack4(config: WebpackConfig | WebpackConfig[], {hostRoot}: {hostRoot: string}) {
    if (!path.isAbsolute(hostRoot || '')) throw new Error('hostRoot must be an absolute GUI root.');
    if (Array.isArray(config)) return config.map(item => withBlockEditorWebpack4(item, {hostRoot}));
    const prefix = '@kubohiroya/turbowarp-extension-data-editor';
    const alias = {...config.resolve?.alias};
    for (const entry of ['index', 'rjsf', 'react', 'turbowarp', 'schema']) {
        alias[`${prefix}${entry === 'index' ? '' : `/${entry}`}$`] = path.join(__dirname, 'dist/webpack4', `${entry}.js`);
    }
    alias[`${prefix}/react/styles.css$`] = path.join(__dirname, 'dist/react.css');
    alias['react$'] = require.resolve('react', {paths: [hostRoot]});
    for (const runtime of ['jsx-runtime', 'jsx-dev-runtime']) {
        alias[`react/${runtime}.js$`] = require.resolve(`react/${runtime}`, {paths: [hostRoot]});
    }
    alias['react-dom$'] = require.resolve('react-dom', {paths: [hostRoot]});
    return {...config, resolve: {...config.resolve, symlinks: true, alias}};
}
module.exports = {withBlockEditorWebpack4};
