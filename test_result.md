#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## user_problem_statement: "Automated contractor contracts (auto-drafted, discuss, e-sign by both parties) + job completion tracker. Contract must have all relevant info to protect both parties but be easy/hassle-free to complete."

## backend:
##   - task: "Contracts API (create/list/get/update/sign/message/stage)"
##     implemented: true
##     working: "NA"
##     file: "backend/server.py"
##     stuck_count: 0
##     priority: "high"
##     needs_retesting: true
##     status_history:
##         -working: "NA"
##         -agent: "main"
##         -comment: "Added contract models + endpoints: POST /api/contracts (auto-draft w/ 9 standard clauses + 5 job stages), GET /api/contracts, GET /api/contracts/{id}, PUT /api/contracts/{id} (blocks edit when fully signed, resets signatures on edit), POST /api/contracts/{id}/sign (customer side by creator, contractor side by contractor/admin role; both signed -> status active + stage 1 auto-done), POST /api/contracts/{id}/messages (discussion), POST /api/contracts/{id}/stage (contractor/admin only; marks progress; last stage -> completed). Curl-tested full flow OK: draft->cust sign->admin(pro) sign->active->stage update->completed path, edit-after-sign returns 400."

## frontend:
##   - task: "Contract screen + job tracker + contractor draft flow"
##     implemented: true
##     working: "NA"
##     file: "frontend/app/contract/[id].tsx, frontend/app/contracts/index.tsx, frontend/app/contractor/[id].tsx, frontend/app/(tabs)/projects.tsx"
##     stuck_count: 0
##     priority: "high"
##     needs_retesting: true
##     status_history:
##         -working: "NA"
##         -agent: "main"
##         -comment: "Contractor detail: 'Draft an agreement' (testID draft-contract) opens project chooser -> creates contract -> navigates to /contract/[id]. Contract screen shows parties, editable terms (edit-terms, save-terms), collapsible standard clauses, dual signature boxes (open-sign, sign-name-input, confirm-sign), job tracker (stage-{i}, contractor/admin tappable) once both signed, and a discussion thread (contract-chat-input, contract-send). My Agreements list at /contracts (open-agreements on Projects tab, my-agreements on contractor screen)."

## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 6

## test_plan:
##   current_focus:
##     - "Contracts API (create/list/get/update/sign/message/stage)"
##     - "Contract screen + job tracker + contractor draft flow"
##   stuck_tasks: []
##   test_all: false
##   test_priority: "current_focus"

## agent_communication:
##     -agent: "main"
##     -message: "Please E2E test the new Contract + Job Tracker feature (backend + frontend). Customer: garden_test@example.com/secret123 signs the customer side; Admin: admin@glamgarden.app/GlamAdmin2026! signs the contractor side and updates job stages. Verify: draft creation from contractor screen, editing terms resets signatures, dual e-sign flips status draft->awaiting_signatures->active, job tracker appears only after both sign and only contractor/admin can update stages (last stage -> completed), discussion messages persist, and access control (a random second customer cannot open someone else's contract)."

## --- Iteration 7 additions (reviews w/ photos + legal pages) ---
## backend:
##   - task: "Contractor reviews accept & return image_paths"
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     needs_retesting: false
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "ReviewCreate now has image_paths (max 6 stored). POST /contractors/{id}/reviews persists and returns image_paths; GET /contractors/{id} returns them. Curl-verified."
## frontend:
##   - task: "Review modal photo upload + review card photo thumbnails + zoom"
##     implemented: true
##     working: "NA"
##     file: "frontend/app/contractor/[id].tsx"
##     needs_retesting: true
##     status_history:
##         -working: "NA"
##         -agent: "main"
##         -comment: "Review modal has add-review-photo (uploads via pickFromLibrary), thumbnails with remove; review cards show horizontal photo strip (review-photo-{id}) opening ImageViewer. NOTE: native gallery picker may not be automatable on web — please at least verify a review WITH photos (seeded via API) renders thumbnails and opens the zoom viewer, and that submitting a text review still works."
##   - task: "Legal pages (Terms, Privacy/Data Protection, Safety)"
##     implemented: true
##     working: "NA"
##     file: "frontend/app/legal/[doc].tsx, frontend/app/(tabs)/profile.tsx"
##     needs_retesting: true
##     status_history:
##         -working: "NA"
##         -agent: "main"
##         -comment: "Profile rows (testID terms/privacy/safety) now navigate to /legal/terms, /legal/privacy, /legal/safety which render full content. Verify each opens and shows sections + back works."

## agent_communication:
##     -agent: "main"
##     -message: "Iteration 7: Please FRONTEND-test (1) Reviews with photos on a contractor profile — a review with photos already exists via API on the first contractor; verify thumbnails render and tapping opens the zoom viewer, and that posting a normal text review still works (photo picker itself may not be automatable on web, that's OK). (2) Legal pages open from Profile > Legal & Safety (terms/privacy/safety) and render content with working back button. Also quick-confirm the EXISTING admin counters (stat-now/stat-users-5m/stat-1h/stat-24h on /admin) and home social links (social-fb/ig/tt/yt) + QR share (share-qr on Profile) still work. Creds: customer garden_test@example.com/secret123, admin admin@glamgarden.app/GlamAdmin2026!"

## --- Iteration 8: Contractor Accounts + Contract PDF + Deposit (Stripe) + Review Reminders ---
## backend:
##   - task: "Contractor accounts (claim -> admin approve, my-contractor, profile edit, review reply)"
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     needs_retesting: false
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "POST /contractors/{id}/claim (contractor role, sets pending), GET /admin/claims, POST /admin/claims/{id}/action approve|reject, GET /my-contractor (renamed to avoid /contractors/{id} shadow), PUT /contractors/{id}/profile (owner/admin only), POST /contractors/{id}/reviews/{rid}/reply (owner/admin). Contract access now scoped: contractor sees only owned listings' contracts. Curl-verified incl 403 for non-owner."
##   - task: "Contract PDF (reportlab)"
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     needs_retesting: false
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "GET /contracts/{id}/pdf?token=... streams application/pdf with all terms, 9 clauses, signatures+dates. Curl returned 200 application/pdf 4281 bytes."
##   - task: "Deposit payments (Stripe test mode via emergentintegrations)"
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     needs_retesting: false
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "POST /contracts/{id}/deposit (customer, fully-signed, numeric price) computes deposit=price*pct, creates Stripe Checkout Session (GBP), stores payment_transactions, returns url+session_id. GET /payments/status/{session_id} polls Stripe, marks contract deposit_paid once. STRIPE_API_KEY added to backend/.env. Curl-verified: £720 for £2400@30%, session created, status unpaid/open pre-payment."
##   - task: "Review reminders (completed jobs need review)"
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     needs_retesting: false
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "GET /reminders returns customer's completed+unreviewed+undismissed contracts. add_review with contract_id marks that contract reviewed. POST /contracts/{id}/dismiss-review. Curl-verified count drops after review."
## frontend:
##   - task: "Contractor Hub + admin Claims + Contract PDF/Deposit UI + Review reminder banners"
##     implemented: true
##     working: "NA"
##     file: "frontend/app/contractor-hub/index.tsx, frontend/app/admin/index.tsx, frontend/app/contract/[id].tsx, frontend/app/(tabs)/index.tsx, frontend/app/(tabs)/projects.tsx, frontend/app/(tabs)/profile.tsx, frontend/app/contractor/[id].tsx"
##     needs_retesting: true
##     status_history:
##         -working: "NA"
##         -agent: "main"
##         -comment: "Profile>Contractor>Contractor Hub (testID profile-contractor-hub). Hub: claim listing (claim-{id}), pending state, edit-profile/save-profile, reply-{rid}/send-reply, hub-agreements. Admin dashboard: claim-{id} with approve-claim-{id}/reject-claim-{id}. Contract screen: pay-deposit (customer, fully signed, opens Stripe Checkout; returns via ?deposit=success&session_id=), download-pdf (opens PDF). Home: review-reminder banner. Projects tab: 'to review' badge on open-agreements. Contractor detail auto-opens review modal via ?review=1&contract_id=."

## agent_communication:
##     -agent: "main"
##     -message: "Iteration 8 — please test BOTH. Backend already curl-verified. Focus frontend E2E: (1) Contractor flow: register a NEW contractor account (role contractor) -> Profile > Contractor Hub -> claim a listing -> login admin -> Admin Dashboard shows the claim -> approve -> back as contractor: Hub now shows the listing, edit profile works, reply to a review works. (2) Deposit: as customer garden_test, on a FULLY-SIGNED contract with a numeric price (create one, sign as customer, sign contractor side as admin), tap pay-deposit -> Stripe Checkout opens (test card 4242 4242 4242 4242, any future expiry, any CVC) -> completes -> returns to app -> deposit shows paid. (3) download-pdf opens a PDF. (4) Review reminders: complete a job (admin advances stages to last) then as customer see review-reminder banner on Home + 'to review' badge on Projects; tapping opens the review modal. Creds: customer garden_test@example.com/secret123, admin admin@glamgarden.app/GlamAdmin2026!. Stripe is TEST mode; NOTE deposit marks paid via /payments/status polling on return (no webhook)."

## --- Iteration 9: Stripe Connect (payout onboarding + admin release + commission) ---
## Context: Deposit escrow-style model — customer deposit held on platform balance, admin manually releases to contractor's connected account minus a configurable % commission. Built with raw stripe lib, ACTIVATED only when a real Stripe test key (STRIPE_CONNECT_SECRET_KEY=sk_test_...) is set; otherwise gracefully guarded (503). Built-in sk_test_emergent only supports Checkout.
## backend:
##   - task: "Connect onboarding + status, admin settings(commission), releases list, release transfer"
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     needs_retesting: false
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "POST /connect/onboard & GET /connect/status (Express account + AccountLink; 503 without real key). GET/POST /admin/settings (platform_fee_percent, clamp 0-50). GET /admin/releases (deposit_paid && !released contracts + fee math + payout eligibility). POST /admin/contracts/{id}/release (Transfer net=deposit-fee to connected acct; requires payouts_enabled; idempotent). Deposit checkout + status now branch to raw stripe when real key present (transfer_group + source_transaction via latest_charge). Curl-verified guards: settings get/set 12%, releases connect_enabled=false, onboard 503."
## frontend:
##   - task: "Contractor Hub payouts card + Admin releases & commission UI"
##     implemented: true
##     working: "NA"
##     file: "frontend/app/contractor-hub/index.tsx, frontend/app/admin/index.tsx"
##     needs_retesting: true
##     status_history:
##         -working: "NA"
##         -agent: "main"
##         -comment: "Hub: Payouts card with connect-payouts button (opens onboarding; without real key shows the 503 message via toast). Admin: 'Deposit releases' section with fee-input + save-fee (commission %), release list cards (release-{id}) with release-btn-{id} (disabled when payouts not enabled), and a connect-note warning when Connect isn't enabled."

## agent_communication:
##     -agent: "main"
##     -message: "Iteration 9 (Stripe Connect). NOTE: full payouts need a real Stripe test key which is NOT set in this env, so onboarding/transfers intentionally return 503 with a helpful message. Please verify the GRACEFUL behaviour + UI: (1) Admin dashboard > Deposit releases: fee-input shows current %, changing it and save-fee persists (toast) — verify GET/POST /admin/settings. (2) Admin releases list renders (likely 'No deposits awaiting release' or items with a disabled release button + 'Contractor payouts not set up' note) and a yellow connect-note warning about the missing key. (3) Contractor Hub (register a contractor, claim+admin-approve a listing, back as contractor): Payouts card shows a 'Set up payouts' button (connect-payouts); tapping it surfaces the friendly 'needs a real Stripe test key' error toast (503), NOT a crash. Do NOT attempt real Stripe onboarding/transfers. Creds: customer garden_test@example.com/secret123, admin admin@glamgarden.app/GlamAdmin2026!."
