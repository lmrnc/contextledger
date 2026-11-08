const feedAdapters = {
  slack: {
    list: body => body.messages,
    fields: row => ({ sourceId: row.ts, title: row.subject, content: row.text, url: row.permalink,
      created: row.posted_at, modified: row.edited_at, metadata: row.metadata })
  },
  notion: {
    list: body => body.results,
    fields: row => ({ sourceId: row.id, title: row.title,
      content: Array.isArray(row.blocks) && row.blocks.every(block => typeof block?.text === 'string')
        ? row.blocks.map(block => block.text).join('\n') : null,
      url: row.url, created: row.created_time, modified: row.last_edited_time, metadata: row.properties })
  },
  operations: {
    list: body => body.records,
    fields: row => ({ sourceId: row.record_id, title: row.summary, content: row.instructions, url: row.href,
      created: row.opened_at, modified: row.updated_at, metadata: row.fields })
  }
};
function normalize(system, raw, taxonomy) {
  const fields = feedAdapters[system].fields(raw || {});
  const { sourceId, title, content, url, created, modified } = fields;
  const meta = fields.metadata || {};
  const allowedGroups = taxonomy.classifications[meta.classification];
  const groups = Array.isArray(meta.groups) ? [...new Set(meta.groups)].sort() : [];
  const problems = [];
  const topic = typeof meta.topic === 'string' && Object.hasOwn(taxonomy.topics, meta.topic) && taxonomy.topics[meta.topic];
  if (typeof sourceId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(sourceId)) problems.push('source_document_id');
  if (!clean(title) || title.length > 150) problems.push('title');
  if (!clean(content) || content.length > 12000) problems.push('content');
  if (url !== 'https://northstar.example/' + system + '/' + sourceId) problems.push('source_url');
  if (!topic || topic[0] !== meta.department) problems.push('topic_or_department');
  if (!taxonomy.types.includes(meta.type)) problems.push('knowledge_type');
  if (!validDate(created) || !validDate(modified) || created > modified || modified > now) problems.push('source_dates');
  if (!validDate(meta.verified) || !validDate(meta.due) || meta.verified > meta.due || meta.verified > now) problems.push('verification_dates');
  if (!Array.isArray(allowedGroups) || groups.length !== 1 || !groups.every(group => allowedGroups.includes(group))) {
    problems.push('classification_or_groups');
  }
  if (problems.length) return { problems };
  const text = clean(content);
  const owner = meta.owner === taxonomy.departments[meta.department] ? meta.owner : null;
  const reference = system + ':' + sourceId;
  const rawHash = sha(JSON.stringify(raw));
  return { item: {
    id: 'rev-' + sha(reference + ':' + rawHash), knowledge_id: 'k-' + sha(reference),
    source_system: system, source_document_id: sourceId, source_url: url,
    title: clean(title), content: text, department: meta.department, topic: meta.topic,
    knowledge_type: meta.type, owner, created_at: created, last_modified_at: modified,
    source_verified_at: meta.verified, source_review_due_at: meta.due,
    content_hash: sha(text), raw_hash: rawHash, classification: meta.classification,
    allowed_groups: groups, approval_status: 'observed',
    confidence: 'source_observation', claim: extractClaim(topic[2], text),
    provenance: { adapter: system + '/v1', locator: reference, fetched_at: now }
  } };
}

function ingest(snapshot, responses) {
  const state = snapshot.data;
  const revisionIds = new Set(state.observations.map(row => row.id));
  const head = new Map(observations(state).map(row => [row.knowledge_id, row]));
  const streams = new Set(state.authority.map(row => row.stream));
  const priorFeeds = byId(state.feeds);
  const quarantined = byId(state.quarantine);
  const writes = [];
  const summary = {};
  for (const [system, response] of Object.entries(responses)) {
    const totals = { inserted: 0, unchanged: 0, quarantined: 0, obsolete: 0, baseline_imported: 0 };
    const body = response?.body ?? response;
    const rows = feedAdapters[system].list(body || {});
    const healthy = !response?.error && (response?.statusCode ?? 200) === 200 && Array.isArray(rows) && rows.length <= 500;
    summary[system] = { status: healthy ? 'ok' : 'failed', ...totals };
    const sourceSummary = summary[system];
    if (priorFeeds.get(system)?.status !== sourceSummary.status) {
      writes.push(put('feeds', { id: system, status: sourceSummary.status, at: now }));
      writes.push(audit('feed_' + sourceSummary.status, snapshot.actor.id, { source_system: system }));
    }
    if (!healthy) continue;
    const seenIds = new Set();
    for (const [index, raw] of rows.entries()) {
      const { item, problems } = normalize(system, raw, snapshot.taxonomy);
      const previous = item && head.get(item.knowledge_id);
      const errors = problems || [];
      if (item && seenIds.has(item.knowledge_id)) errors.push('duplicate_source_id');
      if (item) seenIds.add(item.knowledge_id);
      if (previous && previous.last_modified_at === item.last_modified_at && previous.id !== item.id) {
        errors.push('modified_time_collision');
      }
      const reportedId = clean(feedAdapters[system].fields(raw || {}).sourceId);
      const quarantineId = system + ':' + (/^[a-z0-9-]{1,80}$/.test(reportedId) ? reportedId : 'row-' + index);
      if (errors.length) {
        const prior = quarantined.get(quarantineId);
        if (prior?.status !== 'open' || JSON.stringify(prior.errors) !== JSON.stringify(errors)) {
          writes.push(put('quarantine', { id: quarantineId, source_system: system, errors, status: 'open', at: now }));
        }
        sourceSummary.quarantined++;
        continue;
      }
      if (quarantined.get(quarantineId)?.status === 'open') {
        writes.push(put('quarantine', { ...quarantined.get(quarantineId), status: 'cleared', cleared_at: now }));
      }
      if (revisionIds.has(item.id)) {
        sourceSummary.unchanged++;
        continue;
      }
      if (previous && previous.last_modified_at > item.last_modified_at) {
        sourceSummary.obsolete++;
        continue;
      }
      revisionIds.add(item.id);
      head.set(item.knowledge_id, item);
      writes.push(put('observations', item));
      sourceSummary.inserted++;
      const attested = snapshot.manifests[system + ':' + item.source_document_id] === item.raw_hash;
      const stream = item.topic + ':' + item.knowledge_id;
      if (attested && item.owner && (!snapshot.taxonomy.topics[item.topic][2] || item.claim) &&
          !streams.has(stream) && !state.authority.some(version => version.topic === item.topic && version.version > 1)) {
        const entry = verifiedVersion(item, stream, null, 'baseline-migration', item.source_verified_at, 'bootstrap');
        writes.push(put('authority', entry), audit('baseline_imported', snapshot.actor.id, { topic: item.topic, version_id: entry.id }));
        streams.add(stream);
        sourceSummary.baseline_imported++;
      }
    }
  }
  const failed = Object.values(summary).some(feed => feed.status === 'failed');
  return { ...reply(failed ? 207 : 200, { status: failed ? 'partial' : 'ingested', sources: summary }), writes };
}
