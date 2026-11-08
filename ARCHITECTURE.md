# Architecture

## Data flow

Mock SaaS feeds → A ingest → B compare → C review and publish → D trusted context

Department owner → C validate and queue contribution → steward decision → D trusted context

E runs B at 09:00 UTC and compiles owner worklists, outstanding source alignment and mock Slack notifications. A invokes B after committing observations. C serves authenticated webhooks for the Review Desk. D serves the same retrieval contract to HTTP callers and the MCP gateway.

| Workflow | Decisions owned in n8n | Entry point |
| --- | --- | --- |
| A · Ingest | Source isolation, adapter mapping, validation, exact revision identity, pinned baseline import | Admin POST |
| B · Detect | Claim comparison, evidence ranking, idempotent review creation | Execute Sub-workflow Trigger |
| C · Review | Contribution metadata, owner and evidence authorization, review state machine, version promotion and audit writes | Authenticated GET and POST |
| D · Retrieve | Access filtering, topic and intent matching, freshness, abstention and citations | Authenticated POST |
| E · Monitor | Revalidation scan, owner grouping and reminder fingerprints | Schedule Trigger or admin POST |

The Node service adapts three synthetic feed formats, verifies local bearer tokens, serves the Review Desk and persists row batches. All normalization, conflict, publication and retrieval policy runs in n8n. The MCP gateway translates tool calls into the same D webhook requests used by the Review Desk. [n8n core nodes](https://docs.n8n.io/integrations/builtin/core-nodes/)

## Schema and taxonomy

| Collection | Fields and responsibility |
| --- | --- |
| `observations` | Immutable source revision, stable `knowledge_id`, source system, document ID and URL, title, content, department, topic, type, owner, source timestamps, content hash, scope, claim and provenance |
| `authority` | Immutable published snapshot with stream ID, version, predecessor, observation pointer, owner, scope, approval status, verification date, review due date, approver and confidence |
| `reviews` | Topic, department, base version IDs, candidate and evidence revision IDs, owner, priority, suggested action, status and timestamped decision history |
| `audit` | Append-only baseline imports, feed state changes, review creation, denied actions by a known actor, review decisions and supersession |
| `feeds` and `quarantine` | Latest source health and metadata failures. Quarantine records field names and a source locator, withholds the source body and blocks retrieval of affected observations |
| `reports` and `notifications` | Latest report per UTC date and append-only, deduplicated mock Slack outbox |

[The taxonomy file](data/taxonomy.json) lists Support, Product, Engineering, Security and People Operations, their owners, and 28 controlled topics with search aliases. A record has one type from policy, procedure, decision, runbook or reference. Internal records require the employees group. Restricted records require the designated department group. The taxonomy validates each topic and department pairing. Feed ownership comes from the source, validated against the designated owner. Missing or unrecognized owners stay visibly incomplete.

A locator such as `slack:support-decision` yields a stable SHA-256 knowledge ID. A separate raw payload hash identifies each immutable revision. A hash of normalized text powers exact duplicate detection across platforms within the same topic and scope. Distinct source locators are retained for provenance. Source timestamps control progression. An older replay or equal-timestamp collision cannot move the source head forward. Sources provide small full snapshots, with incremental writes.

Citations include the source, immutable observation ID, content hash, locator, adapter version, fetch time and exact claim quote with its character offset. Verification belongs to the approved version and survives new source edits. The baseline manifest attests exact synthetic payloads to model an authorized migration. Feed payloads cannot approve themselves.

## Comparing and resolving evidence

- Deterministic extractors recognize escalation hours, refund limits and key rotation days. A unique supported value produces an exact source quote. Ambiguous values open a review when compared against an established topic.
- Each discrepancy is tied to the base version, candidate revision and corroborating evidence. The queue states how the source edit times and authority ranks compare and which source is approved. Same-value observations corroborate the approved claim without publishing anything.
- Changed claims require a human decision. Source rank and recency help the owner triage the case. Approval appends the next version if the current base, current source revision, ownership and scope still match. Rejection leaves the base in place. Clarification remains open.
- The resolved 24-hour/48-hour case stays closed while the evidence is unchanged, including after an owner renews its verification date. E still asks Support to retire or update the old Notion and Operations copies. A new evidence revision can create a new case.
- If multiple visible published streams disagree, D returns a conflict state and the permitted citations. Standard replacement approval requires a single base. Reconciling parallel published streams requires separate stewardship.

## Contributions

C exposes the authorized owner's topics through its review queue endpoint. The Review Desk prefills published wording on updates. C resolves the owner from the caller identity and taxonomy, validates the type and any required claim, derives permission groups, and binds the proposed revision to the exact base version. Existing audience scope is fixed. A first publication uses a registered topic and an explicit audience.

C commits the immutable submission, a pending case, and an audit event together. An exact pending retry returns the original case. A request for clarification allows the owner to submit a revised proposal while retaining the earlier case and notes. The submitting owner can track the case, and only a different knowledge steward can decide it. Approval creates an authoritative version and records when it was verified. Retrieval returns the contribution's content hash, submission identity, timestamp, and review ID. The reserved synthetic URL identifies the submitted revision. Review Desk users with case access can inspect its source text.

## Permissions and concurrency

| Demo identity | Context scope | Governance |
| --- | --- | --- |
| General employee | Internal | No review actions |
| Support owner | Internal and Support | Submit Support proposals and act on scoped feed cases |
| Security owner | Internal and Security | Submit Security proposals and act on scoped feed cases |
| Knowledge admin | Internal and all five demo groups | Ingest, monitor, and decide scoped owner submissions |

Locally generated bearer tokens resolve against a server-side directory. Claimed reviewer and role fields carry no permissions. D filters source and approved-version scope before topic matching. It also checks the latest known source scope and quarantine status. Historical evidence and conflict summaries are scoped separately. A restricted query by an employee returns the same payload as an unknown topic. The n8n editor is a trusted operator boundary. The demo disables stored success, error and manual execution data because webhook inputs and node data can contain secrets and restricted documents.

The internal store authenticates n8n with a private key. SQLite transactions bind every batch to an expected ledger revision. A concurrent write invalidates a stale plan and returns a refresh or retry response. Review decisions, version appends and audit events commit together. A scan interrupted by a write conflict can be retried via A or E. The store accepts row batches, uses parameterized SQL and enforces immutable collection updates. Whole-state snapshots are suitable for the small dataset inside this trust boundary.

## Operational choices

- Use extractive answers so the offline demo can verify scope and provenance directly. Alias matching is intentionally limited. The optional local model command only suggests a comparison and validates quoted spans.
- Use the official MCP SDK's Streamable HTTP transport with the caller's bearer forwarded to D. This gives web and MCP consumers the same policy. Native n8n MCP is an alternative to evaluate once end-user identity propagation can be verified. [n8n MCP Server Trigger documentation](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger/)
- For production, add SSO/OIDC, connector-specific ACL mapping and revocation, delegated owners, least-privilege reads, authenticated TLS ingress, durable notifications and independent audit retention. Large sources need cursor-based pagination, change tracking and scoped database reads.
