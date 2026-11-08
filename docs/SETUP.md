# Setup and operations

**Make enterprise knowledge trustworthy before AI agents consume it.**

At Northstar Labs, Support's approved escalation policy says 24 hours, a newer Slack decision says 48, and the dispatch checklist still says 24. An agent that picks the newest search hit could apply a policy that the owner has never approved. ContextLedger treats each source as evidence, records an explicit owner decision, and serves the resulting verified version with provenance and access controls.

Five n8n workflows handle ingestion, contradiction detection, owner review, retrieval and quality monitoring. A local sidecar supplies three synthetic feed formats, transaction-backed SQLite storage, a browser Review Desk and an MCP transport. The workflows contain the policy and orchestration. The demonstration uses 37 fictional records across five departments and requires no corporate account or model API key.

## Run locally

Use Node.js 24.x and npm. The pinned n8n release is 2.46.6. Install dependencies from the project directory.

The [clean Windows x64 run](../evidence/README.md) used the SQLite fallback below, a new dependency directory, and an empty npm cache. The general npm path and POSIX setup are provided for other environments.

```sh
npm install --prefix .runtime --no-save --no-audit --no-fund n8n@2.46.6 @modelcontextprotocol/sdk@1.29.0 zod@3.25.76
npm start
```

On Windows x64, if npm's SQLite lifecycle hook cannot download its prebuilt binary, use this fallback with Python 3 and PowerShell. It downloads the original sqlite3 5.1.7 release asset and checks the archive digest.

```powershell
npm.cmd install --prefix .runtime --no-save --ignore-scripts --no-audit --no-fund n8n@2.46.6 @modelcontextprotocol/sdk@1.29.0 zod@3.25.76
.\scripts\install-windows-sqlite.ps1
npm.cmd start
```

Startup imports and publishes five workflows automatically. Wait for **ContextLedger ready**. Open the Review Desk at [127.0.0.1:5680](http://127.0.0.1:5680). The [n8n editor](http://127.0.0.1:5678) prompts for a local owner account on first use. That account is optional for the demo and separate from the test identities.

In another terminal, run the complete demonstration on a fresh ledger.

```sh
npm run demo
npm test
```

For a manual walkthrough, start with `npm run seed` and `npm run tokens`, then follow the [recording guide](../DEMO.md). Tokens are generated per runtime and live in `.runtime/demo/keys.json`. Paste the appropriate token in the Review Desk. To restore the unreviewed dataset, stop the processes, reset the knowledge ledger and start them again. Workflows and identity tokens are retained.

```sh
npm run stop
npm run reset
npm start
```

`npm test` starts isolated n8n instances and ledgers on ports 5688/5690 and 5700/5702. The second instance runs an accelerated copy of the scheduled workflow. Logs are kept in the ignored `.runtime/e2e-*` and `.runtime/schedule-*` directories. For edits, change `workflow-src/` or the canvas generator, run `npm run build` and restart. The local import script refreshes the published definitions when the export changes.

## Docker Compose

Use Docker with Linux containers and the Compose plugin. Node 24 on the host generates the local configuration and runs the CLI demo. Execute these commands from the project directory. `docker compose config --quiet` passed. Docker Desktop timed out on engine queries, so the container run could not be verified.

```powershell
$env:CONTEXTLEDGER_RUN_DIR = '.runtime/compose'
node scripts/run.mjs configure --compose
docker compose --env-file .runtime/compose/compose.env --profile setup run --rm import
docker compose --env-file .runtime/compose/compose.env up --build -d
npm.cmd run demo
```

On a POSIX shell, use `export CONTEXTLEDGER_RUN_DIR=.runtime/compose` and `npm run demo`. Use the same run directory for `npm run tokens`. Use `docker compose --env-file .runtime/compose/compose.env down` to stop the containers. Run `node scripts/run.mjs reset` after stopping them, then bring them back up.

## Workflows

| Importable file | Purpose |
| --- | --- |
| [A-ingest.json](../workflows/A-ingest.json) | Fetch three independent feeds, validate and store observations, then invoke B |
| [B-detect.json](../workflows/B-detect.json) | Compare claims and open evidence-bound cases |
| [C-review.json](../workflows/C-review.json) | Accept scoped owner proposals and commit review decisions |
| [D-context.json](../workflows/D-context.json) | Authorize, retrieve, cite or abstain |
| [E-monitor.json](../workflows/E-monitor.json) | Scan daily and write a report and mock owner notifications |

Use the provided importer to preserve workflow IDs referenced by A and E. Manual imports into an existing instance require connecting both Execute Sub-workflow nodes to B, provisioning the sidecar URL and key, enabling the Code node crypto module, and publishing the workflows. [n8n CLI reference](https://docs.n8n.io/hosting/cli-commands/)

## HTTP and MCP

The gateway exposes `POST /api/context` with a JSON `question` and `Authorization: Bearer <token>`. The same bearer works at the Streamable HTTP MCP endpoint `http://127.0.0.1:5680/mcp`. Configure the client's request headers, list tools, and call `get_authoritative_context` with a question.

```powershell
$employee = (Get-Content .runtime/demo/keys.json -Raw | ConvertFrom-Json).tokens.employee
Invoke-RestMethod http://127.0.0.1:5680/api/context -Method Post -Headers @{ Authorization = "Bearer $employee" } -ContentType 'application/json' -Body '{"question":"What is the current escalation policy?"}'
```

## Boundaries and trade-offs

- The loopback-only demo uses generated bearer tokens and trusts the local host and n8n editor operator. The private storage key is injected at startup. Stored execution payloads are disabled. Production would need an identity provider, scoped service credentials, TLS, source ACL revocation and audited operator access.
- Retrieval uses curated topic aliases and exact evidence. Unknown or ambiguous questions abstain. A claim can stay approved while a proposed replacement is under review, with a scoped conflict indicator. Overdue context withholds content.
- Source URLs use the reserved synthetic domain `northstar.example`. They identify fixture records or immutable Review Desk submissions. The original evidence is in the Review Desk and [source dataset](../data/northstar.json). The system retains observations if a feed disappears. Production source deletions need explicit tombstone and revocation policies.
- SQLite is appropriate for this single-host ledger. At higher scale, use a scoped read model, indexed claims, paginated connectors and a durable notification queue. The current outbox is a mock Slack adapter.
- The optional local model helper is advisory and separate from the workflow. Set `CONTEXTLEDGER_MODEL` to an installed model and run `node scripts/compare-with-model.mjs` after seeding. The loopback endpoint defaults to Ollama's chat-completions route. The helper sends only a selected internal Support case, checks quoted spans and makes no ledger writes. Live inference requires a configured local server. [Ollama compatibility documentation](https://docs.ollama.com/api/openai-compatibility)

See [architecture](../ARCHITECTURE.md), the [contributor guide](../CONTRIBUTOR_GUIDE.md), the [portfolio brief](../PORTFOLIO.md) and the [evidence index](../evidence/README.md).
