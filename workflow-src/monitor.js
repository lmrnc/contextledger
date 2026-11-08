function monitor(snapshot) {
  const state = snapshot.data;
  const current = authorities(state);
  const latest = observations(state);
  const versions = byId(state.authority);
  const currentByEvidenceVersion = new Map(current.map(version => [evidenceVersion(version, versions), version]));
  const groups = new Map();
  const writes = [];
  const duplicateSets = new Map();

  function add(owner, department, kind, subject, action) {
    const key = owner || 'knowledge-admin';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ department, kind, subject, action });
  }
  for (const item of latest) {
    if (!item.owner) add(null, item.department, 'missing_owner', item.title, 'Ask the department champion to add the designated owner in the source.');
    const key = JSON.stringify([item.topic, item.content_hash, item.classification, item.allowed_groups]);
    if (!duplicateSets.has(key)) duplicateSets.set(key, []);
    duplicateSets.get(key).push(item);
  }
  const duplicates = [...duplicateSets.values()].filter(items => items.length > 1);
  for (const items of duplicates) {
    const [first] = items;
    add(first.owner, first.department, 'duplicate', items.map(item => item.provenance.locator).sort().join(' and '),
      'Keep a link to the approved source and retire redundant copies after checking their consumers.');
  }
  for (const version of current.filter(row => row.review_due_at < now)) {
    add(version.owner, version.department, 'overdue', version.title, 'Review the original source in the review desk.');
  }
  for (const row of state.quarantine.filter(item => item.status === 'open')) {
    add(null, 'Platform', 'invalid_metadata', row.id, 'Correct source fields: ' + row.errors.join(', ') + '. Re-run ingestion.');
  }
  for (const feed of state.feeds.filter(row => row.status === 'failed')) {
    add(null, 'Platform', 'source_failure', feed.id, 'Check endpoint health and authentication, then re-run ingestion.');
  }
  for (const review of state.reviews.filter(isOpen)) {
    const contributionPending = review.kind === 'contribution' && review.status === 'pending';
    add(contributionPending ? 'knowledge-admin' : review.owner, review.department, review.kind, review.topic,
      contributionPending ? 'Review the owner submission and decide whether to publish it.' :
        'Open the review desk, compare evidence and record an action.');
  }
  const closed = state.reviews.filter(review => !isOpen(review)).map(review => ({
    topic: review.topic, status: review.status, kind: review.kind, review_id: review.id, resulting_version: review.version ?? null
  }));
  for (const review of state.reviews.filter(row => row.kind === 'conflict' && row.status === 'approved')) {
    const authority = currentByEvidenceVersion.get(review.resulting_version);
    if (!authority) continue;
    const reviewedEvidence = new Set(review.evidence_ids);
    for (const item of latest.filter(row => reviewedEvidence.has(row.id) && row.claim && row.claim.value !== authority.claim?.value)) {
      add(authority.owner, authority.department, 'source_alignment', item.provenance.locator,
        'Update the old source or replace it with a link to the authoritative policy.');
    }
  }
  const grouped = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([owner, issues]) => ({
    owner, issues: issues.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }));
  const report = {
    id: now.slice(0, 10), generated_at: now, grouped, resolved_reviews: closed,
    counts: {
      latest_records: latest.length,
      complete_records: latest.filter(item => item.owner && (!snapshot.taxonomy.topics[item.topic][2] || item.claim)).length,
      owned_records: latest.filter(item => item.owner).length,
      quarantined_records: state.quarantine.filter(item => item.status === 'open').length,
      authoritative_topics: new Set(current.map(version => version.topic)).size,
      authority_versions: state.authority.length,
      current_streams: current.length,
      current_fresh_streams: current.filter(version => version.review_due_at >= now).length,
      duplicate_groups: duplicates.length,
      duplicate_surplus_records: duplicates.reduce((count, items) => count + items.length - 1, 0),
      open_reviews: state.reviews.filter(isOpen).length,
      audit_events: state.audit.length
    },
    audit_tail: state.audit.slice(-15).map(({ event, actor, at, topic, review_id, resulting_version }) =>
      ({ event, actor, at, topic, review_id, resulting_version }))
  };
  writes.push(put('reports', report));
  const sent = byId(state.notifications);
  for (const { owner, issues } of grouped) {
    // Mock Slack outbox. A stable fingerprint prevents repeated reminders for the same issue set on the same day.
    const id = 'notice-' + sha(JSON.stringify([report.id, owner, issues]));
    if (sent.has(id)) continue;
    writes.push(put('notifications', { id, channel: 'mock-slack', recipient: owner, issue_count: issues.length,
      report_date: report.id, created_at: now, status: 'queued_mock' }));
  }
  return { ...reply(200, { status: 'reported', ...report, new_mock_notifications: writes.length - 1 }), writes };
}
