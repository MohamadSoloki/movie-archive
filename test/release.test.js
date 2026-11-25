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

test('one release run per version at a time', () => {
  assert.match(workflow, /concurrency:\s*\n\s+group: release-\$\{\{ github\.event\.inputs\.version \|\| github\.ref \}\}\s*\n\s+cancel-in-progress: false/);
});

test('a release is started by hand with a typed version, or by a tag', () => {
  assert.match(workflow, /workflow_dispatch:\s*\n\s+inputs:\s*\n\s+version:\s*\n(?:\s+.*\n)*?\s+required: true/);
  assert.match(workflow, /tags: \['v\*'\]/);
  assert.match(workflow, /if: github\.event_name == 'workflow_dispatch' \|\| startsWith\(github\.ref, 'refs\/tags\/v'\)/);
});

test('the typed version never goes into a shell script directly, only through an env variable', () => {
  const runs = workflow.split('\n').filter((l) => /^\s+run:/.test(l) || /^\s{12,}\S/.test(l));
  assert.ok(!runs.some((l) => /\$\{\{\s*github\.event\.inputs/.test(l) && !/^\s+(INPUT_VERSION|VERSION):/.test(l)));
  assert.match(workflow, /INPUT_VERSION: \$\{\{ github\.event\.inputs\.version \}\}/);
});

test('the version is checked, written into package.json at build time, and must be new', () => {
  assert.match(workflow, /\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
  assert.match(workflow, /pkg\.version = process\.env\.VERSION/);
  assert.match(workflow, /gh release view "v\$VERSION"/);
});

test('a hand-started release creates its tag first: GitHub refuses a published release without one', () => {
  assert.match(workflow, /if: github\.event_name == 'workflow_dispatch'\s*\n\s+shell: bash\s*\n\s+env:\s*\n\s+GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}\s*\n\s+INPUT_VERSION: \$\{\{ github\.event\.inputs\.version \}\}\s*\n\s+run: \|[\s\S]*gh api "repos\/\$GITHUB_REPOSITORY\/git\/refs"[\s\S]*refs\/tags\/v\$\{VERSION\}/);
  assert.ok(workflow.indexOf('git/refs') < workflow.indexOf('electron-builder'));
});

test('the release is made once, as a draft, before any build: parallel publishers would each create it (422 already_exists)', () => {
  const create = workflow.indexOf('gh release create "v$VERSION" --draft');
  assert.ok(create > 0, 'draft release is created by the workflow');
  assert.ok(workflow.indexOf('git/refs') < create && create < workflow.indexOf('npx electron-builder'));
  assert.match(workflow, /echo "version=\$VERSION" >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /VERSION: \$\{\{ needs\.draft\.outputs\.version \}\}/);
});

test('Windows and Linux are built side by side into that draft, and the draft is published after both', () => {
  assert.match(workflow, /matrix:[\s\S]*os: windows-latest[\s\S]*flag: --win[\s\S]*os: ubuntu-latest[\s\S]*flag: --linux/);
  assert.match(workflow, /npx electron-builder \$\{\{ matrix\.flag \}\} --publish always/);
  assert.match(workflow, /publish:\s*\n\s+needs: \[draft, build\]/);
  assert.match(workflow, /gh release edit "v\$VERSION" --draft=false --latest/);
  assert.ok(workflow.indexOf('npx electron-builder') < workflow.indexOf('--draft=false'));
});

test('a failed run removes the unfinished draft (and the tag it made), but never a release that existed before', () => {
  assert.match(workflow, /if: failure\(\) && needs\.draft\.result == 'success'[\s\S]*gh release delete "v\$VERSION" --yes/);
});

test('the Linux build is an AppImage, named without spaces so the update file points at it', () => {
  assert.equal(pkg.build.linux.target, 'AppImage');
  assert.equal(pkg.build.linux.artifactName, 'Movie-Archive-${version}.${ext}');
});
