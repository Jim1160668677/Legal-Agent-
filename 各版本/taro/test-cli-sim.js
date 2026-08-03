// Simulate the Taro CLI flow
const path = require('path');
const helper = require('@tarojs/helper');
const service = require('@tarojs/service');

const appPath = 'g:\\智能体设计\\legal-agent\\各版本\\taro';

// Set up global config like CLI does
process.env.NODE_ENV = 'development';
process.env.TARO_ENV = 'h5';

console.log('=== Simulating Taro CLI ===');
console.log('appPath:', appPath);
console.log('getUserHomeDir:', helper.getUserHomeDir());
console.log('TARO_GLOBAL_CONFIG_DIR:', helper.TARO_GLOBAL_CONFIG_DIR);

// Step 1: Create Config
const config = new service.Config({
  appPath: appPath,
  disableGlobalConfig: false
});

config.init({ command: 'develop', mode: 'development' }).then(() => {
  console.log('\nConfig init success');
  console.log('isInitSuccess:', config.isInitSuccess);
  console.log('initialConfig:', JSON.stringify(config.initialConfig, null, 2));

  // Step 2: Create Kernel
  const presetsPath = path.resolve('./node_modules/@tarojs/cli/dist/presets');
  const kernel = new service.Kernel({
    appPath: appPath,
    presets: [path.resolve(presetsPath, 'index.js')],
    config: config,
    plugins: []
  });
  console.log('\nKernel created');
  console.log('kernel.paths:', JSON.stringify(kernel.paths, null, 2));
  console.log('SUCCESS!');
}).catch(err => {
  console.error('\nConfig init failed:', err.message);
  console.error(err.stack);
});
