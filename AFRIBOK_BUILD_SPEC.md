# Afribok — Complete Build Specification

**Goal:** Build Afribok exactly as described in the master prompt — every page, every workflow, every prompt/instruction given to the AI, every technology choice, every small piece.

**How to read this document:** It is written part-by-part, smallest piece to largest. Each part says:
- What the part does
- Which programming language / framework / tool builds it
- Which file(s) implement it
- What instructions/prompts/behavior govern it
- What data it touches

The spec assumes the current codebase in `afribok/` is the starting point and the source of truth for the real files already written.

---

## 1. Tech stack (language and tooling for the whole platform)

### 1.1 Frontend application
- **Language:** TypeScript
- **Framework:** React 18 with function components and hooks
- **Build tool:** Vite
- **Routing:** React Router DOM (`react-router-dom`)
- **State owned by the app:**
  - React context for auth/workspace (files: `src/auth/AuthProvider.tsx`, `src/workspace/WorkspaceProvider.tsx`)
  - Local component state for forms, scans, scribe, triage panel
- **Styling:** Plain CSS modules/CSS files — no component framework required. Real CSS files in the project:
  - `src/styles/global.css`
  - `src/styles/app.css`
  - `src/styles/auth.css`
  - `src/styles/landing.css`
- **Offline support:** Service worker (`public/sw.js`) plus IndexedDB-backed local data layer (`src/lib/local-db.ts`, `src/lib/local-types.ts`, `src/lib/sync.ts`)
- **AI client (frontend side):** `src/lib/ai-client.ts` — talks to the server AI routes; never calls Gemini directly from the browser

### 1.2 Backend server
- **Language:** TypeScript
- **Runtime:** Node.js
- **Web framework:** Express
- **Project layout:**
  - `server/index.ts` — entry point
  - `server/app.ts` — Express app setup, middleware, routes
  - `server/config.ts` — env-driven configuration
  - `server/db.ts` — database / data access initialization
  - `server/repository.ts` — data access functions
  - `server/auth.ts` — authentication and session handling
  - `server/validation.ts` — request validation helpers
  - `server/setup.ts` — workspace/hospital onboarding setup flows
  - `server/forecast.ts` — predictive engine backend
  - `server/platform.ts` — platform-level utilities
  - `server/seed.ts` — demo/seed data
  - `server/gemini.ts` — Gemini AI client
  - `server/ai.ts` — AI routes and prompting (OCR, triage, scribe, assistant background)
- **Shared types:** `shared/types.ts`, `shared/clinical.ts`, `shared/match.ts`

### 1.3 AI layer
- **Model provider:** Google Gemini
- **Client implementation:** `server/gemini.ts` — `GeminiClient` class
- **Key handling:** Round-robin key pool from env `GEMINI_API_KEYS` (or `GEMINI_API_KEY`); cooldown on 429/403/5xx; timeout 75 seconds
- **Default models:**
  - Primary: `gemini-3.5-flash-lite`
  - Fallback: `gemini-3.6-flash`
- **Prompt style:** System instruction + user parts; JSON mode requested for structured extraction tasks

### 1.4 Data storage
- **Primary store:** The project uses a server-side data layer (`server/db.ts`, `server/repository.ts`). Treat it as the system of record for hospitals, users, departments, patients, encounters, triage results, scribe notes, audit events, predictions, EHR integration state.
- **Local offline store:** IndexedDB via `src/lib/local-db.ts` and local types in `src/lib/local-types.ts`
- **Sync model:** `src/lib/sync.ts` — durable local change queue, idempotent sync, conflict detection, retry, audit trail

### 1.5 Environments
- **Real live site path observed in the project:** `/register`, plus an authenticated app shell after login
- **Demo/test accounts and all patient data:** should be deletable on demand per the user’s request; do not keep stale demo patient data lying around

---

## 2. Global rules that apply to every part

1. **Hospital isolation:** Data belongs to one hospital. Queries and UI must always be scoped by hospital/workspace.
2. **Department association:** Patients, staff, encounters, triage results, notes, and predictions must be associated with departments correctly.
3. **Permissions are real:** Do not rely on hiding buttons. Enforce access at the server and data-access layer. Use role-based access and attribute-based access where appropriate.
4. **Auditability:** Sensitive access and administrative actions must be auditable.
5. **Offline-first for essential workflows:** Registration, local patient records, queue management, offline triage where local model exists, offline note drafting where supported, local dashboard data, local event capture, then sync when connectivity returns.
6. **Human review for clinical content:** OCR output is not verified clinical data. Scribe notes are drafts until a clinician approves them. AI does not independently diagnose or write unreviewed conclusions into the EHR.
7. **Privacy:** Do not send identifiable patient information to public AI services without the safeguards the hospital has configured. Keep private assistant conversations separated from administrative reporting.
8. **Unique identifiers:** Patients get unique identifiers. Encounters, triage results, notes, and EHR mappings must stay linked.

---

## 3. Entry points and top-level navigation

### 3.1 Landing / marketing facing page
- **Files:** `src/pages/Landing.tsx`, `src/styles/landing.css`
- **Purpose:** Public-facing introduction to Afribok; route people toward account creation and login.
- **Implementation language:** TypeScript + React + CSS

### 3.2 Account creation
- **Files:** `src/pages/CreateAccount.tsx`
- **Implementation language:** TypeScript + React
- **Behavior:** Collect the initial administrator account and start the hospital onboarding flow. Do not drop the admin straight into the dashboard.

### 3.3 Login
- **Files:** `src/pages/Login.tsx`, `src/auth/AuthProvider.tsx`, `src/styles/auth.css`
- **Implementation language:** TypeScript + React
- **Behavior:** Individual staff login with username/password. Session-based access. Protected admin authentication can be layered on top for privileged actions.

### 3.4 App shell
- **Files:** `src/App.tsx`, `src/workspace/WorkspaceLayout.tsx`, `src/workspace/WorkspaceProvider.tsx`
- **Implementation language:** TypeScript + React
- **Purpose:** After onboarding, show only the features the user is allowed to see. Keep the four main workflows prominent:
  1. OCR & Patient Intake / Registration
  2. AI Triage
  3. AI Medical Scribe
  4. Predictive Engine
- Also expose:
  - Dashboard
  - EHR / EHR Integration
  - AI Assistant
  - Department/staff management for authorized users
  - Audits and admin functions for authorized users

---

## 4. Hospital onboarding — mandatory before dashboard

### 4.1 What it is
A sequence of setup cards that must be completed before the administrator enters the main dashboard.

### 4.2 Implementation
- **Files:** `server/setup.ts` plus the frontend onboarding UI that calls it
- **Implementation language:** TypeScript on both server and client
- **Behavior:** Store answers; use them to configure workspace, departments, integrations, access permissions, and predictive-engine setup; allow authorized admins to update later.

### 4.3 Card-by-card content and behavior

#### Card 1 — Hospital information
- **Fields collected:**
  - Hospital/clinic name
  - Facility type
  - Location
  - Address
  - Approximate size
  - Approximate daily patient volume if known
  - Operating days and hours
- **Rules:** Genuinely optional questions can be skipped.

#### Card 2 — Department configuration
- **Prompt to user:** “Which departments are available in your hospital?”
- **Allowed actions:** Add as many departments as needed; each department gets:
  - Name
  - Description if applicable
  - Department head
  - Assigned staff
  - Access permissions
  - Operational configuration
- **Example departments (not mandatory):**
  - Emergency
  - General Outpatient
  - Paediatrics
  - Obstetrics and Gynaecology
  - Surgery
  - Internal Medicine
  - Laboratory
  - Pharmacy
- **Effect:** These departments become the department options used throughout Afribok. Admin must be able to edit later.

#### Card 3 — Existing EHR/EMR status
- **Prompt to user:** “Does your hospital currently use an Electronic Health Record (EHR) or Electronic Medical Record (EMR) system?”
- **Options:**
  1. Yes, we currently use an EHR.
  2. Yes, we currently use an EMR.
  3. We use another digital hospital record system.
  4. No, our records are primarily paper-based.
  5. We do not currently have a digital patient-record system.
- **If an existing system is selected, also collect:**
  - EHR/EMR name
  - Vendor or provider
  - Whether the hospital has API access
  - Whether it supports reading patient records
  - Whether it supports writing/updating patient records
  - Whether it supports FHIR, HL7, or another integration standard if known
  - Whether the hospital has technical documentation
  - Whether the hospital has an authorized technical contact
- **Behavioral rules:**
  - Do not assume every EHR provides API access.
  - Explain that integration depends on the capabilities and permissions of the existing system.
  - If the hospital has no EHR/EMR, explain that Afribok can provide its own digital patient-record functionality.

#### Card 4 — Historical hospital data
- **Prompt to user:** “Does your hospital have historical clinical or operational data covering at least three months?”
- **Options:**
  - Yes
  - No
  - We have some historical information, but it is incomplete
- **If yes, ask:**
  - “What format is the historical information stored in?”
    - Paper records
    - Existing EHR/EMR
    - Excel
    - CSV
    - Word documents
    - Other digital records
    - Multiple formats
  - Approximate period available:
    - Three to six months
    - Six to twelve months
    - One to two years
    - Two to three years
    - More than three years
- **Rule:** Do not assume the data is complete or reliable just because it exists.

#### Card 5 — Patient volume and operations
- **Fields collected:**
  - Approximate daily arrivals
  - Whether most patients are walk-ins
  - Whether the hospital operates an appointment system
  - Number of doctors available
  - Number of nurses available
  - Number of active departments
  - Whether there is an emergency department
  - Whether there is a laboratory
  - Whether there is a pharmacy
  - Whether there are inpatient beds
- **Rules:** Approximate answers are allowed where exact numbers are unavailable.

#### Card 6 — Staff and user setup
- **Prompt to user:** “How many staff members will use Afribok?”
- **Collect per staff member:**
  - Staff name
  - Staff identification number
  - Professional role
  - Department
  - Access level
  - Contact information where required
- **Rule:** Each staff member must have an individual login account.

#### Card 7 — Offline and technical environment
- **Fields collected:**
  - Whether the hospital has reliable internet access
  - Whether it experiences frequent internet outages
  - Whether it has an internal local network
  - Whether it has a local server
  - What devices staff will use
  - Whether the hospital has desktop computers, tablets, or smartphones
- **Effect:** Use the answers to configure the appropriate offline deployment approach.

#### Card 8 — Review and confirmation
- **Behavior:**
  - Show a summary of everything entered.
  - Allow review and editing.
  - After confirmation:
    - Create the hospital workspace
    - Create the configured departments
    - Create the hospital administrator account
    - Apply initial access permissions
    - Configure available modules
    - Begin the appropriate EHR/EMR setup process
    - Take the administrator to the main dashboard

---

## 5. User accounts and hospital hierarchy

### 5.1 Account model
- **Files:** `server/auth.ts`, `server/repository.ts`, `shared/types.ts`
- **Implementation language:** TypeScript
- **Requirement:** Individual accounts for every authorized staff member. No shared general hospital login.
- **Per-account attributes:**
  - Unique staff account
  - Unique username or staff number
  - Password
  - Assigned department
  - Assigned role
  - Defined access permissions

### 5.2 Roles and intended permissions

#### Medical Director / Hospital Administrator
- Highest operational access.
- Authorized to:
  - View overall hospital dashboard
  - View all configured departments
  - View authorized patient records across departments
  - View hospital-wide operational statistics
  - View AI triage activity
  - View AI scribe activity
  - View predictive-engine outputs
  - Manage hospital users
  - Assign department heads
  - Manage department permissions
  - Review authorized hospital-wide AI Assistant activity where legally and operationally authorized
  - Review audit logs
  - Manage EHR integrations
  - Configure hospital-wide settings
- **Protected admin access:** Support additional authentication for privileged access, session controls, and audit logging. Do not rely on a shared or easily guessed PIN as the only protection.

#### Department Head
- Access to the relevant department.
- Authorized to:
  - View department dashboard
  - View patients assigned to the department
  - View department triage activity
  - View department operational statistics
  - View authorized clinical records
  - Manage department staff permissions within authorized limits
  - Review department-level AI Assistant information
  - View department workload and predictive information
- Department heads should not automatically get confidential information from unrelated departments.

#### Doctors
- Authorized to:
  - Their authorized department
  - Patients assigned to them or their clinical team
  - Relevant patient records
  - AI Medical Scribe
  - Relevant AI triage results
  - Their own consultation records
  - Their department’s operational information where authorized
  - Their department-specific AI Assistant
- Doctors must be able to review and approve their own clinical documentation.

#### Nurses
- Authorized to:
  - Their assigned department
  - Relevant patient registration information
  - Relevant triage information
  - Patient queue information
  - Approved nursing documentation workflows
  - Their department-specific AI Assistant

#### Other hospital personnel
- Configurable roles for:
  - Receptionists
  - Records officers
  - Laboratory staff
  - Pharmacy staff
  - Hospital administrators
  - Other authorized personnel
- Each role gets only the permissions necessary for its responsibilities.

### 5.3 Access control requirements
- Enforce at backend and data-access level.
- Consider:
  - Hospital
  - Department
  - User
  - Role
  - Patient assignment
  - Record sensitivity
  - Specific permissions
- Every sensitive access and administrative action should be auditable.

---

## 6. OCR and Patient Intake / Registration

### 6.1 What it is
The first main operational section. Two entry points:
1. Existing Patient — OCR / Record Digitisation
2. New Patient — New Registration

### 6.2 Files and tech
- **Frontend:** `src/pages/app/RegisterPatient.tsx`, `src/components/PaperScanDialog.tsx`
- **AI client:** `src/lib/ai-client.ts`
- **Server AI route + prompting:** `server/ai.ts`, `server/gemini.ts`
- **Shared clinical types:** `shared/clinical.ts`, `shared/types.ts`
- **Implementation language:** TypeScript + React + Express + Gemini

### 6.3 Existing patient — OCR / record digitisation

#### 6.3.1 Capture
- Accept a photo or upload of a paper record.
- Supported image formats observed in the Gemini client: `jpeg`, `png`, `webp`, `heic`, `heif`.

#### 6.3.2 What OCR must extract
From the paper record, extract and organize into structured fields:
- Patient information
- Previous diagnoses
- Medical history
- Medications
- Relevant clinical notes

#### 6.3.3 Review rule
- Show extracted information for staff review.
- Allow correction before saving.
- Do not treat uncertain handwritten OCR output as verified clinical information.

#### 6.3.4 OCR prompt instructions given to the AI
The OCR prompt in `server/ai.ts` must tell the model:
- Copy what is written, including local spellings.
- Never guess a letter you cannot read.
- If the photo is blurry, cropped, skewed, or partly unreadable, set `legible=false` and explain in warnings.
- Use only field names from the accepted field set.
- Return null for fields not present in the document.
- Give per-field confidence:
  - 0.9 or higher when the value is clearly printed and certain
  - Around 0.4 or lower when the model is guessing
- Use ISO date format where a date is requested, for example `YYYY-MM-DD`.
- For sex, accept `female`, `male`, or null if not stated.
- Keep `chiefComplaint` in the patient’s own words when possible.
- Return the raw text seen on the record in `rawText`.

#### 6.3.5 Output shape
The OCR response must include:
- `legible`
- `documentType`
- `confidence`
- `fields`
- `warnings`
- `rawText`
- `model`
- `processedAt`

The field set used by the scan dialog is:
- `firstName`
- `lastName`
- `otherNames`
- `sex`
- `dateOfBirth`
- `phone`
- `address`
- `hospitalNumber`
- `identifierType`
- `identifierValue`
- `chiefComplaint`

The scan dialog maps the AI response into those fields and normalizes `sex` to `female`, `male`, or `unknown`.

#### 6.3.6 Confidence display
The frontend shows:
- High confidence: 75% or above
- Medium confidence: 45% to 74%
- Low confidence: below 45%
And shows warnings and the raw text seen on the record.

### 6.4 New patient — new registration

#### 6.4.1 Digital registration
- Staff enter patient details using structured forms.
- File: `src/pages/app/RegisterPatient.tsx`

#### 6.4.2 Voice-assisted registration
- Staff speak naturally while collecting patient information.
- The system must:
  1. Capture speech with appropriate consent
  2. Transcribe it
  3. Use an LLM to structure the information
  4. Populate the registration fields
  5. Allow staff to review and correct
  6. Save the confirmed record
- Files: `src/lib/audio.ts` for capture/transcription support; the AI structuring comes through the same AI layer used elsewhere.

#### 6.4.3 Configurable intake questions
Include questions about the patient’s current condition, for example:
- What is the main problem bringing you to the hospital?
- When did it start, and has it changed?
- Are there other symptoms or relevant medical concerns?

#### 6.4.4 Patient matching
- Use existing patient history to avoid unnecessarily repeating questions for returning patients.
- Generate or retrieve a unique patient identifier.
- Prevent duplicate records through appropriate matching and human review.

---

## 7. AI Triage

### 7.1 What it is
The AI-assisted triage module for walk-in hospital workflows.

### 7.2 Files and tech
- **Frontend panel:** `src/components/TriagePanel.tsx`
- **Server AI prompting:** `server/ai.ts`, `server/gemini.ts`
- **Shared clinical types:** `shared/clinical.ts`, `shared/types.ts`
- **Dashboard integration:** `src/pages/app/Dashboard.tsx`
- **Implementation language:** TypeScript + React + Express + Gemini

### 7.3 Batch configuration
- Allowed batch size: minimum 3 patients, maximum 100 patients.
- Example sizes: 3, 5, 10, 20, 30, 50, 100.
- The selected batch size determines how many patient records are processed together.

### 7.4 Batch workflow
For example, if the hospital selects five patients:
1. Five patients complete registration.
2. Their records appear in the AI Triage queue.
3. Staff starts the batch.
4. The system displays each patient’s processing status in real time.
5. Individual triage results are generated.
6. Results are attached to the respective patient records.
7. Results are sent to the appropriate department queues.
8. The dashboard updates.

### 7.5 Queue display
Show:
- Patient number
- Patient name where authorized
- Department
- Processing status
- Triage result
- Time of assessment

### 7.6 Triage information sources
- For existing patients: use relevant historical records alongside current symptoms.
- For new patients: use their current registration information and reported symptoms.

### 7.7 Triage output
Provide:
- Presenting complaint
- Relevant symptoms
- Relevant medical history
- Warning signs
- Recommended urgency category
- Reason for the recommendation
- Recommended next action
- Time of assessment

### 7.8 Triage instructions given to the AI
The triage prompt must instruct the model:
- Use the hospital’s approved triage protocol.
- A qualified healthcare professional remains responsible for clinical prioritization.
- Escalate possible emergency warning signs immediately, without waiting for the batch to finish.
- Do not independently diagnose patients or replace clinical judgement.
- Return structured output so the system can attach the result to the correct patient record and department queue.

### 7.9 Emergency escalation
- Possible emergency warning signs must be escalated immediately.
- This must happen even if the batch is not finished.

---

## 8. Dashboard

### 8.1 What it is
The central hospital operations view.

### 8.2 Files and tech
- **Main dashboard:** `src/pages/app/Dashboard.tsx`
- **Layout/shell:** `src/workspace/WorkspaceLayout.tsx`
- **Implementation language:** TypeScript + React

### 8.3 Most important function
Display the prioritized list of patients waiting to see a doctor.

### 8.4 Patient queue columns
Show:
- Patient number
- Patient name where authorized
- Department
- Triage category
- Registration time
- Triage time
- Waiting time
- Assigned doctor where available
- Current status

### 8.5 Dashboard behavior
- Update the dashboard when patient records or queue states change.
- Sort patients according to the hospital’s approved triage and prioritization rules.
- Emergency cases must be clearly highlighted.

### 8.6 Summary cards
Show:
- Patients registered today
- Patients awaiting triage
- Patients triaged
- Patients waiting for a doctor
- Patients being attended to
- Patients requiring urgent review
- Completed encounters
- Relevant waiting-time statistics

### 8.7 Role-based views
- Medical Director: overall hospital dashboard.
- Department Heads: their authorized department dashboard.

---

## 9. AI Medical Scribe

### 9.1 What it is
A medical documentation assistant that reduces doctor documentation burden.

### 9.2 Files and tech
- **Frontend panel:** `src/components/ScribePanel.tsx`
- **Server AI prompting:** `server/ai.ts`, `server/gemini.ts`
- **Patient/encounter context:** `src/pages/app/PatientDetail.tsx`, `src/components/EncounterActions.tsx`
- **Shared clinical types:** `shared/clinical.ts`, `shared/types.ts`
- **Implementation language:** TypeScript + React + Express + Gemini

### 9.3 Workflow
1. The doctor opens a patient record.
2. The doctor starts voice capture with appropriate consent.
3. The system transcribes the conversation.
4. The system organizes it into clinical notes.
5. The system creates a draft.
6. The doctor reviews and edits.
7. The note is saved only after clinician approval.

### 9.4 Supported note sections
- Presenting complaint
- History of presenting complaint
- Medical history
- Examination findings
- Assessment
- Diagnosis where stated or confirmed
- Treatment plan
- Medication plan where stated
- Investigations
- Follow-up instructions

### 9.5 Rules
- Never invent clinical findings or treatment decisions.
- Link every approved note to the correct patient and encounter.
- Measure documentation time so Afribok can assess whether the scribe reduces administrative work.

### 9.6 Scribe instructions given to the AI
The scribe prompt must instruct the model:
- Use only what was actually said in the captured consultation.
- Do not invent findings, diagnoses, medications, or treatment decisions.
- Structure the transcription into the standard clinical note sections.
- Leave a section empty or marked not documented when it was not covered.
- Produce a draft for clinician review and approval, not a final signed note.

---

## 10. Predictive Engine

### 10.1 What it is
Forecasting of hospital operations using available data.

### 10.2 Files and tech
- **Server backend:** `server/forecast.ts`
- **Frontend view:** `src/pages/app/Forecast.tsx`
- **Dashboard/context integration:** Dashboard and operational views
- **Implementation language:** TypeScript + React + Express

### 10.3 Predictions it must support
- Patient inflow
- Patient outflow
- Departmental demand
- Patient workload
- Waiting-time patterns
- Staff workload
- Laboratory workload
- Pharmacy workload
- Other operational forecasts supported by available data

### 10.4 Prediction card display
Each prediction card must show:
- What is being predicted
- Department
- Forecast period
- Historical data used
- Data quality
- Confidence or uncertainty
- Last updated time

### 10.5 Predictive Engine onboarding
When the hospital opens this module for the first time, ask:
- “Does your hospital have historical clinical or operational data covering at least three months?”

If yes, ask whether the data is:
- Paper-based
- Digital
- Stored in an EHR/EMR
- Available in multiple formats

### 10.6 Paper-based historical data
Provide:
- OCR upload and scanning
- Voice-assisted historical data entry

### 10.7 Digital historical data
Provide:
- Excel upload
- CSV upload
- Word document upload
- Structured text entry
- Existing EHR/EMR integration through an approved API

### 10.8 Existing EHR/EMR
If the hospital already uses an EHR/EMR, allow it to connect that system to Afribok. This is especially important because the Predictive Engine should be able to get relevant historical and ongoing operational data from the hospital’s existing records.

### 10.9 New hospital without historical data
If the hospital has no suitable historical data:
- Configure its departments
- Collect its operational information
- Begin recording patient activity from day one
- Build the data history progressively
- Generate preliminary forecasts only when enough reliable information exists

### 10.10 Data period support
Support historical periods from approximately three months up to three years or longer where available.

### 10.11 Accuracy rule
Do not promise forecast accuracy that the available data cannot support.

### 10.12 Forecast instructions given to the AI/model
The forecasting logic should be based on the hospital’s actual recorded operational events and timestamps, not on invented figures. Where AI is used to summarize or project trends, it must:
- Use only the data available for that hospital and department
- State the forecast period
- State the data quality
- State confidence or uncertainty
- Not fabricate numbers

---

## 11. EHR/EMR Integration and Afribok EHR

### 11.1 What it is
A major architectural part. Afribok must support two situations:
- A. Hospitals that already have an EHR/EMR
- B. Hospitals that do not have an EHR/EMR and need Afribok to provide one

The EHR must not be an isolated storage feature. It should connect the other Afribok modules.

### 11.2 Files and tech
- **Frontend:** `src/pages/app/Ehr.tsx`, `src/pages/app/History.tsx`
- **Server integration layer:** `server/platform.ts`, `server/repository.ts`, `server/setup.ts`
- **Shared types:** `shared/types.ts`
- **Implementation language:** TypeScript + React + Express

### 11.3 A. Integration with an existing EHR/EMR
When a hospital already uses an EHR or EMR, provide an integration setup process and ask the hospital to provide or configure:
- EHR/EMR name
- Vendor
- API documentation
- API endpoint or approved connection method
- Authentication method
- Available permissions
- Supported data formats
- Available patient and encounter resources
- Whether read access is supported
- Whether write access is supported

### 11.4 Supported standards and interfaces
Where available, support:
- HL7
- FHIR
- Approved REST APIs
- Secure file-based exchange where appropriate
- Other vendor-supported integration methods

Do not assume every system supports every standard.

### 11.5 Architecture rule
Build a modular integration layer so that different EHR/EMR systems can be connected through separate connectors.

### 11.6 B. Read access
Where authorized and technically supported, Afribok should be able to read relevant information from the hospital’s EHR/EMR, including:
- Patient demographics
- Patient identifiers
- Medical history
- Diagnoses
- Allergies
- Medications
- Encounters
- Clinical notes
- Investigations
- Laboratory results
- Department information
- Relevant historical operational data

This information can be used by:
- OCR & Patient Intake
- AI Triage
- AI Medical Scribe
- Predictive Engine
- AI Assistant

The system must respect permissions and only retrieve information necessary for the relevant task.

### 11.7 C. Write access
Where authorized and technically supported, Afribok should be able to write approved information back into the existing EHR/EMR, including:
- New patient registrations
- Updated patient demographics
- Approved clinical notes
- Approved encounter information
- Triage assessments where supported
- Relevant encounter updates
- Other agreed structured clinical information

**Important:** The AI must never automatically write unreviewed clinical conclusions, diagnoses, prescriptions, or treatment decisions into the official EHR. Clinical notes and other sensitive clinical entries must pass through the appropriate authorized human approval process.

### 11.8 D. Two-way synchronisation
Where the external system allows it, the integration must support:
- Afribok reading authorized data from the EHR/EMR
- Afribok writing authorized and approved data back
- Relevant updates synchronizing between the systems
- Synchronisation failures being recorded
- Duplicate submissions being prevented
- Conflicting updates being flagged
- Staff seeing the synchronisation status

Do not silently overwrite existing clinical records.

### 11.9 Identifier and audit rules for integration
- Use unique identifiers and appropriate mapping between Afribok records and external EHR/EMR identifiers.
- Maintain an audit trail showing:
  - What was read
  - What was written
  - When it happened
  - Which user or system initiated it
  - Whether the operation succeeded
  - Whether it was reviewed or approved

### 11.10 E. Afribok’s own EHR
For hospitals without an existing EHR/EMR, Afribok should provide a structured digital patient-record system that includes:
- Patient profiles
- Patient demographics
- Patient history
- Encounter records
- Clinical notes
- Approved diagnoses
- Medication records
- Allergy records
- Investigations and results
- Relevant attachments
- Patient visit history
- Department associations
- Audit history

The Afribok EHR should connect directly to the four operational modules:
- When a new patient is registered, the patient record is created.
- When the patient is triaged, the triage result is linked to the patient’s record.
- When a doctor completes a consultation using AI Medical Scribe, the approved note is added to the patient’s record.
- The Predictive Engine uses appropriate operational information from these records.
- The AI Assistant can answer authorized questions based on the records available to its user.

### 11.11 F. EHR integration management
Provide an EHR Integration area for authorized administrators that shows:
- Connected EHR/EMR
- Connection status
- Last successful synchronisation
- Pending synchronisation
- Failed operations
- Available permissions
- Read/write capability
- Integration health
- Error logs

Allow authorized administrators to configure, test, pause, and disconnect integrations.

Protect API credentials and never expose them to ordinary users.

### 11.12 G. Integration research and implementation
Before building individual EHR connectors, research the technical requirements of common EHR/EMR platforms used by African hospitals, including:
- FHIR compatibility
- HL7 compatibility
- Vendor API access
- Authentication
- Data models
- Licensing
- Integration restrictions
- Data residency
- Security and contractual requirements

Do not pretend an integration exists until it has been implemented and tested with the relevant system.

---

## 12. Department-specific AI Assistant

### 12.1 What it is
An intelligent AI Assistant that understands the operational information and records available within the system.

### 12.2 Files and tech
- **Frontend:** `src/pages/app/Assistant.tsx`
- **Server AI prompting/retrieval:** `server/ai.ts`, `server/gemini.ts`, `server/repository.ts`
- **Auth/permissions:** `server/auth.ts`, `shared/types.ts`
- **Implementation language:** TypeScript + React + Express + Gemini

### 12.3 Nature of the assistant
It is not merely a general chatbot. It should understand relevant information from:
- Patient records
- Approved clinical notes
- AI triage results
- Department activity
- Patient queues
- Historical records
- Operational data
- Predictive Engine results
- EHR/EMR information accessible to the user
- Archived records where the user has permission to access them

Access must be strictly personalized to the user.

### 12.4 Individual user context
Each staff member should have an AI Assistant that understands:
- Their account
- Their role
- Their department
- Their permissions
- Their current working context
- The records they are authorized to access

Examples:
- A nurse in Paediatrics should have an Assistant that can answer authorized questions about the Paediatrics department and the patient information available to that nurse.
- A doctor in Emergency should have an Assistant that understands their authorized Emergency Department context.
- A receptionist should not receive unrestricted access to clinical records simply because they can use the Assistant.

### 12.5 Example questions by role

#### Nurse questions
- How many patients are currently waiting in my department?
- Which patients have not completed triage?
- Which patients have been waiting the longest?
- Which patients have been flagged for urgent clinical review?
- What is the status of a particular patient, if I am authorized to view it?
- What is the expected patient demand for this department today?

#### Doctor questions
- Show me the relevant history of this patient.
- Summarize this patient’s previous encounters.
- What allergies are documented in this patient’s record?
- What information was captured during registration?
- Summarize the approved clinical notes from the previous encounter.

#### Department Head questions
- How many patients has my department attended to today?
- What is the current queue?
- What are the department’s operational bottlenecks?
- What does the Predictive Engine expect for tomorrow?
- Which operational metrics need attention?

### 12.6 Rules for answers
- The Assistant must only answer using information the particular user is authorized to access.
- It must clearly indicate when information is unavailable or insufficient.
- It must not invent patient information.
- It must not make independent diagnoses or issue treatment decisions.

### 12.7 Medical Director’s hospital-wide Assistant
The Medical Director or appropriately authorized hospital-wide administrator should have access to a broader Assistant context. When this authorized user logs in, the Assistant may answer questions about the entire hospital, subject to their permissions and applicable confidentiality rules.

Examples:
- How many patients were registered across the hospital today?
- Which department has the highest patient inflow?
- Which department has the longest waiting time?
- What are the hospital’s operational trends?
- How many patients were processed by each department?
- What is the predicted demand across all departments?
- What are the main operational bottlenecks?
- What changes have occurred across the hospital?

The Medical Director’s privileged access should be protected by strong authentication.

### 12.8 Conversation and history separation
The AI Assistant must maintain separation between users and departments.

Rules:
- A normal staff member must not be able to view another person’s private AI Assistant conversations just because they work in the same hospital.
- A Department Head may receive authorized department-level operational insights, but should not automatically receive private conversations belonging to every staff member.
- The Medical Director may have a separately defined administrative audit capability to review relevant AI Assistant activity across the hospital, where authorized by hospital policy and applicable law.

Distinguish between:
- Private user conversations
- Department-level operational summaries
- Hospital-wide administrative audit records

Do not automatically expose sensitive private conversations to management without an appropriate policy, purpose, and access control.

Record privileged access to AI Assistant history in the audit log.

### 12.9 Knowledge and retrieval rules
The Assistant should use a permission-aware retrieval system. Before retrieving any information, it must verify:
- The user’s identity
- The user’s hospital
- The user’s department
- The user’s role
- The user’s access permissions
- The relevant patient or operational data permissions
- The AI must not be able to bypass the application’s access controls

Do not rely on an LLM prompt alone to enforce confidentiality. Enforce permissions before data is supplied to the model.

### 12.10 Assistant action rules
Initially, the Assistant should focus on retrieving, explaining, and summarizing authorized information.

For actions that modify records:
- Require explicit user confirmation
- Require appropriate permissions

Examples:
- Drafting a note is allowed.
- Saving an approved note requires authorization.
- Changing patient priority requires an authorized workflow.
- Editing patient demographics requires appropriate permissions.
- Writing to an external EHR requires approved integration permissions.

Maintain an audit record for important actions.

---

## 13. Offline-first architecture

### 13.1 What it is
All essential Afribok workflows must work offline. The application must not depend on constant cloud connectivity.

### 13.2 Files and tech
- **Service worker:** `public/sw.js`
- **Local data layer:** `src/lib/local-db.ts`, `src/lib/local-types.ts`
- **Sync layer:** `src/lib/sync.ts`
- **Offline AI fallback (where applicable):** `src/lib/offline-ai.ts`
- **Implementation language:** TypeScript + React + IndexedDB + service worker

### 13.3 Supported offline capabilities
- Offline patient registration
- Offline access to locally available patient records
- Offline patient numbering
- Offline queue management
- Offline capture of triage information
- Offline triage where a suitable local model is installed
- Offline medical-note drafting where supported
- Offline access to locally available dashboard information
- Local storage of operational events
- Synchronisation when connectivity returns

### 13.4 Multi-device and small-facility support
- For hospitals with multiple devices, support a local hospital server or local network service.
- For smaller facilities, an encrypted on-device database may be appropriate.

### 13.5 Mechanisms to use
- Unique identifiers
- Durable local change queues
- Idempotent synchronisation
- Conflict detection
- Retry mechanisms
- Audit logs
- Encryption
- Backup and recovery

### 13.6 EHR integration offline behavior
The EHR integration should also support appropriate synchronisation when connectivity is available.

Where the external EHR is unreachable:
- Clearly indicate that the external system cannot currently be contacted
- Do not pretend a write has succeeded
- Preserve locally created changes until they can be safely synchronised

### 13.7 Sync status display
Clearly display:
- Saved locally
- Waiting to synchronise
- Synchronised
- Synchronisation failed

---

## 14. Security, privacy, and clinical governance

### 14.1 What it is
The safeguards around data, access, AI use, and clinical responsibility.

### 14.2 Files and tech
- **Auth:** `server/auth.ts`, `src/auth/AuthProvider.tsx`
- **Audit/logging:** `server/repository.ts` and related audit storage
- **Config/env:** `server/config.ts`, `.env` handling
- **Implementation language:** TypeScript on both sides

### 14.3 Requirements
Implement:
- Encryption in transit and at rest
- Secure local storage
- Role-based access control
- Individual staff accounts
- Session security
- Privileged authentication
- Audit logs
- Secure API credential storage
- Backup and disaster recovery
- Consent management
- Data retention policies
- Secure deletion processes
- Device loss and revocation procedures

### 14.4 AI governance rules
- Do not send identifiable patient information to public AI services without appropriate legal, privacy, security, and contractual safeguards.
- AI-generated clinical content must remain subject to human review.
- The hospital must be able to define appropriate access and governance policies.

---

## 15. User interface and experience

### 15.1 What it is
The visual and interaction layer for the whole platform.

### 15.2 Files and tech
- **CSS:** `src/styles/global.css`, `src/styles/app.css`, `src/styles/auth.css`, `src/styles/landing.css`
- **Components:** `src/components/ui.tsx`, `src/components/Icon.tsx`, and feature components
- **Implementation language:** TypeScript + React + CSS

### 15.3 Design rules
- Create a clean, modern healthcare technology interface.
- Use clear setup cards for onboarding.
- After onboarding, show only the features relevant to each user’s roles and permissions.
- Keep the four main operational workflows prominent:
  - OCR & Patient Intake
  - AI Triage
  - AI Medical Scribe
  - Predictive Engine
- Make EHR and EHR Integration clearly accessible to authorized users.
- Make the AI Assistant easy to access throughout the application.
- Do not clutter the interface with unnecessary sections.

### 15.4 Device targets
The interface must work well on:
- Desktop computers
- Tablets
- Smartphones

Use clear labels and simple workflows.

---

## 16. Measurement and performance

### 16.1 What it is
Reliable operational event capture and timestamping.

### 16.2 Files and tech
- **Backend:** `server/repository.ts`, `server/forecast.ts`
- **Frontend workflow components:** registration, triage, scribe, dashboard
- **Implementation language:** TypeScript

### 16.3 What to measure
- Patient arrival-to-registration time
- Registration-to-triage time
- Triage-to-doctor time
- Total patient waiting time
- Patients registered per day
- Patients triaged per day
- Consultations completed
- Doctor documentation time
- Patient inflow and outflow
- Departmental workload
- Revenue or collections where authorized and available

### 16.4 Comparison rule
Support comparisons between baseline performance and performance after Afribok deployment.

Do not invent performance figures.

---

## 17. Implementation plan

### 17.1 Before changing the application
Do these in order:
1. Inspect the current codebase.
2. Identify the technology stack.
3. Review the current database and data models.
4. Identify existing functionality worth retaining.
5. Identify unnecessary or duplicate sections.
6. Review the existing authentication system.
7. Review existing offline functionality.
8. Identify the existing AI integrations.
9. Identify current EHR/EMR integration capabilities.
10. Produce an implementation plan.

Then implement the changes in stages.

### 17.2 Build rule
Do not simply produce mock-up screens. Buttons, forms, workflows, integrations, and data persistence must be functional.

Build the architecture modularly.

### 17.3 Modular guarantees to maintain
- Hospital data is isolated between hospitals.
- Department data is correctly associated.
- User permissions are enforced.
- Patient identifiers are consistent.
- Patient encounters are linked.
- Triage results are linked to patients.
- Approved scribe notes are linked to encounters.
- EHR records are mapped correctly.
- Predictive data is derived from appropriate sources.
- AI Assistant retrieval respects user permissions.

### 17.4 Pending items
Where an integration or AI model has not yet been configured, clearly label it as pending implementation.

---

## 18. Final acceptance tests

The application must demonstrate all of the following:

1. A hospital can create an Afribok account.
2. It must complete the onboarding cards before entering the main dashboard.
3. It can register its name and departments.
4. It can indicate whether it uses an EHR/EMR.
5. It can provide information about historical data.
6. It can configure its technical and offline environment.
7. It can create individual staff accounts.
8. Staff can log in with their own credentials.
9. Staff see only authorized departments and information.
10. The Medical Director has the appropriate hospital-wide permissions.
11. Department Heads have department-level permissions.
12. Existing patients can be registered through OCR.
13. New patients can be registered through digital forms.
14. New patients can be registered through voice-assisted entry.
15. Patients receive unique identifiers.
16. Staff can process AI triage in batches of 3 to 100.
17. Emergency warning signs are escalated immediately.
18. Individual triage results appear in the correct patient records.
19. The dashboard displays the prioritized patient queue.
20. Doctors can use AI Medical Scribe.
21. Doctors can review and approve clinical notes.
22. Hospitals can import historical paper records.
23. Hospitals can import digital historical records.
24. Hospitals with an existing EHR/EMR can configure integration.
25. Afribok can read authorized patient information from an integrated EHR/EMR.
26. Afribok can write approved information back to an integrated EHR/EMR where supported.
27. Synchronisation errors and conflicts are handled safely.
28. Hospitals without an EHR can use Afribok’s own EHR functionality.
29. The Predictive Engine can use appropriate hospital data.
30. New hospitals can start collecting data from day one.
31. Staff can use a department-specific AI Assistant.
32. The AI Assistant respects each user’s role and permissions.
33. The Medical Director can access authorized hospital-wide operational insights.
34. Private user conversations are appropriately separated from administrative reporting.
35. Essential workflows continue during internet outages.
36. Locally saved changes synchronise safely when connectivity returns.

---

## 19. Final product vision

Afribok is one connected, offline-first hospital intelligence and operations platform.

Its four main operational workflows are:
1. OCR & Patient Intake / Registration
2. AI Triage
3. AI Medical Scribe
4. Predictive Engine

Its supporting capabilities include:
- A central hospital dashboard
- Afribok’s own EHR
- Integration with external EHR/EMR systems
- A permission-aware, department-specific AI Assistant
- Hospital-wide administration and staff hierarchy

The system must understand the hospital, its departments, its staff, its patients, and its operational data. It must connect these capabilities rather than build them as unrelated features.

Prioritize patient safety, privacy, offline reliability, accurate data exchange, practical usability, and measurable hospital improvement.
