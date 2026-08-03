const path = require('path');
const helper = require('@tarojs/helper');

// Direct call to get the value
const home = helper.getUserHomeDir();
const dir = helper.TARO_GLOBAL_CONFIG_DIR;
console.log('home:', JSON.stringify(home));
console.log('dir:', JSON.stringify(dir));
console.log('path:', JSON.stringify(path));
console.log('typeof home:', typeof home);
console.log('typeof dir:', typeof dir);
try {
  const result = path.join(home, dir);
  console.log('path.join result:', JSON.stringify(result));
} catch(e) {
  console.error('ERROR:', e.message);
  console.error('home type:', typeof home);
  console.error('dir type:', typeof dir);
  console.error('path:', typeof path);
}
