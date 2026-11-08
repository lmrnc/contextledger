function viewReview(snapshot, request, route) {
  if (!snapshot.actor || snapshot.denied) return identityError(snapshot);
  const state = snapshot.data;
  const actor = snapshot.actor;
  const source = byId(state.observations);
  const versions = byId(state.authority);
  const latest = new Map(observations(state).map(item => [item.knowledge_id, item]));
  const quarantined = new Set(state.quarantine.filter(row => row.status === 'open').map(row => row.id));
  const canRead = item => {
      const head = latest.get(item?.knowledge_id);
      return hasScope(actor, item) && hasScope(actor, head) && !quarantined.has(item.provenance.locator);
  };
  const visible = review => (actor.admin || actor.id === review.owner) &&
    review.evidence_ids.length > 0 && review.evidence_ids.every(id => canRead(source.get(id)));
  const canDecide = review => visible(review) && (review.kind !== 'contribution' ||
    (actor.admin === true && actor.id !== review.submitted_by));
  if (route === 'contribute') return submitContribution(snapshot, request, contributionTopics(snapshot, canRead));
  if (route === 'reviews') {
    const queues = state.reviews.filter(visible).map(review => ({
      ...review,
      can_decide: canDecide(review),
      current: review.base_ids.map(id => versions.get(id)).filter(Boolean).map(version => ({
        version: version.version, verification: version.last_verified_at, claim: version.claim,
        content: source.get(version.observation_id).content
      })),
      proposed: review.candidate_id ? source.get(review.candidate_id).content : null,
      evidence: review.evidence_ids.map(id => {
        const item = source.get(id);
        return { ...citation(item), classification: item.classification,
          authority_rank: snapshot.taxonomy.sourceAuthority[item.source_system],
          approval_status: review.base_ids.some(baseId => versions.get(baseId)?.observation_id === id)
            ? 'approved baseline' : 'source observation',
          excerpt: item.content };
      })
    }));
    const topics = contributionTopics(snapshot, canRead);
    return reply(200, { status: 'ok', reviewer: actor.id, admin: !!actor.admin, reviews: queues,
      contribution: { topics, types: topics.length ? snapshot.taxonomy.types : [] } });
  }
  const { review_id, decision, note } = request || {};
  if (typeof review_id !== 'string' || !/^review-[a-f0-9]{28}$/.test(review_id) ||
      !['approve', 'reject', 'clarify'].includes(decision) || typeof note !== 'string' ||
      clean(note).length < 5 || note.length > 1000) {
    return reply(400, { status: 'invalid_decision', message: 'Choose an action and enter a note of 5–1000 characters.' });
  }
  const review = state.reviews.find(row => row.id === review_id);
  if (!review || !canDecide(review)) {
    return { ...identityError(snapshot), writes: [audit('decision_denied', actor.id, {})] };
  }
  if (!isOpen(review)) return reply(409, { status: 'already_decided' });
  const event = { decision, reviewer: actor.id, at: now, note: clean(note) };
  const updated = { ...review, history: [...review.history, event] };
  const writes = [];
  if (decision === 'approve') {
    const current = authorities(state).filter(row => row.topic === review.topic);
    const base = current[0];
    const candidate = source.get(review.candidate_id);
    const candidateHead = observations(state).find(item => item.knowledge_id === candidate?.knowledge_id);
    const firstPublication = review.kind === 'contribution' && !current.length && !review.base_ids.length;
    const matchingBase = current.length === 1 && review.base_ids.length === 1 && review.base_ids[0] === base.id &&
      candidate?.owner === base.owner && sameScope(candidate, base);
    if ((!firstPublication && !matchingBase) || !candidate || candidateHead?.id !== candidate.id ||
        !candidate.owner || candidate.owner !== snapshot.taxonomy.departments[candidate.department] ||
        (snapshot.taxonomy.topics[review.topic][2] && !candidate.claim)) {
      return reply(409, { status: 'requires_reconciliation', message: 'This evidence, scope or base version changed. Refresh the source and ask the platform steward to reconcile.' });
    }
    const entry = verifiedVersion(candidate, base?.stream || candidate.topic + ':' + candidate.knowledge_id, base, actor.id, now, now);
    updated.status = 'approved';
    updated.resulting_version = entry.id;
    updated.version = entry.version;
    writes.push(put('authority', entry));
    for (const stale of state.reviews.filter(row => row.id !== review.id && row.topic === review.topic &&
        isOpen(row) && (base ? row.base_ids.includes(base.id) : !row.base_ids.length && row.kind === 'contribution'))) {
      writes.push(put('reviews', { ...stale, status: 'superseded', closed_at: now, resulting_version: entry.id }));
      writes.push(audit('review_superseded', actor.id, { review_id: stale.id, topic: stale.topic, version_id: entry.id }));
    }
  } else {
    updated.status = decision === 'reject' ? 'rejected' : 'clarification_requested';
  }
  if (!isOpen(updated)) updated.closed_at = now;
  writes.push(put('reviews', updated), audit('decision_' + decision, actor.id, {
    review_id, topic: review.topic, note: event.note, resulting_version: updated.resulting_version || null
  }));
  return { ...reply(200, { status: updated.status, review_id, reviewer: actor.id, decided_at: now,
    authoritative_version: updated.version ?? null, resulting_version: updated.resulting_version ?? null }), writes };
}
