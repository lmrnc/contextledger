const { createHash, randomUUID } = require('crypto');
const sha = value => createHash('sha256').update(value).digest('hex');
const now = new Date().toISOString();
const daysAfter = (date, days) => new Date(Date.parse(date) + days * 86400000).toISOString();
const reply = (httpCode, payload) => ({ httpCode, payload, writes: [] });
const identityError = snapshot => snapshot.actor
  ? reply(403, { status: 'denied' })
  : reply(401, { status: 'authentication_required' });
const put = (collection, row) => ({ collection, row });
const audit = (event, actor, fields) => put('audit', { id: randomUUID(), event, actor, at: now, ...fields });
const clean = value => typeof value === 'string' ? value.trim() : '';
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const hasScope = (actor, item) => Array.isArray(actor.groups) && Array.isArray(item?.allowed_groups) &&
  item.allowed_groups.length > 0 && item.allowed_groups.every(group => actor.groups.includes(group));
const sameScope = (a, b) => a && b && a.classification === b.classification &&
  JSON.stringify(a.allowed_groups) === JSON.stringify(b.allowed_groups);
const byId = rows => new Map(rows.map(row => [row.id, row]));
const isOpen = review => ['pending', 'clarification_requested'].includes(review.status);

function latestBy(rows, key, order) {
  const latest = new Map();
  for (const row of rows) {
    const previous = latest.get(row[key]);
    if (!previous || previous[order] < row[order]) latest.set(row[key], row);
  }
  return [...latest.values()];
}
const observations = state => latestBy(state.observations, 'knowledge_id', 'last_modified_at');
const authorities = state => latestBy(state.authority, 'stream', 'version');
function evidenceVersion(version, versions) {
  let basis = version;
  let prior = versions.get(basis.supersedes);
  // Renewing verification keeps the decision attached to the same evidence.
  while (prior && prior.observation_id === basis.observation_id) {
    basis = prior;
    prior = versions.get(basis.supersedes);
  }
  return basis.id;
}
const knownClaims = {
  window_hours: /\bwithin (\d{1,4}) hours?\b/gi,
  limit_usd: /\bup to USD (\d{1,6})\b/gi,
  interval_days: /\bevery (\d{1,4}) days?\b/gi
};
function extractClaim(key, content) {
  if (!key) return null;
  const matches = [...content.matchAll(knownClaims[key])];
  const values = [...new Set(matches.map(match => Number(match[1])))];
  if (values.length !== 1 || values[0] <= 0) return null;
  return { key, value: values[0], quote: matches[0][0], offset: matches[0].index };
}
function citation(item) {
  return {
    source_system: item.source_system, source_document_id: item.source_document_id,
    source_url: item.source_url, title: item.title, revision_id: item.id,
    content_hash: item.content_hash, last_modified_at: item.last_modified_at,
    claim: item.claim, provenance: item.provenance
  };
}
function evidenceText(item) {
  if (!item.claim) return item.content;
  const end = item.content.indexOf('.', item.claim.offset + item.claim.quote.length);
  const start = item.content.lastIndexOf('.', item.claim.offset);
  return item.content.slice(start + 1, end < 0 ? undefined : end + 1).trim();
}
function issuePriority(type, record) {
  if (record?.classification === 'restricted' || (type === 'conflict' && record?.topic === 'customer-escalation')) return 'high';
  return 'normal';
}
function verifiedVersion(item, stream, prior, reviewer, verification, approvedAt) {
  const version = (prior?.version ?? 0) + 1;
  return {
    id: stream + ':v' + version, stream, topic: item.topic, department: item.department,
    owner: prior?.owner ?? item.owner, version, supersedes: prior?.id ?? null,
    observation_id: item.id, knowledge_id: item.knowledge_id, title: item.title,
    classification: item.classification, allowed_groups: item.allowed_groups, approval_status: 'approved',
    last_verified_at: verification, review_due_at: approvedAt === 'bootstrap' ? item.source_review_due_at : daysAfter(verification, 90),
    approved_by: reviewer, approved_at: approvedAt === 'bootstrap' ? null : approvedAt,
    confidence: 'owner_verified', claim: item.claim
  };
}
