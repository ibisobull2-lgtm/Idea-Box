import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert(duplicates.length === 0, `Duplicate HTML IDs: ${[...new Set(duplicates)].join(', ')}`);

for (const id of [
  'ideaForm', 'ideaName', 'ideaDesc', 'ideaCustomer', 'ideaPrice',
  'ideaCost', 'ideaStartup', 'ideaSales', 'ideaMonths', 'ideaMonthlyCosts',
  'exportData', 'importDataButton', 'importDataFile', 'clearData',
  'moneymind_transactions'
]) assert(html.includes(id), `Expected app feature/reference missing: ${id}`);

assert(/PLANNING READINESS SCORE/.test(html), 'Analyzer must label its score as planning readiness.');
assert(/not a probability of business success/i.test(html), 'Analyzer must explain the score limitation.');
assert(/not synced to an online account/i.test(html), 'Local-only data disclosure is missing.');
assert(/schemaVersion:\s*1/.test(html), 'Backup schema version is missing.');
assert(/data\.app\s*!==\s*'MoneyMind'/.test(html), 'Backup import must validate the app marker.');
assert(/confirm\('Restore this backup/.test(html), 'Backup restore must confirm replacement before writing.');

const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).filter(script => script.trim());
assert(scripts.length > 0, 'No inline JavaScript was found.');

for (const [index, script] of scripts.entries()) {
  const path = join(tmpdir(), `moneymind-inline-${process.pid}-${index}.js`);
  try {
    writeFileSync(path, script, 'utf8');
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    if (result.status !== 0) failures.push(`JavaScript syntax check failed for inline script ${index + 1}: ${result.stderr || result.stdout}`);
  } finally {
    try { unlinkSync(path); } catch {}
  }
}

if (failures.length) {
  console.error('MoneyMind checks failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('MoneyMind static checks passed. These checks do not replace browser, security, or load testing.');
