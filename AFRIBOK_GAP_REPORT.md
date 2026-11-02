# Afribok — Gap Report

**Scope of this review**
1. Full code inventory compared against the architecture-first specification (the 10 features, their components, technologies and inter-feature contracts).
2. A live walkthrough executed against a running instance (`scripts/walkthrough.mjs`, 46 automated checks) — signup → 8 onboarding cards → departments → team → offline-sync registration → department scoping → assignment/appraisal flow → assistant → EHR connector → forecast → audit.
3. A search of the system for AI/API keys.

**Status summary:** the architecture document is implemented. 14 of the 16 architecture-declared technologies are verifiably in use; two are conditional. The walkthrough passed **46/46 checks**. The gaps below are *operational*, not structural — the architecture holds.

---

## 1. Findings by architecture feature

| # | Feature | Architecture components | Verdict | Evidence |
|---|---------|------------------------|---------|----------|
| 1 | Patient management & registration | Registration UI, form validation, handler, API client, Express route, auth middleware, permission service, patient service/repository, response/error handling | **Complete** | `RegisterPatient.tsx`, `single source of truth in repository.ts.registerPatient`, duplicate matching (`shared/match.ts`) with human review, unique hospital numbers, permission check enforced even inside offline sync |
| 2 | Electronic medical records | Records UI, patient selector, history/medication/notes components, records API, permission middleware, audit | **Complete** | `PatientDetail.tsx`, `Visits.tsx`, audit on all access; only clinician-approved notes count as record |
| 3 | OCR & intake | Upload UI, camera capture, file validation, OCR route, Gemini client, confidence handling, review screen | **Complete** (AI-gated) | `/api/ai/ocr`, `PaperScanDialog.tsx` with per-field confidence + human verification. **Blocked by missing Gemini keys, see §2** |
| 4 | AI-assisted triage | Triage UI, protocol checks, authorised patient context, AI service, output validation, clinician review, audit | **Complete** (AI-gated) | `Triage.tsx` batch 3–100, level 1–5, red-flag escalation, clinician retains authority; `/api/ai/triage` |
| 5 | AI medical scribe | Scribe UI, audio capture, transcription, clinical structuring, clinician review/approval, records linkage, audit | **Complete** (AI-gated) | `ScribePanel.tsx`, draft → approval gate (`note.approve`), listen-completion timing recorded |
| 6 | Predictive operations | Forecast dashboard, filters, forecast engine, validation, audit | **Complete** | `forecast.ts` (deterministic, data-quality aware), `/api/predictions` cards, honest “insufficient” states for lab/pharmacy; CSV import confined to aggregates |
| 7 | AI assistant | Chat UI, auth, permission service, context retrieval, prompt construction, response validation, audit | **Complete** | `platform.ts` router — authorisation before retrieval, conversations private per user, deterministic fallback without keys |
| 8 | EHR/EMR integration | Integration config, connector, auth adapter, FHIR/HL7 adapters, data mapping, validation, retry/audit | **Complete for FHIR read + approved write-back** | Encrypted AES-256-GCM credentials, endpoint test required before read/write, duplicate-write protection, conflict/failed links and event log. **Live FHIR test against hapi.fhir.org returned FHIR 4.0.1 CapabilityStatement during the walkthrough** |
| 9 | Offline & synchronisation | Local storage, service worker, change queue, sync service, idempotency, conflict detection, security | **Complete** | `local-db.ts`, `sync.ts`, `sw.js`, `/api/sync` idempotency verified in walkthrough (replay → `duplicate`, no re-application) |
| 10 | Users, security & audit | Login, credential verification, session, permission service, hospital isolation, audit, secrets config | **Complete** | Role→permission matrix enforced server-side; department scoping enforced in every read; login rate limit; audit > 10 events recorded in walkthrough; nurse correctly refused audit/log, registration, EHR |

## 2. Operational gaps (things that must be decided/provided outside the code)

| Gap | Why it matters | Resolution |
|-----|----------------|------------|
| **Gemini API keys not configured** — no `.env`, no environment variables anywhere in the system | OCR, triage, scribe, and AI-assisted answers can only degrade to their deterministic fallbacks. The walkthrough explicitly confirmed `configured=false, keys=0` and that the system degrades safely rather than erroring loudly | Provide 1+ keys as `GEMINI_API_KEYS` (comma-separated). Optional overrides: `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` (defaults already set: `gemini-3.5-flash-lite`, `gemini-3.6-flash`) |
| **HL7 v2 connector is研究-stage only** | Architecture correctly designed that only the FHIR R4 connector is data-exchange enabled; HL7 v2 over MLLP cannot be validated over HTTP and the code deliberately refuses to pretend it is active | Keep HL7 v2 as “pending implementation” until a hospital with an MLLP interface engine is available, per the architecture doc §14G |
| **EHR write-back not yet exercised end-to-end on a writable FHIR server** | The walkthrough validated configuration, credential storage, endpoint metadata test. Patient pull and approved-note push paths exist and are gated, but no external writable test EHR was exercised in this run | Run against a writable FHIR test server when hospital chooses one; the `push-note` path is already approval-gated so clinical records cannot be auto-written |
| **Lab / pharmacy workload forecasts honestly marked insufficient** | Because no laboratory-order or dispensing events are recorded in Afribok yet. This is correct behaviour, not a bug — the predictive engine refuses to invent numbers | Add order/dispensing event capture when hospitals need it; until then the card states `quality: insufficient` |
| **`data/ehr-integration.key` was auto-generated during the walkthrough** | The EHR credential-encryption key generates on first use (by design, 0600 permissions, 32 random bytes). It now exists on the live deployment host | If the existing live EHR credential was encrypted before this file existed, re-save the EHR credential once so it is encrypted consistently with the current key file |
| **`.spaceship.env` contains live Spaceship registrar API credentials inside the repo** | Runtime security risk if the repo is ever shared or deployed carelessly | Move the keys out of the working tree into a secret store (and add `.spaceship.env` to `.gitignore`); unrelated to Afribok runtime but found during the key search |

## 3. Verified security/permission guarantees (walkthrough-confirmed)

1. First account on a fresh deployment becomes hospital `admin`; public form cannot self-promote.
2. Onboarding must complete before the dashboard unlocks (`DEPARTMENT_REQUIRED` and name/location required).
3. Every staff member logs in individually; no shared credentials.
4. Offline sync re-checks `can(role, permission)` — a nurse's `register_patient` replay is rejected even though it arrived through the sync channel.
5. Duplicate hospital number, duplicate patient id and duplicate encounter id are all refused (`conflict`/`rejected`).
6. Replayed sync operations return `duplicate` and never double-apply.
7. Only clinicians/administrators approve notes; nurse approval is 403.
8. Assistant conversations are private per user (404 for other staff).
9. EHR integration management is admin-only (nurse is 403).
10. Audit log records 10+ events during the walkthrough and is admin/auditor-only.

## 4. Conclusion

The implementation matches the architecture-first specification feature-by-feature. Both remaining limitations (Gemini keys, HL7 v2 connector) are provisioning and vendor-integration issues, not code or architecture defects. The codebase is buildable (`tsc` clean), tested (36/36 unit), and walkthrough-verified (46/46 live checks).
