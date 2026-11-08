const abstain = () => reply(200, { status: 'abstained', answer: 'No verified context is available for this request.', citations: [] });
function retrieve(snapshot, request) {
  if (!snapshot.actor || snapshot.denied) return identityError(snapshot);
  const question = clean(request?.question);
  if (question.length < 3 || question.length > 300) return reply(400, { status: 'invalid_question' });
  const normalized = question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const padded = ' ' + normalized + ' ';
  const state = snapshot.data;
  const source = byId(state.observations);
  const latest = new Map(observations(state).map(item => [item.knowledge_id, item]));
  const quarantined = new Set(state.quarantine.filter(row => row.status === 'open').map(row => row.id));
  const accessible = version => {
    const record = source.get(version.observation_id);
    const head = latest.get(record?.knowledge_id);
    return hasScope(snapshot.actor, version) && hasScope(snapshot.actor, record) &&
      head && sameScope(head, record) && !quarantined.has(record.provenance.locator);
  };
  const visible = authorities(state).filter(accessible);
  const topicMatches = new Set(visible.filter(version => snapshot.taxonomy.topics[version.topic][1]
    .some(alias => padded.includes(' ' + alias + ' '))).map(version => version.topic));
  if (topicMatches.size !== 1) return abstain();
  const [topic] = topicMatches;
  const selected = visible.filter(version => version.topic === topic);
  const visibleReview = review => review.topic === topic && isOpen(review) && review.evidence_ids.every(id => {
    const item = source.get(id);
    return hasScope(snapshot.actor, item) && sameScope(latest.get(item.knowledge_id), item) && !quarantined.has(item.provenance.locator);
  });
  const unresolved = state.reviews.filter(visibleReview).map(row => ({ kind: row.kind, status: row.status, priority: row.priority }));
  const current = selected[0];
  const record = source.get(current.observation_id);
  if (new Set(selected.map(version => version.claim?.value ?? source.get(version.observation_id).content_hash)).size > 1) {
    return reply(200, { status: 'conflict', answer: 'Approved sources disagree. A knowledge owner must reconcile the evidence.',
      citations: selected.map(version => citation(source.get(version.observation_id))), unresolved_conflicts: unresolved });
  }
  if (selected.some(version => version.review_due_at < now)) {
    return reply(200, { ...abstain().payload, status: 'stale', freshness: 'overdue', unresolved_conflicts: unresolved });
  }
  const payload = {
    status: 'verified', topic, answer: evidenceText(record), authoritative_version: current.version,
    version_id: current.id, last_verified_at: current.last_verified_at, review_due_at: current.review_due_at,
    freshness: 'current', confidence: current.confidence, citations: [citation(record)], unresolved_conflicts: unresolved
  };
  if (/\b(change|changed|previous|difference|diff)\b/.test(normalized)) {
    const previous = state.authority.find(version => version.id === current.supersedes);
    if (!previous || !accessible(previous)) return abstain();
    const previousSource = source.get(previous.observation_id);
    payload.answer = 'Version ' + previous.version + ': ' + evidenceText(previousSource) + '\nVersion ' + current.version + ': ' + evidenceText(record);
    payload.previous_version = previous.version;
    payload.citations.push(citation(previousSource));
  } else if (/\b(last verified|verification date|last reviewed)\b/.test(normalized)) {
    payload.answer = 'Last verified on ' + current.last_verified_at.slice(0, 10) + ' (UTC).';
  } else if (/\b(who owns|which team owns|who is responsible|owner)\b/.test(normalized)) {
    payload.answer = current.department + ' owns this knowledge. Designated owner: ' + current.owner + '.';
  }
  return reply(200, payload);
}
