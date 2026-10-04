// Fails if app.js contains syntax newer than ES5 (webOS 3.x ships Chromium 38).
// Usage: npm i -g acorn && NODE_PATH=$(npm root -g) node scripts/check_es5.js
var fs = require('fs');
var path = require('path');
var acorn = require('acorn');
var file = path.join(__dirname, '..', 'app', 'app.js');
try {
  acorn.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 5 });
  console.log('OK: app.js is valid ES5');
} catch (e) {
  console.error('NOT ES5:', e.message);
  process.exit(1);
}
