import fs from 'fs';
import path from 'path';

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));

console.log('=== Package Information ===');
console.log('Name:', pkg.name);
console.log('Version:', pkg.version);
console.log('Description:', pkg.description);
console.log('\n=== Scripts ===');
Object.entries(pkg.scripts).forEach(([key, value]) => {
  console.log(`${key}: ${value}`);
});
console.log('\n=== Dependencies ===');
console.log('Production:', Object.keys(pkg.dependencies || {}).length, 'packages');
console.log('Dev:', Object.keys(pkg.devDependencies || {}).length, 'packages');
console.log('\n=== Main Entry ===');
console.log('Main:', pkg.main);
console.log('Types:', pkg.types);
