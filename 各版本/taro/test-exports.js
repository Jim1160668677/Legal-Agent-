const path = require('path');
const service = require('@tarojs/service');

console.log('typeof service:', typeof service);
console.log('service keys:', Object.keys(service));
console.log('service.Kernel:', typeof service.Kernel);
console.log('service.default:', typeof service.default);
console.log('service.default?.Kernel:', typeof service.default?.Kernel);

// Check what's exported
console.log('\n=== Checking exports ===');
console.log('service (require result):', typeof service, Object.keys(service || {}));

if (service.default) {
  console.log('service.default keys:', Object.keys(service.default));
  console.log('service.default.Kernel:', typeof service.default.Kernel);
}
console.log('service.Kernel:', typeof service.Kernel);
