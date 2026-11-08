import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
export const taxonomy = read('../data/taxonomy.json');
const { records } = read('../data/northstar.json');
export const sha = value => createHash('sha256').update(value).digest('hex');
export const sourceNames = ['slack', 'notion', 'operations'];

export function sourceData(anchor, system, scenario) {
  const at = days => new Date(Date.parse(anchor) + days * 86400000).toISOString();
  const normalized = records.filter(([source]) => source === system).map(row => {
    const [, id, topic, title, content, type, , options = {}] = row;
    const [department] = taxonomy.topics[topic];
    const modified = options.modified ?? -14;
    return {
      id, topic, title, content, type, department,
      owner: options.missingOwner ? null : taxonomy.departments[department],
      created: at(-170), modified: at(modified),
      verified: at(options.verified ?? -7), due: at(options.due ?? 83),
      classification: options.restricted ? 'restricted' : 'internal',
      groups: [options.restricted || 'employees'],
      link: 'https://northstar.example/' + system + '/' + id
    };
  });
  if (system === 'operations' && scenario === 'revision') {
    const rollback = normalized.find(row => row.id === 'rollback-guide');
    rollback.content += ' Record the rollback in the incident timeline.';
    rollback.modified = at(0);
  }
  if (system === 'operations' && scenario === 'malformed') {
    normalized.push({ ...normalized[0], id: 'invalid-scope-test', classification: 'unknown' });
  }
  switch (system) {
    case 'slack':
      return { messages: normalized.map(({ id, title, content, link, created, modified, ...metadata }) =>
        ({ ts: id, subject: title, text: content, permalink: link, posted_at: created, edited_at: modified, metadata })) };
    case 'notion':
      return { results: normalized.map(({ id, title, content, link, created, modified, ...properties }) =>
        ({ id, title, blocks: [{ text: content }], url: link, created_time: created, last_edited_time: modified, properties })) };
    case 'operations':
      return { records: normalized.map(({ id, title, content, link, created, modified, ...fields }) =>
        ({ record_id: id, summary: title, instructions: content, href: link, opened_at: created, updated_at: modified, fields })) };
  }
}

export function baseline(anchor) {
  // The fixture's migration manifest is independent of the feed response.
  // A source cannot make itself authoritative by asserting an approval flag.
  const manifests = {};
  for (const system of sourceNames) {
    const body = sourceData(anchor, system);
    const rows = body.messages || body.results || body.records;
    for (const row of rows) {
      const id = row.ts || row.id || row.record_id;
      if (records.some(record => record[0] === system && record[1] === id && record[6])) {
        manifests[system + ':' + id] = sha(JSON.stringify(row));
      }
    }
  }
  return manifests;
}
