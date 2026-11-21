const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');

test('release is published directly, because the updater cannot see drafts', () => {
  assert.equal(pkg.build.publish.length, 1);
  assert.equal(pkg.build.publish[0].releaseType, 'release');
});

test('one release run per tag at a time', () => {
  assert.match(workflow, /concurrency:\s*\n\s+group: release-\$\{\{ github\.ref \}\}\s*\n\s+cancel-in-progress: false/);
});

test('a release can be started by hand from the Actions tab, no tag needed', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /if: github\.event_name == 'workflow_dispatch' \|\| startsWith\(github\.ref, 'refs\/tags\/v'\)/);
});

test('a hand-started release refuses a version that already has a release', () => {
  assert.match(workflow, /gh release view "v\$VERSION"/);
});

test('the tag-matches-version check only runs for tag builds', () => {
  assert.match(workflow, /name: Tag must match package\.json version\n\s+if: startsWith\(github\.ref, 'refs\/tags\/v'\)/);
});
