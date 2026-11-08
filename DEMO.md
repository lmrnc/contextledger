# 90-second walkthrough

## Before recording

1. Follow the [setup guide](README.md). If you rehearsed on this ledger, run `npm.cmd run stop` and `npm.cmd run reset`, then run `npm.cmd start` again. Wait for **ContextLedger ready**.
2. In a second terminal, run `npm.cmd run seed` and `npm.cmd run tokens`. Seed creates the escalation conflict and leaves it pending. Keep the token terminal outside the recording.
3. Open the [n8n governance canvas](http://127.0.0.1:5678/workflow/CLReview00000001). Complete local editor setup if prompted. Close the Production Checklist if open, then click **Zoom to Fit**.
4. Open three separate [Review Desk](http://127.0.0.1:5680) tabs. Connect them as **Support**, **Employee**, and **Admin** respectively. Leave Support on the escalation case, Employee on **Trusted context**, and Admin on **Review queue**.
5. Record one browser window at 1440 × 1080 or higher. Use 100% browser zoom. Keep notifications off and switch tabs instead of opening the token terminal.

## Record

| Time | Click and show | Say |
| --- | --- | --- |
| 0–10 s | Start on workflow C in n8n. Point to the contribution, validation, and ledger commit nodes. | “ContextLedger is a local n8n prototype using synthetic data. It keeps source evidence separate from approved knowledge.” |
| 10–26 s | Switch to Support. Show **Customer escalation**, its 24-hour approved policy and newer 48-hour Slack decision. Paste the escalation note below and click **Approve**. | “A newer Slack message opens a review. The Support owner decides which policy applies.” |
| 26–44 s | In Support, open **Contribute**. Select **Weekend coverage**, **Procedure**, and **All employees**. Paste the title, knowledge, and reason below. Click **Submit for review** and show the pending receipt. | “An owner can propose a procedure using the shared taxonomy. A separate steward reviews it.” |
| 44–53 s | Switch to Employee. Ask the question below and click **Retrieve**. | “Before approval, an employee gets no verified answer.” |
| 53–68 s | Switch to Admin. Click **Refresh queue**, select **Weekend coverage**, paste the steward note, and click **Approve**. | “The steward approves the exact submission. The ledger publishes version one.” |
| 68–81 s | Return to Employee. Click **Retrieve** again. Point to the answer, authoritative version, and submission citation. | “The same question now returns the approved text with its version and provenance. MCP uses this same retrieval workflow.” |
| 81–90 s | In Admin, open **Quality report** and click **Generate report**. Point to Support’s source alignment tasks and the resolved cases. | “The report assigns the old copies to Support so the team can fix the original sources.” |

## Text to paste

| Field | Text |
| --- | --- |
| Escalation note | Support confirmed 48 hours from P2 confirmation. Update the policy and dispatch checklist. |
| Title | Weekend coverage procedure |
| Knowledge text | The Support duty lead checks urgent cases at 09:00 and 16:00 UTC on weekends. |
| Reason | Give weekend responders a predictable queue handoff. |
| Employee question | What is the weekend coverage procedure? |
| Steward note | Support confirmed the schedule and employee audience. Publish this procedure. |

For an engineering follow-up, ask “What changed in the escalation policy?” to show the prior citation, then ask for the internal Security runbook as Employee to show abstention. Run `npm.cmd test` to verify the contribution policy, scoped retrieval, MCP, scheduler, and ingestion failure handling. The [evidence index](evidence/README.md) contains the recorded outputs and all five canvases.
