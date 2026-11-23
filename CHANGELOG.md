# Changelog

## Unreleased

- iOS: ZIPFoundation 0.9.21 (it was 0.9.20)
## v0.1.1

- Renamed: npm `capacitor-code-push-client` (was `capacitor-plugin-code-push`), Swift package and product
  `CapacitorCodePushClient`, the name `npx cap sync` asks for. Imports change; `CodePush` and `plugins.CodePush` do not
- iOS: ZIPFoundation is pinned to exactly 0.9.20 (it was `from: "0.9.19"`); a weekly workflow proposes the next release
- CI: one workflow, `ci.yaml`, with a single required `ci` job; the platform tests run only when a pull request reaches
  them, and a push to `main` publishes
- Fix: a status report was sent twice when the app called `notifyApplicationReady()` and `sync()` together
- CI: the Swift core's XCTests run on the macOS host with `swift test`, not on a simulator, which took most of that job's time

## v0.1.0

- First version: `sync`, `checkForUpdate`, `download`, `install`, `getCurrentPackage`, `getPendingPackage`,
  `notifyApplicationReady` and `restartApplication` for Capacitor 8 on Android and iOS, speaking the CodePush protocol
  to a CodePush-compatible server such as Revopush
- Install modes `IMMEDIATE`, `ON_NEXT_RESTART` and `ON_NEXT_RESUME`; mandatory updates; rollback at the next cold start
  of a package that never called `notifyApplicationReady`, reported to the server
- Diff updates, checked against the package hash the Revopush CLI computes; full updates installed as delivered
- `onUpdateAvailable` is a required `sync` option: the plugin shows no dialog of its own
- Moving from cordova-plugin-code-push: the same client id and the last reported version carried over
- Tests: TypeScript (Vitest), Kotlin on the JVM, XCTest on an iOS simulator, and an end-to-end run of the demo app on
  an iOS simulator and an Android emulator against a local CodePush server
