/** Debug CLI: print the pipeline for a query. `node pipe.mjs "<sql>"` (see README in validate.ts). */
import { makeDb } from './nodeDb';
import { buildPipeline } from '../engine/pipeline';

const sql = process.argv[2];
const level = process.argv[3];
const db = await makeDb();
const p = await buildPipeline(sql, db.runner, { recursiveLevel: level });
if (!p) {
  console.log('NOT STAGEABLE (parser returned null)');
  process.exit(1);
}
for (const s of p.stages) {
  console.log(`\n=== ${s.title} [${s.id}] ${s.inCount} → ${s.outCount}${s.error ? '  ERROR: ' + s.error : ''}`);
  for (const n of s.narration) console.log('  • ' + n);
  for (const n of s.impact) console.log('  ⚡ ' + n);
  for (const n of s.warn) console.log('  ⚠ ' + n);
  console.log('  cols:', s.columns.join(' | '));
  s.rows.slice(0, 6).forEach((r, i) => console.log('   ', s.rowTags?.[i] ?? '', s.groupIds?.[i] ?? '', JSON.stringify(r), s.checks ? JSON.stringify(s.checks.values[i]) : ''));
  if (s.groups) console.log('  groups:', s.groups.columns.join('|'), JSON.stringify(s.groups.rows.slice(0, 4)));
}
console.log('\nFINAL', p.final.rowCount, 'rows', p.final.columns);
process.exit(0);
