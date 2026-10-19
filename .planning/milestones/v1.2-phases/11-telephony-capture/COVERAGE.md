# API Coverage — Twilio Programmable Voice (Phase 11)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.
> Scope: the Twilio surface Phase 11 touches — inbound voice on per-client AU
> divert numbers, captured without recording (D-01, D-04). Surface enumerated
> from the Twilio docs and the `twilio@6.1.1` tarball (11-RESEARCH.md §1a–§1e).
> Region: US1, reached through the Sydney edge (D-10).
>
> **SMS stays on ClickSend (Phase 4).** SMS send, inbound and delivery receipts
> were decided in Phase 4 on ClickSend and are not re-opened here; this matrix
> covers only the Twilio surface Phase 11 touches.

| Capability | Endpoint / verb | Decision | Reason / consuming file |
|---|---|---|---|
| Voice webhook — incoming call | `POST` to the number's Voice URL | INTEGRATE | `src/app/api/webhooks/twilio/voice/route.ts` — token gate, signature, row, greeting |
| Voice status callback — completed | `POST` to the number's Status Callback | INTEGRATE | `src/app/api/webhooks/twilio/voice-status/route.ts` — the hint half: exact-CallSid UPDATE, never an INSERT |
| TwiML `<Say>` | TwiML verb | INTEGRATE | `src/core/telephony/greeting.ts` — `Polly.Olivia-Neural`, `en-AU`, the fixed template |
| TwiML `<Hangup>` | TwiML verb | INTEGRATE | `src/core/telephony/greeting.ts` — the call ends; nothing is captured |
| TwiML `<Pause>` | TwiML verb | INTEGRATE | `src/core/telephony/greeting.ts` — one second before the greeting |
| Request signature validation | `X-Twilio-Signature` (HMAC-SHA1 over URL + params) | INTEGRATE | `src/core/telephony/verify-signature.ts` — over the canonical URL rebuilt from `APP_BASE_URL` |
| AU local number search | `GET /AvailablePhoneNumbers/AU/Local` (`InLocality`, `VoiceEnabled`) | INTEGRATE | `src/core/telephony/twilio-client.ts` (`searchAuLocalNumbers`); `scripts/twilio-numbers-search.mjs` (read-only A5 check) |
| Number purchase, fully configured in one call | `POST /IncomingPhoneNumbers` (`VoiceUrl`, `StatusCallback`, `BundleSid`, `AddressSid`, `FriendlyName`, `VoiceCallerIdLookup=false`) | INTEGRATE | `src/core/telephony/twilio-client.ts` (`purchaseNumber`), called only by `src/core/telephony/provision.ts` claim-then-buy |
| Calls list (reconcile) | `GET /Calls` (`StartTime>`) | INTEGRATE | `src/core/telephony/twilio-client.ts` (`listInboundCalls`) — the guarantee half; `scripts/verify-missed-call-reconcile.mjs` prints its count only (S7) |
| Recordings list — COUNT ONLY | `GET /Recordings` (`DateCreated>`) | INTEGRATE | `src/core/telephony/twilio-client.ts` (`countRecordingsSince`) — the D-04 assertion; items discarded unread, any count above 0 alarms |
| Edge / region selection | SDK `edge: 'sydney'`, host `api.sydney.us1.twilio.com` | INTEGRATE | `src/core/telephony/twilio-client.ts` (`TWILIO_EDGE`); `scripts/twilio-numbers-search.mjs` — API traffic enters in Sydney (D-10) |
| Bundle / Address attachment via env | `TWILIO_AU_BUNDLE_SID`, `TWILIO_AU_ADDRESS_SID` passed at purchase | INTEGRATE | `src/core/telephony/provision.ts` guards refuse by name when either is missing |
| Fallback URL at purchase | `VoiceFallbackUrl` from optional `TWILIO_VOICE_FALLBACK_URL` | INTEGRATE | `src/core/telephony/provision.ts` — only when the founder has created the generic bin (runbook §6) |
| Call recording | `<Record>`, `record=true`, Recording Configurations | OPT-OUT | D-04 — nothing is recorded, ever; the reconcile alarms if a recording appears |
| Transcription | `transcribe`, Real-Time Transcription | OPT-OUT | No audio is captured, so there is nothing to transcribe (D-04) |
| Voice Intelligence | Intelligence Services / Transcripts API | OPT-OUT | No audio is retained; an analytics service over calls is a privacy surface we do not want |
| Conversation Relay / Media Streams | `<Connect><ConversationRelay>`, `<Stream>` | OPT-OUT | No live audio leaves Twilio for us; an AI voice agent is out of scope for v1.2 |
| TwiML `<Dial>` / `<Gather>` / `<Record>` / `<Play>` / `<Redirect>` / `<Stream>` / `<Connect>` | TwiML verbs | OPT-OUT | A structural test forbids them in the greeting; `<Play>` (per-client recorded audio) is deferred |
| SMS / Messaging via Twilio | `POST /Messages`, the number's Messaging URL | OPT-OUT | SMS stays on ClickSend (Phase 4 decisions, S4); the number's Messaging configuration is left empty |
| Studio / Functions | Studio Flows, Serverless Functions | OPT-OUT | Call logic lives in our code and tests; a second, untested place for it is how drift starts |
| TwiML Bins as a code path | TwiML Bins | OPT-OUT | Only the optional founder-configured generic fallback bin (runbook §6); no API use, no per-client bins |
| Lookup / CNAM | Lookup v2, `VoiceCallerIdLookup=true` | OPT-OUT | Set to false at purchase — every extra caller field is one more to keep out of logs, and `caller_kind` comes from the prefix |
| Number update / release | `POST` / `DELETE /IncomingPhoneNumbers/{sid}` | OPT-OUT | D-08 — no release path exists; URL rotation is a Console action in the runbook's fixed order |
| Address / Bundle creation via API | `POST /Addresses`, Regulatory Compliance Bundles API | OPT-OUT | KYC is a one-time founder Console action with identity documents; no code should hold them |
| Porting | Port In / Port Out | OPT-OUT | Numbers are bought for diverting only; nobody dials them back, so porting has no use |
| AU1 region | `region: 'au1'`, per-number Region routing | OPT-OUT | Deferred (D-10); S7's one-call check decides whether it is ever needed |
| Webhook connection overrides | URL fragment `#ct=…&rc=…&e=sydney` | OPT-OUT | Not adopted until a live call settles whether the fragment is part of the signed URL (A4); the reconcile is the guarantee |
| Outbound calls | `POST /Calls` | OPT-OUT | Nothing in this product places a call; capture is inbound only |

**Note.** SMS send, inbound and delivery receipts were decided in Phase 4 on
ClickSend and are not re-opened here; this matrix covers only the Twilio surface
Phase 11 touches.
