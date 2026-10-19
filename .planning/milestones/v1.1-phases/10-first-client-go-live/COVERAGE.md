# API Coverage — ClickSend account / billing surface

> Full coverage by default. Opt-outs are explicit, reasoned decisions.
> Scope: the **account and billing** surface ClickSend exposes, reached for the
> first time in Phase 10 by the pre-arm balance check (D-10). Surface enumerated
> from the ClickSend v3 REST API (OpenAPI mirror of the official spec,
> 10-RESEARCH.md Q8, MEDIUM confidence — the official docs page 404'd on fetch).
>
> **SMS send, inbound, delivery receipts and message history were decided in
> Phase 4** (`.planning/milestones/v1.0-phases/04-messaging-gateway/`) and are
> not re-decided here. This file covers only what Phase 10 newly touches.

| Capability | Endpoint | Decision | Reason |
|---|---|---|---|
| `account.balance` | `GET /v3/account` | INTEGRATE | The pre-arm balance check. `scripts/clicksend-balance.mjs`, a named step in the go-live runbook — the first live SMS failed with INSUFFICIENT_CREDIT, which this read makes knowable before arming |
| `account.update` | `PUT /v3/account` | OPT-OUT | Account details (name, contact, billing address) are managed in the ClickSend dashboard by the operator; nothing in this product has a reason to rewrite them, and a write path to the billing account is a blast radius with no upside |
| `account.verify` — send / verify activation code | `PUT /v3/account-verify/send`, `/v3/account-verify/verify` | OPT-OUT | The account is already verified (Phase 4, 2026-08-29). A one-time human step, done once, in the dashboard |
| `recharge.packages` | `GET /v3/recharge/packages` | OPT-OUT | Top-ups are done in the dashboard. Listing purchasable credit packages is only useful to code that intends to buy one |
| `recharge.purchase` | `POST /v3/recharge/purchase` | OPT-OUT | **Never a code path.** Spending money is an operator decision made deliberately; auto-recharge is the sanctioned automation for it and it is configured in ClickSend, not here. `clicksend-balance.mjs` REPORTS the auto-recharge flag and cannot set it |
| `recharge.transactions` | `GET /v3/recharge/transactions` | OPT-OUT | Our cost record is `send_ledger.message_price` per message — the number that attributes cost to a client. A provider-side top-up ledger answers a different question (what we paid ClickSend), and that one is answered by the invoice |
| `account.transactions` / `statistics` | `GET /v3/account/transactions`, `/v3/statistics/*` | OPT-OUT | `send_ledger` plus delivery receipts are the record of what we sent, to whom and with what outcome, per tenant. A provider-side aggregate cannot be attributed to a client and would be a second, disagreeing source of truth |
| `subaccounts` | `GET/POST/PUT/DELETE /v3/subaccounts` | OPT-OUT | Single operator, single ClickSend account. Per-client numbers (v1.2) are numbers on this account, not subaccounts |
| `contacts` / `contact lists` | `/v3/lists`, `/v3/lists/{id}/contacts` | OPT-OUT | **We never upload customer contact data to a provider.** Recipients are named per send and exist in our Sydney database; a mirrored contact list at ClickSend is an APP-compliance surface we have chosen not to have |
| `account.forgot-username` / `forgot-password` | `PUT /v3/forgot-username`, `/v3/forgot-password` | OPT-OUT | Dashboard-only account recovery, performed by a human with access to the mailbox |

**Note.** SMS send (`POST /v3/sms/send`), inbound rules, delivery-receipt rules,
dedicated numbers (`GET /v3/numbers`) and message history were enumerated and
decided in **Phase 4**, and `scripts/setup-clicksend.mjs` is their only writer.
This matrix does not re-open them.
