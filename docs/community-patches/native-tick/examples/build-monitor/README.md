# Record a changed build result without a model turn

This additional source example monitors a local `build-result.json` file. When a revision changes to `passed` or `failed`, it appends a notification to `build-notifications.jsonl`. Repeating the same revision and status does not append another notification during normal runs.

Use `watch-build.mjs` as a trusted host-configured command job. Set the actual Node executable and the script's absolute path in `command-jobs.json`. Set `cwd` to a writable example directory containing the build result. Bind the configured project and task IDs as described by the standalone tick guide. Keep this trial in disposable state.

Copy build-result.example.json to the writable example directory as build-result.json. Use command-jobs.example.json as a template and replace its paths and IDs.

An example build result is `{"revision":"example-revision-1","status":"pending"}`. Change the status to `passed` to record one notification. The script reads T3's snapshot and returns `{"requests":[]}` on every pass. It creates no worker and sends no message. A separate build system would have to produce the input file.

The standalone Windows runtime exercise invoked this example through T3's scheduler for pending, passed, and repeated passed results. Notification counts were 0, 1, and 1. All three runs succeeded with zero T3 threads or provider-session projections. This proves the local file-monitor behavior, not an external CI integration or an accepted worker-directed action.

The host program is trusted code, not sandboxed by T3 action limits. A crash between appending the notification and writing its state can repeat a notification. No exactly-once external-side-effect guarantee is made. The original prepared tick archive is preserved. This preview distribution includes the original idle sample and this additional example.

The complete MIT notice is in LICENSE. The source preview is available from the [Release](https://github.com/zainmitchell/t3code/releases/tag/community-native-tick-v0.1.2-preview.1).

The final distributed script has formatting and namespace-import cleanup. Its exact digest and direct replay are recorded in [DIRECT-EXAMPLE-VERIFICATION.json](../../DIRECT-EXAMPLE-VERIFICATION.json). The earlier scheduler proof retains the original script digest.
