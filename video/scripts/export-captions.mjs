import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const write = (path, content) => writeFileSync(new URL('../' + path, import.meta.url), content);
const groups = JSON.parse(read('src/captions.json'));
const title = {
  problem: 'Three conflicting sources',
  ingestion: 'Ingest and validate',
  governance: 'Evidence and ownership',
  'escalation-review': 'Support reviews the escalation change',
  contribution: 'A department owner proposes a procedure',
  'pending-retrieval': 'The employee asks before approval',
  'steward-approval': 'A separate steward approves',
  'approved-retrieval': 'The employee asks again',
  'restricted-retrieval': 'Restricted context stays hidden',
  'quality-report': 'Quality worklist and closing'
};
const time = ms => new Date(ms).toISOString().slice(11, 23).replace('.', ',');
const readingTime = ms => time(ms).slice(3, 8) + (ms % 1000 ? '.' + Math.floor(ms % 1000 / 100) : '');
let offset = 0;
let index = 1;
const srt = [];
const script = ['# English narration script', '',
  'Read in your own voice. Each time range matches the on-screen footage and SRT. Leave short pauses where the text ends early.',
  'Mute the demo while recording. Start the file at 00:00 and keep it to 90 seconds. Say HTTP and MCP as letters, and n8n as “en-eight-en”.', ''];
for (const [name, cues] of Object.entries(groups)) {
  const duration = cues.at(-1).endMs;
  script.push('## ' + readingTime(offset) + '–' + readingTime(offset + duration) + ' · ' + title[name], '');
  let previous = 0;
  for (const cue of cues) {
    assert.equal(cue.startMs, previous);
    assert.ok(cue.endMs > cue.startMs && cue.text.split('\n').length <= 2);
    srt.push([index++, time(offset + cue.startMs) + ' --> ' + time(offset + cue.endMs), cue.text].join('\n'));
    script.push('**' + readingTime(offset + cue.startMs) + '–' + readingTime(offset + cue.endMs) + '**  ',
      cue.text.replaceAll('\n', ' '), '');
    previous = cue.endMs;
  }
  offset += duration;
}
assert.equal(offset, 90000);
write('ContextLedger_Demo_90s.srt', srt.join('\n\n') + '\n');
write('NARRATION.md', script.join('\n'));
console.log((index - 1) + ' aligned English cues over ' + offset / 1000 + ' seconds');
