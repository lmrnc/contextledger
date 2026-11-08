function detect(snapshot) {
  const state = snapshot.data;
  const latest = observations(state);
  const current = authorities(state);
  const versions = byId(state.authority);
  const source = byId(state.observations);
  const prior = byId(state.reviews);
  const heads = new Map(latest.map(item => [item.knowledge_id, item]));
  const writes = [];
  const findings = [];

  for (const review of state.reviews.filter(isOpen)) {
    const candidate = source.get(review.candidate_id);
    const head = heads.get(candidate?.knowledge_id);
    if (!head || head.id === candidate.id || review.kind === 'revalidation') continue;
    const status = review.kind === 'metadata_repair' && head.owner ? 'metadata_repaired' : 'superseded';
    writes.push(put('reviews', { ...review, status, closed_at: now }),
      audit('review_' + status, snapshot.actor.id, { topic: review.topic, review_id: review.id }));
  }

  function record(kind, topic, bases, candidate, evidence, explanation, action, owner) {
    const id = 'review-' + sha(JSON.stringify([kind, topic, bases.map(row => row.id).sort(), candidate?.id, evidence.map(row => row.id).sort()])).slice(0, 28);
    findings.push({ topic, kind, review_id: id, status: prior.get(id)?.status || 'pending' });
    if (prior.has(id)) return;
    const row = {
      id, kind, topic, base_ids: bases.map(row => row.id), candidate_id: candidate?.id || null,
      evidence_ids: evidence.map(row => row.id), owner, department: snapshot.taxonomy.topics[topic][0],
      explanation, proposed_action: action, priority: issuePriority(kind, candidate || evidence[0]),
      status: 'pending', created_at: now, history: []
    };
    writes.push(put('reviews', row), audit('review_opened', snapshot.actor.id, { topic, review_id: id, kind }));
  }

  for (const [topic, config] of Object.entries(snapshot.taxonomy.topics)) {
    const bases = current.filter(row => row.topic === topic);
    const candidates = latest.filter(row => row.topic === topic && row.source_system !== 'contribution');
    for (const item of candidates.filter(row => !row.owner)) {
      record('metadata_repair', topic, [], item, [item],
        'This source revision has no valid designated owner.',
        'Ask the department champion to set an owner in the source. Publish only after the source is repaired.',
        snapshot.taxonomy.departments[config[0]]);
    }
    const evidence = bases.map(base => source.get(base.observation_id));
    const distinct = new Set(bases.map(base => base.claim?.value).filter(value => value !== undefined));
    if (distinct.size > 1) {
      record('approved_conflict', topic, bases, null, evidence,
        'Published authority streams disagree. Retrieval must abstain pending a source-policy reconciliation.',
        'Ask the platform steward to reconcile approved streams.', snapshot.taxonomy.departments[config[0]]);
      continue;
    }
    if (bases.length !== 1) continue;
    const [base] = bases;
    const [baseSource] = evidence;
    const basis = evidenceVersion(base, versions);
    if (base.review_due_at < now) {
      record('revalidation', topic, bases, baseSource, evidence,
        'The latest approved version has passed its review due date.',
        'Verify the original source and renew its verification date.', base.owner);
    }
    for (const candidate of candidates) {
      if (candidate.id === baseSource.id) continue;
      const sameSource = candidate.knowledge_id === base.knowledge_id;
      const sameClaim = candidate.claim?.value === base.claim?.value;
      const disposed = state.reviews.some(review => review.topic === topic &&
        review.status === 'approved' && review.resulting_version === basis &&
        review.evidence_ids.includes(candidate.id));
      if (disposed) continue;
      const peers = candidates.filter(row => row.id !== candidate.id && row.id !== baseSource.id &&
        sameScope(row, base) && row.claim && row.claim.value === base.claim?.value);
      if (candidate.claim && base.claim && !sameClaim) {
        const ranks = snapshot.taxonomy.sourceAuthority;
        const dateOrder = candidate.last_modified_at === baseSource.last_modified_at ? 'the same edit time as'
          : candidate.last_modified_at > baseSource.last_modified_at ? 'a later edit time than' : 'an earlier edit time than';
        const context = 'The unapproved source has ' + dateOrder + ' the approved source (authority rank ' +
          ranks[candidate.source_system] + ' vs. ' + ranks[baseSource.source_system] + ').';
        const scope = sameScope(base, candidate) ? '' : ' The access scopes differ. Route any scope change through Security.';
        record('conflict', topic, bases, candidate, [...evidence, candidate, ...peers],
          'The extracted values disagree. ' + context + scope,
          'Approve the replacement, reject it, or request clarification. No automatic publication is permitted.', base.owner);
      } else if (sameSource) {
        record('source_changed', topic, bases, candidate, [...evidence, candidate],
          'The source changed after its last approval. Changes may affect the claim, text, metadata or access.',
          'Review the new revision and confirm it is safe to publish.', base.owner);
      } else if (config[2] && !candidate.claim) {
        record('uncertain_claim', topic, bases, candidate, [...evidence, candidate],
          'The topic expects a single supported claim, but the source yielded no unambiguous value.',
          'Request clearer source text or reject this candidate.', base.owner);
      }
    }
  }
  return { ...reply(200, { status: 'scanned', findings,
    opened: writes.filter(write => write.collection === 'reviews' && write.row.status === 'pending').length }), writes };
}
