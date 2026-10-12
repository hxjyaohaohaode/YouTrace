# Bounded startup navigation diagnostic

Status: the first native diagnostic ran at `27727c914ca869e60f290ed11a782eb8ac6440cf`; three controls did not reproduce the symptom and one was blocked during preparation. The single blocked-control supplement below is prepared but has not run. The product remains Partial because the general browser run on `fcec29d6437fe556150ef657097cb61eb717d564` failed. This diagnostic changes no production source, schema, dependency, initialization deadline, authentication or retry behavior.

## Actual starting evidence

[CI 38314524613](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/38314524613): 27 jobs succeeded, general `verify` failed. The 25 separate outcome summaries succeeded; only explicitly reviewed raw chains have human evidence review. Keyboard's 10 chains and pointer recovery's 18-chain summary do not turn the failed general regression green.

The general raw ZIP is 5,648,868 bytes, SHA-256 `0dcb3ffcbb96d56fa3b82ceef9095d794149460c06831e180c869570ec025c6d`. After original A/B/A UI transitions, existing A Home became layout-ready, then original full `/todo` navigation showed “加载遇到问题 / 重试”. New-document authentication/settings/sync GETs had returned 200; the first native `settings.get` in an all-table readwrite sync transaction had no observed terminal, followed by the unchanged approximately 12-second initialization timeout. Prior-document readonly calls also lacked observed tails. The recording has dropped-event counters and no reliable old-document pagehide tail. These observations do not prove a surviving lock, bfcache cause, data loss, or observer causation.

## One declared run, four independent synthetic profiles

The independent `startup_navigation_diagnostic` job runs only on a push whose commit message includes `[startup diagnostic]`; publishing also requires `[skip render]`. It uses the existing Ubuntu 24.04 hosted runner, Node 24, official Chrome and this run's authenticated/offline font/recording prerequisite bundle. The formal 25-task outcome matrix and its labels are unchanged.

Each arm has a fresh browser context, its own synthetic phone/owner and the same 1280×900 viewport with reduced motion. Original OTP, nickname, onboarding, Todo creation, save and logout controls create one no-date Todo and obtain a real server ACK. The complete pre-navigation account snapshot, version receipt and server ledger are checked. Eight total code sends (two per phone) remain within actual 5/phone and 20/IP per 10 minutes limits. No limiter bypass, credential injection, artificial transaction, monkeypatched fetch response, application-store invocation or source clearing is used.

1. Existing A login → original full `/todo` navigation; original storage observer enabled.
2. Same path; no storage observer/IDB wrappers.
3. Existing A login → original native sidebar Todo control (SPA); original storage observer enabled.
4. Same SPA path; no storage observer/IDB wrappers.

Both controls retain the same low-volume application/lifecycle listener, native recording and network metadata capture. The exact old stable-Home geometry condition is followed immediately by the declared navigation; no added sleep, data-settled snapshot or network-idle gate is inserted between these two steps. Full navigation preserves the original `goto(networkidle0)` behavior. Normal setup ACK polling precedes logout, outside this measurement boundary. B is intentionally absent in this first minimal A/logout/A comparison; it is not the entire historical general script.

## Evidence and fail-closed interpretation

Application and lifecycle scalars carry their **source** `performance.timeOrigin`. Storage transaction IDs are scoped by that origin and numeric database ID. A 20,000-event ring retains explicit dropped counts; a separate bounded scalar transaction ledger retains observed starts, last request and complete/abort. Errors are not counted as transaction termination. It retains no native DB/request/transaction object. The original storage observer is unchanged and adds no requests or awaited keepalive. Its event transport and recording still have timing overhead; enabled-only failure does not prove the observer caused it.

The measurement latch is armed immediately before existing-A login and excludes already known old-document timeOrigins. Its first new-document initialization timeout/error is frozen immediately, even if later recovery reads the Todo. Every subsequent native control boundary rejects after that latch; the losing async branch cannot navigate or click after the failure race. First failure freezes metadata before screenshot/body capture, with distinct filenames so visible-state capture cannot overwrite the original ledger. No retry, reload, extra all-store read or second measured navigation follows a failure. The arm then ends; the next fresh context is a separate once-only control. Screenshots, actual synthetic UI text, trace, WebM, readonly snapshots and network endpoint/status/terminal metadata are preserved. No OTP, Cookie, JWT or request/response body is recorded by the metadata observer. Account snapshots contain only the deliberately created synthetic data.

Each case is one of:
- `observed-failure`: measured initialization emits its real timeout/error (including a later recovered timeout), visibly reaches the existing error UI, or an exact post-navigation data invariant fails.
- `not-reproduced`: original Todo is visible and the same account database/schema, complete Todo/outbox, Todo version/conflict receipts and complete remote ledger match. Other settings can legitimately change; their full snapshots are retained without an all-settings-unchanged claim.
- `infra-blocked`: preparation, driver, capability, deadline, unreadable evidence, incomplete or unstarted arm. It is not a product pass.

An incremental `report.json` exists before browser execution, keeps unstarted cases blocked, records exact source commit/tree and checked unchanged production baseline, and marks `complete` only after all four cases finish. The job is bounded to 15 minutes and its native step to 8 minutes, leaving upload time; command/navigation waits have finite deadlines. Hard runner termination can leave incomplete evidence, which must remain blocked. Any observed failure or caught block makes the native command nonzero. A successful command means only this finite diagnostic did not reproduce the symptom, not repair or production acceptance. Missing transaction/lifecycle tails cannot establish active locks or their absence.

## Reproducible pre-publication checks

From repository root:

```sh
python3 -m unittest discover -s youji-app/scripts/tests -p 'test_ci_prerequisites.py' -v
cd youji-app
node --import tsx --test tests/startup-navigation-diagnostic.test.ts
npm run lint && npm run build && npm test
npm --prefix server run check
node scripts/verify-brand-integrity.mjs
```

The local contracts execute the actual injected listener in a VM with never-settling transport, late source-document delivery, scalar projection, ring/transaction boundaries, and real readonly synthetic fake-indexeddb snapshots with negative data corruptions. They do not execute Chrome. The native script refuses outside actual hosted CI before starting any service/browser; do not manufacture `GITHUB_ACTIONS` locally to bypass a denied capability.

The supplement hosted command is `node scripts/diagnose-startup-navigation.mjs` with `AUDIT_BROWSER_PATH=/usr/bin/google-chrome` and `AUDIT_STARTUP_DIAGNOSTIC_CASE=full-unobserved`, after original frontend/backend builds and prerequisite verification. Logs/artifacts must be read at the precise new SHA. No repeat-until-green, app repair or extra B-account experiment is implied by a no-reproduction result.

## 27727c9 first native diagnostic and one-control supplement

[Run 38318171708](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/38318171708), job `115039820123`, uploaded original artifact `11776838622`: 239,934,250-byte ZIP, SHA-256 `7c5ff15a651bcc38f7eddd967050f1660aee8ad80f9d59875a70a470a15cf782`. All 29 original members are preserved. The diagnostic command failed honestly: `full-observed`, `spa-observed` and `spa-unobserved` reached the declared data checks without reproducing; `full-unobserved` stopped with preparation `AssertionError`. It had saved the original Todo/ACK snapshot, clicked Settings, and never issued the logout click or entered the final A login. These three outcomes remain tied to that run; they are not rerun by the supplement and do not demonstrate a fix. The fcec general failure remains open.

The original failed PNG/DOM show readable Settings at the top, active element H1, no loading error. The trace records document ScrollLayer at timestamps 91,936,599, 91,944,420 and 91,948,133 microseconds, followed by heading-focus dispatch at 91,948,350. Its original production stack points to StaticPageEntry's heading focus (bundle line 18, column 38723); the source calls scrollTo(top=0) immediately before that focus. This most closely fits a preparation race between the harness's scrollIntoView and original route-entry placement. The original harness did not save the rejected button's rectangle/hit element, so the precise rejected geometry is not retrospectively invented. No fixed-overlay defect or general initialization root cause is established.

The minimal supplement observes the original Settings route's own visible H1, natural activeElement and scrollY=0 before trying the existing logout control. It has a 3-second bounded RAF observation, never calls focus/scroll/sleep, and is used only during preparation, before logout. Original target stability and elementFromPoint checks still gate the real click; the same pre-click read now saves the target rectangle, hit/active tags and scroll position, including on rejection. The final existing-A login → immediate full `/todo` measurement and failure latch are unchanged.

The runtime now requires the exact whitelist value `full-unobserved`; missing, empty, unknown or completed-arm selections are rejected before launching services. Its original synthetic identity index is retained. The report contains only that one new case and an explicit 27727c9/run/artifact reference with `otherArmsRerun=false`. The first-run four-arm list remains the historical contract. The supplement sends only two OTP requests, with the unchanged real limiter. The formal 25 outcome matrix remains separate.

All four original WebM streams fully decoded without errors (113/55/84/85 frames in full-observed/full-unobserved/spa-observed/spa-unobserved order); selected frames and PNGs were inspected. This is not a claim that every video frame or every formal matrix artifact has had human review. Full CI status is tracked independently and is not replaced by the diagnostic's three no-reproduction results.
