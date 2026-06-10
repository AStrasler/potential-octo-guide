# ScholarScan TODO

## Phase 1: Schema & Database
- [x] Design and create `email_verifications` table (email, code, expires_at, verified)
- [x] Design and create `verified_sessions` table (session_token, email, expires_at)
- [x] Design and create `scans` table (id, email, text, file_name, status, created_at)
- [x] Design and create `scan_results` table (scan_id, ai_score, plagiarism_score, citations_json, ai_details_json, plagiarism_details_json)
- [x] Apply all migrations via webdev_execute_sql

## Phase 2: Email Verification (OTP Gate)
- [x] Server: email allowlist validation (.edu + Aaron.M.Strasler@outlook.com)
- [x] Server: generate and store 6-digit OTP with 15-min expiry
- [x] Server: send OTP via built-in notification or email service
- [x] Server: verify OTP and issue signed session token (JWT cookie)
- [x] Server: session middleware to protect all scan procedures
- [x] Frontend: elegant email entry page with .edu branding
- [x] Frontend: OTP entry page with countdown timer and resend
- [x] Frontend: session persistence and auto-redirect

## Phase 3: LLM-Powered Analysis Backend
- [x] AI Detection: LLM prompt returning sentence-level confidence scores + overall score (0-100)
- [x] AI Detection: structured JSON schema with per-sentence AI probability
- [x] Plagiarism: LLM semantic analysis returning matched passages + similarity scores + source URLs
- [x] Plagiarism: overall originality score (0-100)
- [x] Citation Validator: parse APA/MLA/Chicago/Harvard formats
- [x] Citation Validator: field-by-field error detection and suggested corrections
- [x] tRPC procedure: `scan.submit` (text + optional file) → triggers all 3 checks
- [x] tRPC procedure: `scan.getResult` (scan_id) → returns full structured results
- [x] tRPC procedure: `scan.history` → paginated list of past scans
- [x] File upload: parse .txt and .docx files client-side

## Phase 4: Frontend Features
- [x] Unified scan input page (text area + file upload tab)
- [x] Real-time progress indicator during analysis (polling)
- [x] Unified results dashboard: AI gauge + plagiarism meter + citation badges
- [x] AI Detection panel: sentence-level highlighting with confidence colors
- [x] Plagiarism panel: matched passages with source URLs and similarity %
- [x] Citation panel: field-by-field error highlighting with fix suggestions
- [x] Scan history page: searchable list with result previews
- [x] Expandable detail sections per check
- [x] PDF export of full report (jsPDF)

## Phase 5: UI Polish
- [x] Premium landing page with ScholarScan branding
- [x] Elegant typography (Inter font)
- [x] Smooth animations (framer-motion) on all transitions
- [x] Responsive design (mobile + desktop)
- [x] Dark academic theme with premium color palette
- [x] Loading states and micro-interactions
- [x] Empty states and error states

## Phase 6: Testing & Delivery
- [x] Vitest: email validation logic (sendCode accepts .edu, rejects others)
- [x] Vitest: OTP generation and verification (valid/invalid code)
- [x] Vitest: session management (getSession authenticated/unauthenticated)
- [x] Vitest: scan.submit, scan.getResult, scan.history
- [x] Vitest: auth.logout
- [x] All 15 tests passing
- [x] Checkpoint saved
