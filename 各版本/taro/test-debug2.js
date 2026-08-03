const path = require('path');
const helper = require('@tarojs/helper');
const service = require('@tarojs/service');

console.log('=== Debug ===');
console.log('getUserHomeDir:', helper.getUserHomeDir());
console.log('TARO_GLOBAL_CONFIG_DIR:', helper.TARO_GLOBAL_CONFIG_DIR);
console.log('typeof getUserHomeDir:', typeof helper.getUserHomeDir());
console.log('typeof TARO_GLOBAL_CONFIG_DIR:', typeof helper.TARO_GLOBAL_CONFIG_DIR);

// Now check what helper Kernel.js uses
const fs = require('fs');
const kernelCode = fs.readFileSync(require.resolve('@tarojs/service/dist/Kernel.js'), 'utf8');
console.log('\nKernel.js helper require:', kernelCode.includes('require("@tarojs/helper")') ? 'yes' : 'no');

// Check if the Kernel uses a different helper instance
const kernelHelper = require('@tarojs/helper');
console.log('\nKernel helper getUserHomeDir:', kernelHelper.getUserHomeDir());
console.log('Kernel helper TARO_GLOBAL_CONFIG_DIR:', kernelHelper.TARO_GLOBAL_CONFIG_DIR);

// Direct path.join test
const h = kernelHelper.getUserHomeDir();
const d = kernelHelper.TARO_GLOBAL_CONFIG_DIR;
console.log('\nDirect path.join:', path.join(h, d));

// Try with the exact same code pattern as Kernel.js
const result = path.join(kernelHelper.getUserHomeDir(), kernelHelper.TARO_GLOBAL_CONFIG_DIR);
console.log('path.join result:', JSON.stringify(result));
