const path = require('path');
const JavaScriptObfuscator = require('webpack-obfuscator');

module.exports = {
  target: 'node',
  mode: 'production',
  entry: './dist/extension.js',
  output: {
    path: path.resolve(__dirname, 'dist-obfuscated'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    extensions: ['.js']
  },
  plugins: [
    new JavaScriptObfuscator({
      rotateStringArray: true,
      stringArray: true,
      stringArrayThreshold: 0.8,
      stringArrayEncoding: ['base64'],
      unicodeEscapeSequence: false,
      identifierNamesGenerator: 'hexadecimal',
      renameGlobals: false,
      transformObjectKeys: true,
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.75,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.4,
      debugProtection: false,
      debugProtectionInterval: 0,
      disableConsoleOutput: false,
      selfDefending: true,
      sourceMap: false,
      splitStrings: true,
      splitStringsChunkLength: 10
    }, ['node_modules/**/*'])
  ]
};