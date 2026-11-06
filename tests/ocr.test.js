'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');

test('OCR local : PDF scanné et image reconnus (accents inclus), désactivable', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'build', 'ocr-smoke.js')], { encoding: 'utf8', timeout: 120000 });
  assert.match(out, /pdf-ocr/);
  assert.match(out, /Claire Dubois/);
  assert.match(out, /dirigé/);
  assert.match(out, /OCR off : PDF sans texte extractible/);
});
