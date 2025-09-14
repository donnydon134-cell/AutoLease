(impl-trait .trait-sip-010-ft-standard.sip-010-trait)
(impl-trait .trait-renewal-checker-renewal-trait.renewal-trait)

(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant ERR-INVALID-LEASE-ID (err u101))
(define-constant ERR-NO-PAYMENT-HISTORY (err u102))
(define-constant ERR-THRESHOLD-FAILED (err u103))
(define-constant ERR-INVALID-RULES (err u104))
(define-constant ERR-RENEWAL-IN-PROGRESS (err u105))
(define-constant ERR-PERIOD-MISMATCH (err u106))
(define-constant ERR-CALCULATION-OVERFLOW (err u107))
(define-constant ERR-ORACLE-NOT-VERIFIED (err u108))
(define-constant ERR-GRACE-PERIOD-EXCEEDED (err u109))
(define-constant ERR-MIN-PAYMENTS-NOT-MET (err u110))
(define-constant ERR-INVALID-THRESHOLD (err u111))
(define-constant ERR-INVALID-PERIOD (err u112))
(define-constant ERR-LEASE-NOT-FOUND (err u113))
(define-constant ERR-UPDATE-FAILED (err u114))

(define-data-var next-evaluation-id uint u0)
(define-data-var max-evaluations uint u500)
(define-data-var oracle-principal principal tx-sender)
(define-data-var default-threshold uint u90)
(define-data-var default-period uint u12)
(define-data-var grace-period uint u30)

(define-map lease-rules
  uint
  {
    threshold: uint,
    period: uint,
    duration-extension: uint,
    min-payments: uint,
    grace-days: uint
  }
)

(define-map evaluation-history
  {lease-id: uint, eval-id: uint}
  {
    timestamp: uint,
    met-threshold: bool,
    on-time-count: uint,
    total-count: uint,
    ratio: uint
  }
)

(define-map renewal-status
  uint
  {
    last-renewed: uint,
    next-eligible: uint,
    active: bool,
    extensions: uint
  }
)

(define-private (validate-lease-id (id uint))
  (if (> id u0) (ok true) (err ERR-INVALID-LEASE-ID))
)

(define-private (validate-threshold (thresh uint))
  (if (and (<= thresh u100) (> thresh u0)) (ok true) (err ERR-INVALID-THRESHOLD))
)

(define-private (validate-period (per uint))
  (if (> per u0) (ok true) (err ERR-INVALID-PERIOD))
)

(define-private (validate-min-payments (min uint))
  (if (> min u0) (ok true) (err ERR-MIN-PAYMENTS-NOT-MET))
)

(define-private (validate-grace-days (days uint))
  (if (<= days (var-get grace-period)) (ok true) (err ERR-GRACE-PERIOD-EXCEEDED))
)

(define-private (is-oracle (caller principal))
  (if (is-eq caller (var-get oracle-principal)) (ok true) (err ERR-ORACLE-NOT-VERIFIED))
)

(define-private (get-payment-history (lease-id uint))
  (contract-call? .payment-tracker get-history lease-id)
)

(define-private (get-current-term (lease-id uint))
  (contract-call? .lease-factory get-term lease-id)
)

(define-private (update-lease-term (lease-id uint) (new-term uint))
  (contract-call? .lease-factory update-term lease-id new-term)
)

(define-private (safe-div (a uint) (b uint))
  (if (is-eq b u0)
    (err ERR-PERIOD-MISMATCH)
    (ok (/ a b))
  )
)

(define-private (safe-mul (a uint) (b uint))
  (if (or (> a u10000) (> b u100))
    (err ERR-CALCULATION-OVERFLOW)
    (ok (* a b))
  )
)

(define-private (calculate-on-time-ratio (history (list 100 {amount: uint, timestamp: uint, on-time: bool})) (period uint))
  (let
    (
      (total (len history))
      (on-time (fold calculate-on-time-fold history u0))
      (period-payments (min total period))
    )
    (if (> period-payments u0)
      (let
        (
          (ratio-res (try! (safe-mul u100 (try! (safe-div on-time period-payments)))))
        )
        (ok (min u100 ratio-res))
      )
      (err ERR-PERIOD-MISMATCH)
    )
  )
)

(define-private (calculate-on-time-fold (payment {amount: uint, timestamp: uint, on-time: bool}) (acc uint))
  (if (get on-time payment) (+ acc u1) acc)
)

(define-read-only (meets-threshold? (history (list 100 {amount: uint, timestamp: uint, on-time: bool})) (rules {threshold: uint, period: uint, min-payments: uint}))
  (let
    (
      (total (len history))
      (ratio-result (try! (calculate-on-time-ratio history (get period rules))))
    )
    (ok (and (>= total (get min-payments rules)) (>= ratio-result (get threshold rules))))
  )
)

(define-public (set-oracle (new-oracle principal))
  (begin
    (asserts! (is-eq tx-sender (var-get oracle-principal)) ERR-NOT-AUTHORIZED)
    (var-set oracle-principal new-oracle)
    (ok true)
  )
)

(define-public (set-default-threshold (new-thresh uint))
  (begin
    (try! (is-oracle tx-sender))
    (try! (validate-threshold new-thresh))
    (var-set default-threshold new-thresh)
    (ok true)
  )
)

(define-public (set-default-period (new-period uint))
  (begin
    (try! (is-oracle tx-sender))
    (try! (validate-period new-period))
    (var-set default-period new-period)
    (ok true)
  )
)

(define-public (set-grace-period (new-grace uint))
  (begin
    (try! (is-oracle tx-sender))
    (var-set grace-period new-grace)
    (ok true)
  )
)

(define-public (set-lease-rules (lease-id uint) (rules {threshold: uint, period: uint, duration-extension: uint, min-payments: uint, grace-days: uint}))
  (begin
    (try! (validate-lease-id lease-id))
    (try! (validate-threshold (get threshold rules)))
    (try! (validate-period (get period rules)))
    (try! (validate-min-payments (get min-payments rules)))
    (try! (validate-grace-days (get grace-days rules)))
    (map-set lease-rules lease-id rules)
    (ok true)
  )
)

(define-public (check-and-renew (lease-id uint))
  (let*
    (
      (rules-opt (map-get? lease-rules lease-id))
      (rules (unwrap! rules-opt
        {
          threshold: (var-get default-threshold),
          period: (var-get default-period),
          duration-extension: u12,
          min-payments: u6,
          grace-days: (var-get grace-period)
        }
      ))
      (history-res (try! (get-payment-history lease-id)))
      (history (unwrap! history-res (err ERR-NO-PAYMENT-HISTORY)))
      (status-opt (map-get? renewal-status lease-id))
      (status (unwrap! status-opt {last-renewed: u0, next-eligible: u0, active: true, extensions: u0}))
      (current-block block-height)
      (meets-res (try! (meets-threshold? history rules)))
      (meets (unwrap! meets-res (err ERR-THRESHOLD-FAILED)))
    )
    (asserts! (get active status) ERR-RENEWAL-IN-PROGRESS)
    (asserts! (>= current-block (get next-eligible status)) ERR-GRACE-PERIOD-EXCEEDED)
    (asserts! meets ERR-THRESHOLD-FAILED)
    (let*
      (
        (current-term-res (try! (get-current-term lease-id)))
        (new-term (+ current-term-res (get duration-extension rules)))
        (update-result (try! (update-lease-term lease-id new-term)))
        (next-eval-id (var-get next-evaluation-id))
        (on-time-count (fold calculate-on-time-fold history u0))
        (total-count (len history))
        (ratio-res (try! (calculate-on-time-ratio history (get period rules))))
        (ratio (unwrap! ratio-res u0))
      )
      (map-set renewal-status lease-id
        {
          last-renewed: current-block,
          next-eligible: (+ current-block (get period rules)),
          active: true,
          extensions: (+ (get extensions status) u1)
        }
      )
      (map-set evaluation-history {lease-id: lease-id, eval-id: next-eval-id}
        {
          timestamp: current-block,
          met-threshold: true,
          on-time-count: on-time-count,
          total-count: total-count,
          ratio: ratio
        }
      )
      (var-set next-evaluation-id (+ next-eval-id u1))
      (print {event: "renewal-executed", lease-id: lease-id, new-term: new-term})
      (ok new-term)
    )
  )
)

(define-public (manual-evaluation (lease-id uint))
  (begin
    (try! (is-oracle tx-sender))
    (try! (validate-lease-id lease-id))
    (let*
      (
        (rules-opt (map-get? lease-rules lease-id))
        (rules (unwrap! rules-opt
          {
            threshold: (var-get default-threshold),
            period: (var-get default-period),
            duration-extension: u12,
            min-payments: u6,
            grace-days: (var-get grace-period)
          }
        ))
        (history-res (try! (get-payment-history lease-id)))
        (history (unwrap! history-res (err ERR-NO-PAYMENT-HISTORY)))
        (meets-res (try! (meets-threshold? history rules)))
        (meets (unwrap! meets-res false))
      )
      (if meets
        (begin
          (try! (check-and-renew lease-id))
          (ok true)
        )
        (begin
          (print {event: "evaluation-failed", lease-id: lease-id})
          (ok false)
        )
      )
    )
  )
)

(define-read-only (get-lease-rules (lease-id uint))
  (map-get? lease-rules lease-id)
)

(define-read-only (get-evaluation-history (lease-id uint) (eval-id uint))
  (map-get? evaluation-history {lease-id: lease-id, eval-id: eval-id})
)

(define-read-only (get-renewal-status (lease-id uint))
  (map-get? renewal-status lease-id)
)

(define-read-only (get-evaluation-count)
  (ok (var-get next-evaluation-id))
)