;; complaint-escrow.clar
;; ComplaintEscrow Contract: Core escrow management for SpeedChain ISP accountability platform
;; Handles staking, complaint filing, validation integration, resolution triggering, and advanced features like multi-party disputes, timeouts, and governance hooks.

(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-TEST u101)
(define-constant ERR-INSUFFICIENT-STAKE u102)
(define-constant ERR-COMPLAINT-NOT-FOUND u103)
(define-constant ERR-INVALID-STATUS u104)
(define-constant ERR-ORACLE-FAILURE u105)
(define-constant ERR-INSUFFICIENT-BALANCE u106)
(define-constant ERR-INVALID-AMOUNT u107)
(define-constant ERR-COMPLAINT-EXPIRED u108)
(define-constant ERR-ALREADY-RESOLVED u109)
(define-constant ERR-INVALID-PARAM u110)
(define-constant ERR-PAUSED u111)
(define-constant ERR-NOT-PAUSED u112)
(define-constant ERR-DISPUTE-ALREADY-EXISTS u113)
(define-constant ERR-NO-DISPUTE u114)
(define-constant ERR-INVALID-DISPUTE-PARTY u115)

(define-constant MIN-STAKE u1000000) ;; 1 $SPD with 6 decimals
(define-constant COMPLAINT-TIMEOUT u144) ;; ~24 hours in blocks (assuming 10-min blocks)
(define-constant MAX-DESCRIPTION-LEN u500)

;; Traits for cross-contract interactions
(define-trait test-logger-trait
  ((get-test (principal uint) (response (optional {download: uint, upload: uint, latency: uint, timestamp: uint}) uint))))

(define-trait oracle-trait
  ((validate-complaint (uint) (response bool uint))))

(define-trait resolution-trait
  ((init-resolution (uint principal) (response bool uint))))

(define-trait token-trait
  ((transfer (uint principal principal (optional (buff 34))) (response bool uint))
   (get-balance (principal) (response uint uint))))

;; Data vars
(define-data-var contract-owner principal tx-sender)
(define-data-var paused bool false)
(define-data-var complaint-counter uint u0)
(define-data-var total-staked uint u0)
(define-data-var governance-hook (optional principal) none)

;; Data maps
(define-map complaints
  { complaint-id: uint }
  { user: principal,
    test-id: uint,
    stake: uint,
    status: (string-ascii 20), ;; "pending", "validated", "rejected", "resolved", "disputed"
    timestamp: uint,
    expiry: uint,
    description: (string-utf8 500) })

(define-map disputes
  { complaint-id: uint }
  { isp-party: principal,
    evidence-hash: (buff 32),
    status: (string-ascii 20), ;; "open", "resolved", "escalated"
    timestamp: uint })

(define-map complaint-history
  { complaint-id: uint, event-id: uint }
  { event-type: (string-ascii 20),
    actor: principal,
    timestamp: uint,
    details: (string-utf8 200) })

(define-data-var history-counter { complaint-id: uint, counter: uint } { complaint-id: u0, counter: u0 })

;; Private functions
(define-private (is-owner (caller principal))
  (is-eq caller (var-get contract-owner)))

(define-private (is-paused)
  (var-get paused))

(define-private (transfer-stake (amount uint) (from principal) (to principal))
  (contract-call? .spd-token transfer amount from to none))

(define-private (log-history (complaint-id uint) (event-type (string-ascii 20)) (details (string-utf8 200)))
  (let ((current (var-get history-counter)))
    (if (not (is-eq (get complaint-id current) complaint-id))
      (var-set history-counter { complaint-id: complaint-id, counter: u1 })
      (var-set history-counter { complaint-id: complaint-id, counter: (+ (get counter current) u1) }))
    (map-set complaint-history
      { complaint-id: complaint-id, event-id: (get counter (var-get history-counter)) }
      { event-type: event-type, actor: tx-sender, timestamp: (block-height), details: details })
    (print { event: "history-log", complaint-id: complaint-id, type: event-type })))

;; Public functions

(define-public (file-complaint (test-id uint) (description (string-utf8 500)) (test-logger <test-logger-trait>))
  (let ((user tx-sender)
        (complaint-id (+ (var-get complaint-counter) u1))
        (stake-amount MIN-STAKE)
        (current-time (block-height)))
    (asserts! (not (is-paused)) (err ERR-PAUSED))
    (asserts! (<= (len description) MAX-DESCRIPTION-LEN) (err ERR-INVALID-PARAM))
    (match (contract-call? test-logger get-test user test-id)
      test-data
      (if (is-some test-data)
        (begin
          (try! (transfer-stake stake-amount user (as-contract tx-sender)))
          (map-set complaints
            { complaint-id: complaint-id }
            { user: user, test-id: test-id, stake: stake-amount, status: "pending",
              timestamp: current-time, expiry: (+ current-time COMPLAINT-TIMEOUT), description: description })
          (var-set complaint-counter complaint-id)
          (var-set total-staked (+ (var-get total-staked) stake-amount))
          (log-history complaint-id "filed" description)
          (print { event: "complaint-filed", id: complaint-id, user: user })
          (ok complaint-id))
        (err ERR-INVALID-TEST))
      error (err error))))

(define-public (validate-complaint (complaint-id uint) (oracle <oracle-trait>))
  (let ((complaint (unwrap! (map-get? complaints { complaint-id: complaint-id }) (err ERR-COMPLAINT-NOT-FOUND)))
        (current-time (block-height)))
    (asserts! (is-eq (get status complaint) "pending") (err ERR-INVALID-STATUS))
    (asserts! (< current-time (get expiry complaint)) (err ERR-COMPLAINT-EXPIRED))
    (match (contract-call? oracle validate-complaint complaint-id)
      is-valid
      (begin
        (if is-valid
          (map-set complaints { complaint-id: complaint-id } (merge complaint { status: "validated" }))
          (map-set complaints { complaint-id: complaint-id } (merge complaint { status: "rejected" })))
        (log-history complaint-id (if is-valid "validated" "rejected") "Oracle decision")
        (print { event: "complaint-validated", id: complaint-id, valid: is-valid })
        (ok is-valid))
      error (err ERR-ORACLE-FAILURE))))

(define-public (release-stake (complaint-id uint))
  (let ((complaint (unwrap! (map-get? complaints { complaint-id: complaint-id }) (err ERR-COMPLAINT-NOT-FOUND)))
        (user (get user complaint))
        (stake (get stake complaint)))
    (asserts! (is-eq (get status complaint) "rejected") (err ERR-INVALID-STATUS))
    (try! (as-contract (transfer-stake stake tx-sender user)))
    (map-set complaints { complaint-id: complaint-id } (merge complaint { status: "resolved" }))
    (var-set total-staked (- (var-get total-staked) stake))
    (log-history complaint-id "stake-released" "Rejected complaint")
    (print { event: "stake-released", id: complaint-id, amount: stake })
    (ok true)))

(define-public (slash-stake (complaint-id uint))
  (let ((complaint (unwrap! (map-get? complaints { complaint-id: complaint-id }) (err ERR-COMPLAINT-NOT-FOUND)))
        (stake (get stake complaint)))
    (asserts! (is-eq (get status complaint) "rejected") (err ERR-INVALID-STATUS))
    ;; Stake is "slashed" by keeping it in contract or sending to governance
    (match (var-get governance-hook)
      gov (try! (as-contract (transfer-stake stake tx-sender gov)))
      (ok true)) ;; If no gov, keep in contract
    (map-set complaints { complaint-id: complaint-id } (merge complaint { status: "resolved" }))
    (var-set total-staked (- (var-get total-staked) stake))
    (log-history complaint-id "stake-slashed" "Frivolous complaint")
    (print { event: "stake-slashed", id: complaint-id, amount: stake })
    (ok true)))

(define-public (trigger-resolution (complaint-id uint) (resolver <resolution-trait>))
  (let ((complaint (unwrap! (map-get? complaints { complaint-id: complaint-id }) (err ERR-COMPLAINT-NOT-FOUND)))
        (user (get user complaint)))
    (asserts! (is-eq (get status complaint) "validated") (err ERR-INVALID-STATUS))
    (match (contract-call? resolver init-resolution complaint-id user)
      success
      (begin
        (map-set complaints { complaint-id: complaint-id } (merge complaint { status: "resolved" }))
        (log-history complaint-id "resolved" "Modem replacement initiated")
        (print { event: "resolution-triggered", id: complaint-id })
        (ok true))
      error (err error))))

(define-public (initiate-dispute (complaint-id uint) (evidence-hash (buff 32)) (isp-party principal))
  (let ((complaint (unwrap! (map-get? complaints { complaint-id: complaint-id }) (err ERR-COMPLAINT-NOT-FOUND))))
    (asserts! (is-eq (get status complaint) "validated") (err ERR-INVALID-STATUS))
    (asserts! (is-none (map-get? disputes { complaint-id: complaint-id })) (err ERR-DISPUTE-ALREADY-EXISTS))
    (map-set disputes
      { complaint-id: complaint-id }
      { isp-party: isp-party, evidence-hash: evidence-hash, status: "open", timestamp: (block-height) })
    (map-set complaints { complaint-id: complaint-id } (merge complaint { status: "disputed" }))
    (log-history complaint-id "dispute-initiated" "ISP challenge")
    (print { event: "dispute-initiated", id: complaint-id, isp: isp-party })
    (ok true)))

(define-public (resolve-dispute (complaint-id uint) (accept-user bool))
  (let ((dispute (unwrap! (map-get? disputes { complaint-id: complaint-id }) (err ERR-NO-DISPUTE)))
        (complaint (unwrap! (map-get? complaints { complaint-id: complaint-id }) (err ERR-COMPLAINT-NOT-FOUND))))
    (asserts! (is-eq tx-sender (get isp-party dispute)) (err ERR-INVALID-DISPUTE-PARTY))
    (asserts! (is-eq (get status dispute) "open") (err ERR-INVALID-STATUS))
    (map-set disputes { complaint-id: complaint-id } (merge dispute { status: (if accept-user "resolved" "escalated") }))
    (map-set complaints { complaint-id: complaint-id } (merge complaint { status: (if accept-user "validated" "rejected") }))
    (log-history complaint-id "dispute-resolved" (if accept-user "User accepted" "Escalated"))
    (print { event: "dispute-resolved", id: complaint-id, outcome: accept-user })
    (ok true)))

;; Admin functions
(define-public (pause)
  (begin
    (asserts! (is-owner tx-sender) (err ERR-NOT-AUTHORIZED))
    (ok (var-set paused true))))

(define-public (unpause)
  (begin
    (asserts! (is-owner tx-sender) (err ERR-NOT-AUTHORIZED))
    (ok (var-set paused false))))

(define-public (set-governance-hook (new-hook principal))
  (begin
    (asserts! (is-owner tx-sender) (err ERR-NOT-AUTHORIZED))
    (ok (var-set governance-hook (some new-hook)))))

(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-owner tx-sender) (err ERR-NOT-AUTHORIZED))
    (ok (var-set contract-owner new-owner))))

;; Read-only functions
(define-read-only (get-complaint (complaint-id uint))
  (map-get? complaints { complaint-id: complaint-id }))

(define-read-only (get-dispute (complaint-id uint))
  (map-get? disputes { complaint-id: complaint-id }))

(define-read-only (get-history-event (complaint-id uint) (event-id uint))
  (map-get? complaint-history { complaint-id: complaint-id, event-id: event-id }))

(define-read-only (get-total-staked)
  (var-get total-staked))

(define-read-only (get-contract-status)
  { paused: (var-get paused), owner: (var-get contract-owner), governance: (var-get governance-hook) })

(define-read-only (get-complaint-count)
  (var-get complaint-counter))