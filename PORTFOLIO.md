# ContextLedger design brief

A portfolio prototype for the Internal Context Engineer role at n8n.

At Northstar Labs, a 48-hour Slack decision conflicts with the approved 24-hour escalation policy in Notion. The dispatch checklist also says 24 hours. The Support owner compares the three sources and approves 48 hours. Employees and MCP clients receive the new version with a citation. The quality report assigns the two stale copies to Support.

## Design decisions

- **Separate evidence from publication.** Re-ingestion records source changes while the approved version remains in force. The owner decides against the specific revisions in the review case. The ledger retains the previous version.
- **Apply caller permissions before matching.** MCP carries the caller's identity to the same retrieval workflow as HTTP. Permission checks cover both answers and citations.
- **Give owners a place to work.** Department owners submit procedures and revisions through the Review Desk. A steward reviews their proposals, and the monitor assigns overdue reviews and stale source copies.
- **Keep the demo reproducible.** Structured claim checks and curated topic aliases keep the governance path independent of paid inference. The evaluation measures behaviour on the synthetic fixture.

[Technical architecture](ARCHITECTURE.md) · [Executed tests and capture evidence](evidence/README.md)
