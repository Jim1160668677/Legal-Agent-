const path = require('path');
const helper = require('@tarojs/helper');
const service = require('@tarojs/service');

console.log('=== Debugging Taro Kernel ===');
console.log('getUserHomeDir():', JSON.stringify(helper.getUserHomeDir()));
console.log('TARO_GLOBAL_CONFIG_DIR:', JSON.stringify(helper.TARO_GLOBAL_CONFIG_DIR));

// Simulate Config.init with disableGlobalConfig
const config = {
  appPath: 'g:\\智能体设计\\legal-agent\\各版本\\taro',
  disableGlobalConfig: false
};

console.log('\n=== Test Config.init ===');
const Config = service.Config;
const c = new Config(config);
console.log('disableGlobalConfig:', c.disableGlobalConfig);
console.log('appPath:', c.appPath);

// Try init with command 'develop'
c.init({ command: 'develop' }).then(() => {
  console.log('init success');
  console.log('isInitSuccess:', c.isInitSuccess);
  console.log('initialConfig:', JSON.stringify(c.initialConfig, null, 2));

  // Now create Kernel
  console.log('\n=== Test Kernel ===');
  const kernel = new service.Kernel({
    appPath: 'g:\\智能体设计\\legal-agent\\各版本\\taro',
    presets: [path.resolve(__dirname, 'node_modules/@tarojs/cli/dist/presets/index.js')],
    config: c,
    plugins: []
  });
  console.log('kernel created');
  console.log('kernel.paths:', JSON.stringify(kernel.paths, null, 2));
}).catch(err => {
  console.error('init failed:', err.message);
  console.error(err.stack);
});
