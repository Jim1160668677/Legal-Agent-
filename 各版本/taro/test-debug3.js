const path = require('path');
const helper = require('@tarojs/helper');
const service = require('@tarojs/service');

console.log('=== Detailed Debug ===');
console.log('helper:', typeof helper);
console.log('helper keys:', Object.keys(helper).filter(k => k.includes('HOME') || k.includes('home') || k.includes('TARO')).join(', '));
console.log('getUserHomeDir:', typeof helper.getUserHomeDir);
console.log('getUserHomeDir():', helper.getUserHomeDir());
console.log('TARO_GLOBAL_CONFIG_DIR:', helper.TARO_GLOBAL_CONFIG_DIR);

// Check if it's a function or value
console.log('\ntypeof helper.getUserHomeDir:', typeof helper.getUserHomeDir);

// Simulate the exact Kernel code path
try {
  const globalConfigRootPath = path.join(helper.getUserHomeDir(), helper.TARO_GLOBAL_CONFIG_DIR);
  console.log('path.join works:', globalConfigRootPath);
} catch(e) {
  console.error('path.join failed:', e.message);
  console.error('getUserHomeDir result:', JSON.stringify(helper.getUserHomeDir()));
  console.error('TARO_GLOBAL_CONFIG_DIR:', JSON.stringify(helper.TARO_GLOBAL_CONFIG_DIR));
}

// Check the Kernel constructor
const kernel = new service.Kernel({
  appPath: 'g:\\智能体设计\\legal-agent\\各版本\\taro',
  config: {
    initialConfig: { framework: 'react', sourceRoot: 'src', outputRoot: 'dist' },
    isInitSuccess: true
  },
  presets: [],
  plugins: []
});
console.log('\nKernel created:', !!kernel);
console.log('kernel.paths:', JSON.stringify(kernel.paths, null, 2));
