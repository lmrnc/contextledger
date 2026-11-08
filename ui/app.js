const element = id => document.getElementById(id);
const notice = text => { element('notice').textContent = text; };
let token = '';
let cases = [];
let selected = null;
let busy = false;
let contributionTopics = [];

function make(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
const label = value => value?.replaceAll('_', ' ').replaceAll('-', ' ') || '';
const date = value => value ? new Date(value).toISOString().slice(0, 10) + ' UTC' : '—';
const display = value => label(value).replace(/^./, char => char.toUpperCase());
function badge(text, attention) {
  return make('span', text, attention ? 'tag attention' : 'tag');
}
function link(title, url) {
  if (!url?.startsWith('https://northstar.example/')) return make('span', title);
  const node = make('a', title);
  node.href = url;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}
async function api(path, data) {
  if (!token) throw new Error('Connect with a demo identity token.');
  const result = await fetch('/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const payload = await result.json();
  if (!result.ok) throw new Error(payload.message || label(payload.status));
  return payload;
}
function compare(title, content) {
  const block = make('div', '', 'compare-item');
  block.append(make('h3', title), make('p', content || '—'));
  return block;
}
function renderCase() {
  const list = element('cases');
  const detail = element('case-detail');
  list.replaceChildren();
  detail.replaceChildren();
  for (const item of cases) {
    const button = make('button', label(item.topic), 'case-link');
    button.setAttribute('aria-pressed', String(selected === item.id));
    button.append(make('small', label(item.kind) + ' · ' + label(item.status)));
    button.addEventListener('click', () => { selected = item.id; renderCase(); });
    list.append(button);
  }
  const item = cases.find(row => row.id === selected);
  if (!item) {
    detail.append(make('h2', 'No review selected'), make('p', 'Cases appear here when an authorized owner has evidence to review.'));
    return;
  }
  const tags = make('div', '', 'tags');
  tags.append(badge(label(item.status), item.status === 'pending'), badge(label(item.kind)), badge(item.priority + ' priority'));
  detail.append(tags, make('h2', display(item.topic)));
  detail.append(make('p', item.department + ' / ' + item.owner, 'meta'), make('p', item.explanation));
  const open = ['pending', 'clarification_requested'].includes(item.status);
  const baseline = item.current[0]
    ? (open ? 'Current approved · v' : 'Approved at opening · v') + item.current[0].version
    : 'No approved baseline';
  const candidate = item.status === 'approved' ? 'Published evidence · v' + item.version : 'Proposed source';
  const grid = make('div', '', 'comparison');
  grid.append(compare(baseline, item.current.map(row => row.content).join(' / ')), compare(candidate, item.proposed));
  detail.append(grid);
  const evidence = make('ul', '', 'evidence');
  for (const source of item.evidence) {
    const row = make('li');
    const origin = source.source_system === 'contribution' ? 'Review Desk · ' + source.provenance.submitted_by :
      source.source_system + ' · authority ' + source.authority_rank + '/3';
    row.append(link(source.title, source.source_url), make('div', origin +
      ' · ' + source.approval_status + ' · edited ' + date(source.last_modified_at) +
      (source.claim ? ' · “' + source.claim.quote + '”' : ''), 'meta'));
    evidence.append(row);
  }
  detail.append(evidence);
  if (open) {
    detail.append(make('p', item.proposed_action, 'fine'));
  }
  if (open && item.can_decide) {
    const form = make('form');
    const noteLabel = make('label', 'Decision note');
    noteLabel.htmlFor = 'decision-note';
    const note = make('textarea');
    Object.assign(note, { id: 'decision-note', required: true, minLength: 5, maxLength: 1000 });
    const buttons = make('div', '', 'actions');
    for (const [action, title] of [['approve', 'Approve'], ['reject', 'Reject'], ['clarify', 'Request clarification']]) {
      if (action === 'approve' && ['metadata_repair', 'approved_conflict', 'uncertain_claim'].includes(item.kind)) continue;
      const button = make('button', title, action === 'approve' ? '' : 'subtle');
      button.value = action;
      buttons.append(button);
    }
    form.append(noteLabel, note, buttons);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!event.submitter) return;
      task(async () => {
        const result = await api('decision', { review_id: item.id, decision: event.submitter.value, note: note.value });
        await loadQueue();
        notice(label(result.status) + ' by ' + result.reviewer +
          (result.authoritative_version ? ' · published v' + result.authoritative_version : ''));
      });
    });
    detail.append(form);
  }
  if (item.history.length) {
    detail.append(make('h3', 'Decision history'));
    for (const event of item.history) {
      detail.append(make('p', label(event.decision) + ' · ' + event.reviewer + ' · ' + date(event.at) + ' / ' + event.note));
    }
  }
}
function setOptions(select, entries) {
  select.replaceChildren(...entries.map(([value, name]) => {
    const option = make('option', name);
    option.value = value;
    return option;
  }));
}
const activeTopic = () => contributionTopics.find(item => item.topic === element('topic').value);
function renderTopic() {
  const topic = activeTopic();
  element('contribution-baseline').replaceChildren();
  element('contribution-receipt').replaceChildren();
  if (!topic) return;
  const audiences = { internal: 'All employees', restricted: 'Department only' };
  setOptions(element('classification'), topic.classifications.map(value => [value, audiences[value]]));
  element('classification').disabled = topic.classifications.length === 1;
  element('knowledge-type').value = topic.base?.type || 'procedure';
  element('contribution-title').value = topic.base?.title || '';
  element('knowledge-text').value = topic.base?.content || '';
  element('change-reason').value = '';
  const formats = { window_hours: 'within 48 hours', limit_usd: 'up to USD 500', interval_days: 'every 30 days' };
  element('claim-hint').textContent = topic.claim_key
    ? 'Use one policy value, in the format “' + formats[topic.claim_key] + '”.'
    : 'Include when it applies and who should act.';
  element('contribution-baseline').append(compare(topic.department + ' · ' +
    (topic.base ? 'Updates v' + topic.base.version : 'First publication'),
    topic.base ? 'This draft starts from the published wording and keeps its audience.' :
      'Employees will have no approved answer until a steward approves this proposal.'));
}
function setContribution(response) {
  const previous = element('topic').value;
  contributionTopics = response.topics;
  element('contribution-form').hidden = !contributionTopics.length;
  element('contribution-help').textContent = contributionTopics.length
    ? 'A knowledge steward reviews every proposal before it reaches Trusted Context.'
    : 'Connect as a department knowledge owner to see your topics.';
  setOptions(element('topic'), contributionTopics.map(item => [item.topic, display(item.topic)]));
  setOptions(element('knowledge-type'), response.types.map(type => [type, display(type)]));
  if (contributionTopics.some(item => item.topic === previous)) element('topic').value = previous;
  renderTopic();
}
async function loadQueue() {
  const response = await api('reviews');
  element('identity').textContent = response.reviewer;
  cases = response.reviews;
  setContribution(response.contribution);
  if (!cases.some(row => row.id === selected)) selected = cases.find(row => row.topic === 'customer-escalation')?.id || cases[0]?.id;
  renderCase();
  notice(cases.filter(item => ['pending', 'clarification_requested'].includes(item.status)).length + ' open cases for ' + response.reviewer);
}
async function task(callback) {
  if (busy) return;
  busy = true;
  try { await callback(); } catch (error) { notice(error.message); }
  finally { busy = false; }
}

element('login').addEventListener('submit', event => {
  event.preventDefault();
  task(async () => {
    token = element('token').value.trim();
    element('token').value = '';
    cases = [];
    selected = null;
    element('identity').textContent = 'Connecting…';
    element('answer').replaceChildren();
    element('report').replaceChildren();
    setContribution({ topics: [], types: [] });
    renderCase();
    try { await loadQueue(); }
    catch (error) { token = ''; element('identity').textContent = 'Disconnected'; throw error; }
  });
});
function selectPanel(panel) {
  for (const tab of document.querySelectorAll('[data-panel]')) {
    const current = tab.dataset.panel === panel;
    tab.setAttribute('aria-pressed', String(current));
    element(tab.dataset.panel).hidden = !current;
  }
}
for (const button of document.querySelectorAll('[data-panel]')) {
  button.addEventListener('click', () => selectPanel(button.dataset.panel));
}
element('refresh-queue').addEventListener('click', () => task(loadQueue));
element('topic').addEventListener('change', renderTopic);
element('contribution-form').addEventListener('submit', event => {
  event.preventDefault();
  task(async () => {
    const topic = activeTopic();
    if (!topic) return;
    const result = await api('contribute', {
      topic: topic.topic, base_version_id: topic.base?.id ?? null, classification: element('classification').value,
      knowledge_type: element('knowledge-type').value, title: element('contribution-title').value,
      content: element('knowledge-text').value, reason: element('change-reason').value
    });
    const queue = await api('reviews');
    cases = queue.reviews;
    selected = result.review_id;
    renderCase();
    const receipt = element('contribution-receipt');
    const openCase = make('button', 'Open review case', 'subtle');
    openCase.addEventListener('click', () => selectPanel('review'));
    receipt.replaceChildren(badge(display(result.status), result.status === 'pending'),
      make('p', result.status === 'pending' ? 'Submitted for steward review. Published knowledge is unchanged.' :
        'This submission already has a review case.'), openCase);
    notice(display(topic.topic) + ' · ' + label(result.status));
  });
});
element('ask').addEventListener('submit', event => {
  event.preventDefault();
  task(async () => {
    const target = element('answer');
    target.replaceChildren();
    const response = await api('context', { question: element('question').value });
    target.append(badge(response.status, response.status !== 'verified'), make('p', response.answer, 'result-text'));
    if (response.authoritative_version) target.append(make('p', 'Authoritative v' + response.authoritative_version +
      ' · verified ' + date(response.last_verified_at) + ' · ' + response.freshness, 'meta'));
    if (response.unresolved_conflicts?.length) target.append(make('p', 'Open reviews: ' + response.unresolved_conflicts.map(row => label(row.kind)).join(', ')));
    for (const source of response.citations) {
      const line = make('p');
      line.append(link(source.title, source.source_url), make('span', ' · ' + source.source_system +
        (source.provenance.submitted_by ? ' · submitted by ' + source.provenance.submitted_by : '') +
        ' · SHA-256 ' + source.content_hash.slice(0, 12), 'meta'));
      target.append(line);
    }
    notice('Retrieved through the published n8n context workflow.');
  });
});
element('run-monitor').addEventListener('click', () => task(async () => {
  const target = element('report');
  target.replaceChildren();
  const response = await api('monitor', {});
  target.append(make('p', response.counts.latest_records + ' records · ' + response.counts.open_reviews +
    ' open reviews · ' + response.counts.duplicate_groups + ' duplicate groups', 'meta'));
  for (const { owner, issues } of response.grouped) {
    const section = make('div', '', 'owner-section');
    section.append(make('h3', owner));
    const list = make('ul');
    for (const issue of issues) list.append(make('li', label(issue.kind) + ' · ' + issue.subject + '. ' + issue.action));
    section.append(list);
    target.append(section);
  }
  target.append(make('h3', 'Resolved cases'));
  for (const review of response.resolved_reviews) {
    target.append(make('p', label(review.topic) + ' · ' + review.status + (review.resulting_version ? ' · v' + review.resulting_version : '')));
  }
  notice('Quality report generated · ' + response.new_mock_notifications + ' new mock Slack notices.');
}));
renderCase();
