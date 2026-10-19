# API Coverage — ClickSend (REST v3) + Resend

> Full coverage by default. Opt-outs are explicit, reasoned decisions.
> Phase 4 integrates two external surfaces: ClickSend REST (SMS) and Resend (email).
> Re-decided per surface from the full-coverage baseline, 2026-08-28.

## ClickSend REST v3

| capability | decision | reason |
|---|---|---|
| `POST /v3/sms/send` (outbound SMS, custom_string, from) | INTEGRATE | |
| SMS delivery-receipt webhook ingestion (DLR push) | INTEGRATE | |
| Inbound-SMS webhook ingestion (URL rule push) | INTEGRATE | |
| `POST /v3/automations/sms/inbound` (create/update inbound rule) | INTEGRATE | |
| `GET /v3/automations/sms/inbound` (list rules — idempotent re-run) | INTEGRATE | |
| `POST /v3/automations/sms/receipts` (create/update DLR rule) | INTEGRATE | |
| `GET /v3/automations/sms/receipts` (list DLR rules — idempotent re-run) | INTEGRATE | |
| `GET /v3/sms/history` (sent-message poll — DLR reconciliation guarantee) | INTEGRATE | |
| `GET /v3/sms/inbound` (inbound poll — swallowed-webhook backstop, A3) | INTEGRATE | |
| `POST /v3/sms/inbound` (create test inbound — payload-shape capture pre-number) | INTEGRATE | |
| Numbers API (search/buy dedicated numbers) | OPT-OUT | one-off manual purchase at activation; IPND address verification is a dashboard/support flow no API covers |
| Opt-out lists API (ClickSend account-level opt-out list read/write) | OPT-OUT | not needed yet — `suppressed_contacts` is canonical; drift detected via opt-out send-failure signal + empirical STOP-passthrough test at activation |
| MMS / voice / letters / fax / email (ClickSend channels) | OPT-OUT | explicitly out of scope — SMS is ClickSend's only channel here; email is Resend's |
| Account / balance / statistics endpoints | OPT-OUT | not needed yet — billing is manual at founding-cohort scale |
| Contacts / lists / campaigns endpoints | OPT-OUT | not needed — ServiceM8 is the system of record; cadence engine owns targeting |

## Resend

| capability | decision | reason |
|---|---|---|
| `emails.send` (with headers, replyTo, html) | INTEGRATE | |
| `domains.create` (returns SPF/DKIM DNS records) | INTEGRATE | |
| `domains.list` / `domains.get` (verification status) | INTEGRATE | |
| `domains.verify` (trigger re-check) | INTEGRATE | |
| Event webhooks (`email.delivered` / `bounced` / `complained`, svix-signed) | OPT-OUT | not needed yet — MSG-01 scopes delivery receipts to SMS; email delivery evidence recorded as v2 trigger alongside Resend Inbound (D-01); avoids the svix dependency entirely |
| Resend Inbound (`email.received` capture) | OPT-OUT | explicitly deferred per D-01 — v1 email replies go Reply-To the tradie; v2 trigger recorded in CONTEXT Deferred Ideas |
| `emails.get` (retrieve send status by id) | OPT-OUT | not needed yet — email delivery evidence is v2; outcome at hand-off is recorded in the ledger |
| Batch send (`emails.batch`) | OPT-OUT | not needed — dispatch sends per-touch inside per-tenant claim transactions; batching would bypass claim semantics |
| Broadcasts / Audiences / Contacts APIs | OPT-OUT | not needed — suppression is ours (`suppressed_contacts`), never provider-side audiences |
