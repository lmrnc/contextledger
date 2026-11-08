function contributionTopics(snapshot, canRead) {
  const { actor, data, taxonomy } = snapshot;
  const current = authorities(data);
  const source = byId(data.observations);
  const topics = [];
  for (const [topic, [department, , claimKey]] of Object.entries(taxonomy.topics)) {
    if (taxonomy.departments[department] !== actor.id) continue;
    const versions = current.filter(row => row.topic === topic);
    const base = versions[0];
    if (versions.length > 1 || (base && (base.owner !== actor.id || !canRead(source.get(base.observation_id))))) continue;
    const classifications = Object.entries(taxonomy.classifications)
      .filter(([name]) => hasScope(actor, contributionScope(taxonomy, department, name)))
      .map(([name]) => name);
    if (!classifications.length) continue;
    const evidence = base ? source.get(base.observation_id) : null;
    topics.push({ topic, department, classifications: base ? [base.classification] : classifications, claim_key: claimKey,
      base: base ? { id: base.id, version: base.version, title: evidence.title, content: evidence.content,
        type: evidence.knowledge_type } : null });
  }
  return topics;
}

function contributionScope(taxonomy, department, classification) {
  if (!Object.hasOwn(taxonomy.classifications, classification)) return null;
  const group = classification === 'internal' ? 'employees' : taxonomy.departmentGroups[department];
  if (!taxonomy.classifications[classification].includes(group)) return null;
  return { classification, allowed_groups: [group] };
}

function submitContribution(snapshot, request, topics) {
  const { actor, data } = snapshot;
  const input = request || {};
  const topic = topics.find(row => row.topic === input.topic);
  if (!topic) return identityError(snapshot);
  const base = topic.base;
  if (input.base_version_id !== (base?.id ?? null)) {
    return reply(409, { status: 'stale_base', message: 'The published version changed. Refresh the desk and compare your draft with the latest version.' });
  }
  const title = clean(input.title);
  const content = clean(input.content);
  const reason = clean(input.reason);
  const type = input.knowledge_type;
  const claim = extractClaim(topic.claim_key, content);
  const scope = contributionScope(snapshot.taxonomy, topic.department, input.classification);
  const issues = [];
  if (title.length < 4 || title.length > 150) issues.push('Use a title of 4–150 characters.');
  if (content.length < 20 || content.length > 12000) issues.push('Use 20–12,000 characters of knowledge text.');
  if (reason.length < 10 || reason.length > 1000) issues.push('Explain the change in 10–1,000 characters.');
  if (!snapshot.taxonomy.types.includes(type)) issues.push('Choose a knowledge type from the taxonomy.');
  if (!scope || !topic.classifications.includes(scope.classification)) issues.push('Choose an allowed classification. Existing access scope is fixed.');
  if (topic.claim_key && !claim) issues.push('Use one unambiguous policy value in the format shown for this topic.');
  if (issues.length) return reply(422, { status: 'invalid_contribution', message: issues.join(' '), issues });

  const reference = 'contribution:' + topic.topic;
  const rawHash = sha(JSON.stringify([reference, actor.id, base?.id, scope, type, title, content, reason]));
  const reviewId = 'review-' + rawHash.slice(0, 28);
  const existing = data.reviews.find(row => row.id === reviewId);
  if (existing) return reply(200, { status: existing.status, review_id: existing.id, replay: true });
  const open = data.reviews.find(row => row.kind === 'contribution' && row.topic === topic.topic && isOpen(row));
  if (open?.status === 'pending') {
    return reply(409, { status: 'contribution_pending', message: 'A proposal for this topic is already waiting for review.' });
  }
  const head = authorities(data).find(row => row.id === base?.id);
  const id = 'rev-' + rawHash;
  const candidate = {
    id, knowledge_id: 'k-' + sha(reference), source_system: 'contribution', source_document_id: topic.topic,
    source_url: 'https://northstar.example/contribution/' + id, title, content, department: topic.department,
    topic: topic.topic, knowledge_type: type, owner: actor.id, created_at: now, last_modified_at: now,
    source_verified_at: null, source_review_due_at: null, content_hash: sha(content), raw_hash: rawHash,
    ...scope, approval_status: 'observed', confidence: 'source_observation', claim,
    provenance: { adapter: 'review-desk/v1', locator: reference, submitted_by: actor.id, submitted_at: now, review_id: reviewId }
  };
  const review = {
    id: reviewId, kind: 'contribution', topic: topic.topic, department: topic.department, owner: actor.id, submitted_by: actor.id,
    base_ids: head ? [head.id] : [], candidate_id: id, evidence_ids: head ? [head.observation_id, id] : [id],
    explanation: reason, proposed_action: 'A knowledge steward checks the wording, evidence and audience before publication.',
    priority: issuePriority('contribution', candidate), status: 'pending', created_at: now, history: []
  };
  const writes = [put('observations', candidate), put('reviews', review),
    audit('contribution_submitted', actor.id, { topic: topic.topic, review_id: reviewId, observation_id: id })];
  if (open) {
    writes.push(put('reviews', { ...open, status: 'superseded', closed_at: now }),
      audit('review_superseded', actor.id, { topic: topic.topic, review_id: open.id, replaced_by: reviewId }));
  }
  return { ...reply(201, { status: 'pending', review_id: reviewId, topic: topic.topic }), writes };
}
