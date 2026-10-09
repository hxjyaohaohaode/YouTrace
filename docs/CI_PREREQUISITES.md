# CI recording / CJK prerequisites: bounded, shared, fail-closed

## Observed failure, not a product pass

Run `37980241786`, commit `7b9ef42f05fd66626533e575afc0eb69153af950`:

- 20 outcome jobs succeeded. `verify` failed an older Sidebar test contract; that separate candidate is not changed here.
- Diary records job `113988608749` (`Real user outcomes (diary-records, independent review required)`) reached `Get:89 ... fonts-noto-cjk ... [61.2 MB]` at `19:34:28.844 UTC`, then was cancelled at `19:46:47.159`. There was no completed fetch, prerequisite probe or native task execution. Its incomplete evidence is not a diary pass.
- Coach job `113988608722` reported 0 upgraded / 88 newly installed, including ffmpeg and fonts-noto-cjk. Its 124 MB fetch took 10m49s (191 kB/s), after which its native task passed.
- This establishes slow APT acquisition consuming the existing job budget. It does not establish a geographic/access denial or prove that all parallel jobs contended for one bottleneck.

## New structure

A single `prepare_prerequisites` job on `ubuntu-24.04` resolves and downloads the dependencies of `fonts-noto-cjk`, `ffmpeg` and `fontconfig`. It has a separate 20-minute deadline, a 17-minute download step, 60-second connection/data timeouts and zero APT retries. The original verify and 21 matrix outcome jobs retain their 20-minute deadline; native outcome execution retains 8 minutes. Consumer offline install is additionally capped at 3 minutes. All original tests and evidence upload steps remain. The original 45-second real CJK/Chrome/VP9 encode, inspect and complete-decode probe is preserved byte-for-byte; verify now also runs it before screenshots.

The downloader uses only the official Ubuntu `archive.ubuntu.com` and `security.ubuntu.com` noble / noble-updates / noble-security main+universe repositories with the runner's official Ubuntu archive keyring. APT validates signed InRelease metadata, Packages hashes and package hashes. Update errors, unsigned repositories, unauthenticated packages and download failures are fatal. No third-party APT sources or runner package preferences are consulted. A temporary `APT_CONFIG` isolates system config fragments and hooks without changing system configuration.

Resolution uses an empty isolated dpkg status, so the bundle contains the complete selected dependency closure rather than only what the preparation runner happens to lack. This is intentionally larger than the old observed 124 MB incremental fetch; its exact size is not known until Ubuntu CI runs. APT logs its calculated download size and the helper prints the actual package count and `.deb` bytes. No Ubuntu download or installation is claimed from Debian-only local tests.

One immutable official GitHub artifact carries the authenticated APT index snapshot and `.deb` cache. There is no cross-run / cross-PR cache. Its name contains run ID, run attempt and commit SHA. An independent job output carries the manifest SHA-256. Consumers validate that digest, every filename and file hash, package control name/version/architecture, exact source list, release, architecture, run, attempt, commit, workflow commit, workflow bytes and helper bytes before resolving or installing anything. Symlinks, path traversal, corrupt/missing/extra files and unexpected origins fail closed.

Producer and consumer `ImageVersion` are recorded and printed, not required to be equal: legitimate image rollouts must not fail solely on that string. APT uses the consumer's actual installed state and authenticated snapshot with `--no-download`, `--no-remove`, unauthenticated packages disabled and downgrades disabled. Only the three root packages are explicitly version-pinned; dependencies are not all forced to reinstall. Compatible higher installed dependency versions may remain. Missing cached dependencies, actual conflicts, or a root-package downgrade stop the job; there is no network fallback or `--fix-missing`. The subsequent real probe remains the capability gate, and native tests remain the product gate.

Preparation failure prevents the dependent tests from starting and leaves the workflow failed. It is never reported as test success. Package files live only under `RUNNER_TEMP`, are retained in the temporary CI artifact for one day, and are not checked into or added to the product source package.

## Local verification and external boundary

Run from the repository root:

```sh
python3 -m unittest discover -s youji-app/scripts/tests -p 'test_ci_prerequisites.py' -v
cd youji-app
npm run lint && npm run build && npm test
npm --prefix server run check
```

The Python suite covers manifest/run/workflow/architecture mismatches, corrupt/missing/extra artifacts, symlink/traversal/unapproved-source rejection, metadata mismatch, no install after validation/solver/network failures, and unchanged budgets/probes/matrix size. It also executes real `dpkg-deb` and APT **simulation** against isolated synthetic package/status fixtures for a retained higher compatible dependency, missing dependency and incompatible dependency version. Further real APT negative checks reject a root-package downgrade in download-only mode and an unsigned local file repository; neither installs a package or uses the network. These tests require no network, sudo, system package installation, fabricated `GITHUB_ACTIONS` or product browser access.

Actual Ubuntu signed download, shared artifact transport, offline installation duration and all 22 downstream jobs must still be demonstrated by CI at the final reviewed commit. Local green checks do not establish that result.

References: [APT command semantics](https://manpages.ubuntu.com/manpages/jammy/man8/apt-get.8.html), [GitHub artifact job-to-job transfer](https://docs.github.com/en/actions/tutorials/store-and-share-data).
