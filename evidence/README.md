# Execution evidence

The Windows x64 run installed the pinned npm packages into an empty dependency directory with a fresh npm cache under Node.js 24.14.0 and npm 11.9.0. The Windows fallback downloaded the checksum-verified SQLite binary and loaded it successfully. The live browser demo and automated suite used that runtime, and n8n 2.46.6 imported and published all five exports. [Runtime versions](clean-runtime.txt)

| Evidence | What it shows |
| --- | --- |
| [Ingestion](n8n-ingestion-canvas.png), [detection](n8n-detection-canvas.png), [governance](n8n-governance-canvas.png), [retrieval](n8n-retrieval-canvas.png), [monitoring](n8n-monitoring-canvas.png) | The five published n8n canvases, captured in the editor with the Production Checklist closed and Zoom to Fit applied |
| [First ingestion response](initial-ingestion.json) | Eight Slack messages, 17 Notion pages and 12 Operations records accepted |
| [Pending conflict](pending-conflict.png) | The owner compares 24, 48 and 24 hours against the approved baseline |
| [Browser approval response](browser-approval.json) and [decision history](approved-decision.png) | An earlier browser approval as the Support owner and the decision history from the current CLI replay |
| [Owner submission](contributor-submission.png), [pending retrieval](contributor-pending-retrieval.png), [steward review](contributor-steward-review.png), [approved retrieval](contributor-retrieval.png), [API responses](contributor-journey.json) | Support submits weekend coverage through the browser. An employee gets no answer while it is pending. A different steward approves it, then the same employee query returns v1 with the submission's provenance |
| [Trusted retrieval](trusted-retrieval.png) and [restricted request](restricted-retrieval.png) | Cited 48-hour guidance for an authorized request, generic abstention for the employee's restricted query |
| [Quality report](quality-report.png) | Owner assignments, overdue review, duplicate and resolved escalation with two downstream source fixes |
| [CLI replay](demo-execution.json) | Separate live replay with an idempotent ingestion, denied forged decision, accepted owner decision, cited retrieval, restricted abstention and report |
| [Test TAP](test-results.tap), [policy TAP](policy-tests.tap), [evaluation JSON](evaluation.json) | Executed results and labelled examples |
| [Scheduled report and reminder](scheduled-report.json) | The published Schedule Trigger wrote a report for all 37 records and a mock Slack reminder with zero monitoring webhook calls |

## Measured on the synthetic dataset

| Metric | Result | Definition |
| --- | ---: | --- |
| Knowledge completeness | 36/37 (97.3%) | Accepted latest records with required fields, including a valid owner and a parsed claim where the taxonomy requires one |
| Ownership | 36/37 (97.3%) | Latest records assigned to a valid department owner |
| Freshness compliance | 24/25 (96.0%) | Current authority streams within the review date before the revalidation test |
| Duplicate group detection | 1/1 (100%) | Labelled cross-source duplicate group found, with one redundant record among the 37 source records |
| Conflict precision and recall | 3/3 and 3/3 | Three conflicting candidates found across four labelled claim comparisons |
| Retrieval accuracy | 12/12 | Expected status, first citation and answer text when applicable |
| Citation correctness | 8/8 | Source locator, URL, recomputed source content hash and exact quote offset when applicable |
| Unauthorized disclosures | 0/3 | Two HTTP restricted retrieval probes and one MCP restricted retrieval probe |
| Decision turnaround | 1,753 ms and 2,416 ms | Elapsed time from creation to scripted escalation approval and refund rejection respectively. These are fixture timings |

All 19 end-to-end scenarios, four focused policy tests and one scheduled integration test passed. TAP counts the end-to-end parent suite as an additional entry, for 25 passes and zero failures. The added scenarios cover forged ownership, invalid metadata, blocked self-approval, first publication, clarification, rejection, stale updates, and restricted scope. The MCP SDK client initialized a Streamable HTTP connection, listed the tool and called D with two identities. The Review Desk was also checked at desktop and narrow viewport widths.

The scheduler test published an isolated copy of E with a ten-second cadence. It independently read the persisted report and reminder from SQLite. The exported workflow retains its daily 09:00 UTC schedule. The daily time was checked in the workflow configuration.

The labels and questions are small, authored against this fixture, and include curated aliases. They do not estimate semantic retrieval quality on enterprise data, broader access-control coverage or operator turnaround. The reported figures exclude startup overhead and are not throughput measurements.

## Verification boundaries

| Status | Scope |
| --- | --- |
| Implemented and tested | Clean Windows x64 setup, workflow import and publication, owner submission and update, independent approval, ingestion and drift checks, revalidation, cited retrieval, MCP client calls, review and audit durability, on-demand monitoring, scheduled monitoring at an accelerated cadence and mock reminder deduplication |
| Implemented, runtime verification pending | Compose deployment and optional local model inference. Compose configuration validation passed, but Docker Desktop timed out on engine queries. No inference runtime was configured |
| Partial | Real SaaS lifecycle handling, production authentication, durable external notification delivery, broader semantic comparisons and stewardship for reconciling parallel approved streams |
| Planned | Real connectors, SSO, revocation/tombstones, delegated ownership and production-scale storage |
