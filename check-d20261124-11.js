// D-20261124-11: Leo phone tour links carry src=leo-phone (English and Spanish), nothing else about the text changes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const start = src.indexOf('function tourLinkFor_');
const end = src.indexOf('\n}\n', start) + 3;
const fn = new Function(src.slice(start, end) + '\nreturn tourLinkFor_;')();
test('S1 English link has src=leo-phone', () => {
  assert.equal(fn({ tour_link: 'https://mattgabmanagement.com/tour.php?property=nmf' }, false), 'https://mattgabmanagement.com/tour.php?property=nmf&src=leo-phone');
});
test('S2 Spanish link keeps lang=es after the source tag', () => {
  assert.equal(fn({ tour_link: 'https://mattgabmanagement.com/tour.php?property=windsong' }, true), 'https://mattgabmanagement.com/tour.php?property=windsong&src=leo-phone&lang=es');
});
test('S3 empty link stays empty', () => { assert.equal(fn({}, true), ''); assert.equal(fn(null, false), ''); });
test('S4 the texted sentence still uses tourLinkFor_ and the two base links are unchanged', () => {
  assert.match(src, /Here's the link to book your tour at \$\{property\.name\}:\\n\$\{tourLinkFor_\(property, session\.isSpanish\)\}/);
  assert.match(src, /tour_link: 'https:\/\/mattgabmanagement\.com\/tour\.php\?property=nmf'/);
  assert.match(src, /tour_link: 'https:\/\/mattgabmanagement\.com\/tour\.php\?property=windsong'/);
});
