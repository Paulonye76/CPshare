import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Sha256 } from '../public/js/lib/sha256.js';
import { sanitizeFilename, uniqueName, isRisky, categoryOf } from '../public/js/lib/filename.js';
import { validateManifest } from '../public/js/transfer.js';

test('streaming SHA-256 matches Node crypto for edge-case sizes and random chunking', () => {
  for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 65536, 100001]) {
    const b = randomBytes(n);
    const h = new Sha256();
    let i = 0;
    while (i < n) { const k = 1 + Math.floor(Math.random() * 300); h.update(new Uint8Array(b.subarray(i, i + k))); i += k; }
    assert.equal(h.hex(), createHash('sha256').update(b).digest('hex'), `size ${n}`);
  }
});

test('filenames are sanitized and de-duplicated', () => {
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('C:\\Windows\\evil.exe'), 'evil.exe');
  assert.equal(sanitizeFilename('a<b>:c|d?.txt'), 'a_b__c_d_.txt');
  assert.equal(sanitizeFilename('con.txt'), '_con.txt');
  assert.equal(sanitizeFilename('...'), 'file');
  assert.equal(sanitizeFilename('photo\u202egpj.exe'), 'photogpj.exe'); // bidi override removed
  assert.ok(sanitizeFilename('x'.repeat(500) + '.mp4').length <= 180);
  const used = new Set();
  assert.deepEqual([uniqueName('a.jpg', used), uniqueName('A.jpg', used), uniqueName('a.jpg', used)], ['a.jpg', 'A (1).jpg', 'a (2).jpg']);
  assert.ok(isRisky('setup.APK') && !isRisky('notes.txt'));
  assert.equal(categoryOf('x.docx'), 'Word');
});

test('manifest validation rejects hostile requests', () => {
  assert.equal(validateManifest(null).ok, false);
  assert.equal(validateManifest({ files: [] }).ok, false);
  assert.equal(validateManifest({ files: [{ name: 'a', size: -1 }] }).ok, false);
  assert.equal(validateManifest({ files: [{ name: 'a', size: 1.5 }] }).ok, false);
  assert.equal(validateManifest({ files: [{ name: 5, size: 1 }] }).ok, false);
  assert.equal(validateManifest({ files: Array.from({ length: 6000 }, () => ({ name: 'a', size: 1 })) }).ok, false);
  const ok = validateManifest({ files: [{ name: '../x.txt', size: 3 }, { name: 'x.txt', size: 4 }] });
  assert.ok(ok.ok);
  assert.deepEqual(ok.files.map((f) => f.name), ['x.txt', 'x (1).txt']);
  assert.equal(ok.totalSize, 7);
});
