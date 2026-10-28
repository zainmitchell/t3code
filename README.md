# T3 Code

## Community patch previews

This temporary fork publishes two separate source patches for official T3 Code **v0.1.2**, commit `044f07257c9684ae4543bd1e1ebf9c394e9e3830`. We intend to maintain them until upstream adopts these capabilities or provides a better replacement. These are independent community proposals without upstream endorsement. The default `main` branch is an index, not the patched installation target.

> [!IMPORTANT]
> **Native messaging is superseded (2026-10-28).** Linked environments are now in official T3 Code: use [nightly v0.1.4-nightly.20261028.3824](https://github.com/pingdotgg/t3code/releases/tag/v0.1.4-nightly.20261028.3824) or any later nightly, turn on **Linked environments** in **Settings → Labs** on both machines, and link them from **Settings → Connections → Linked environments**. See the [official remote access guide](https://github.com/pingdotgg/t3code/blob/eb751fa0730d6a51d56547cb7fcaf4822a7e0e3b/docs/user/remote-access.md#link-another-environment). Do not install the messaging patch for new setups or apply it on top of an official nightly; upgrading or migrating a home that ran it has not been verified. This notice covers messaging only: the native tick and native factory previews are separate, are not upstream, and keep their own status below.

| Patch            | What it adds                                                                                                                                            | Source and setup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Review and proposal                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native messaging (**superseded**) | Superseded by linked environments in official nightly 3824 and later. Historically: recoverable keyed launches, full Stop, and selected native tools routed to linked environments within the caller's modes.                               | [Source branch](https://github.com/zainmitchell/t3code/tree/community/native-messaging-v0.1.2), [detailed brief and dependencies](https://github.com/zainmitchell/t3code/blob/community/native-messaging-v0.1.2/docs/community-patches/native-messaging/README.md), [historical build guide](https://github.com/zainmitchell/t3code/blob/community/native-messaging-v0.1.2/docs/community-patches/native-messaging/INSTALL.md), [historical preview download](https://github.com/zainmitchell/t3code/releases/tag/community-native-messaging-v0.1.2-preview.1) | [Fork review PR #1](https://github.com/zainmitchell/t3code/pull/1), [T3 Ideas discussion](https://github.com/pingdotgg/t3code/discussions/24976) |
| Native tick      | Scheduled trusted commands that can finish deterministic checks without opening an idle model turn, then request bounded T3 worker actions when needed. | [Source branch](https://github.com/zainmitchell/t3code/tree/community/native-tick-v0.1.2), [detailed brief and dependencies](https://github.com/zainmitchell/t3code/blob/community/native-tick-v0.1.2/docs/community-patches/native-tick/README.md), [installation](https://github.com/zainmitchell/t3code/blob/community/native-tick-v0.1.2/docs/community-patches/native-tick/INSTALL.md), [preview download](https://github.com/zainmitchell/t3code/releases/tag/community-native-tick-v0.1.2-preview.1)                               | [Fork review PR #2](https://github.com/zainmitchell/t3code/pull/2), [T3 Ideas discussion](https://github.com/pingdotgg/t3code/discussions/24977) |

### Messaging dependencies and history

The original feature PRs below merged upstream on 2026-10-27 and ship in official nightly 3824 and later; the support PRs closed without merging. This section is kept as history. The stable messaging patch bundles its required source changes. Do not apply these upstream PRs on top of it. For upstream integration, the original feature order is mode limits, launch recovery, peer links, then forwarding. Each support PR targets its matching feature branch; the eight PRs are not a sequential patch stack.

| Required layer in the bundled stable patch | Original proposal                                        | Current-main support proposal                            | Closed, unmerged replacement history                                                                                       |
| ------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Forwarded mode limits                      | [#16653](https://github.com/pingdotgg/t3code/pull/16653) | [#22445](https://github.com/pingdotgg/t3code/pull/22445) | [#21670](https://github.com/pingdotgg/t3code/pull/21670)                                                                   |
| Keyed launch recovery                      | [#16654](https://github.com/pingdotgg/t3code/pull/16654) | [#22446](https://github.com/pingdotgg/t3code/pull/22446) | [#21671](https://github.com/pingdotgg/t3code/pull/21671), earlier [#21459](https://github.com/pingdotgg/t3code/pull/21459) |
| Peer links, credentials, and persistence   | [#16655](https://github.com/pingdotgg/t3code/pull/16655) | [#22447](https://github.com/pingdotgg/t3code/pull/22447) | [#21672](https://github.com/pingdotgg/t3code/pull/21672)                                                                   |
| Native tool forwarding and Stop            | [#16684](https://github.com/pingdotgg/t3code/pull/16684) | [#22448](https://github.com/pingdotgg/t3code/pull/22448) | [#21673](https://github.com/pingdotgg/t3code/pull/21673)                                                                   |

The wider upstream effort also includes [link-origin ownership #16695](https://github.com/pingdotgg/t3code/pull/16695), [Connections UI #16698](https://github.com/pingdotgg/t3code/pull/16698), [remote delegation #16719](https://github.com/pingdotgg/t3code/pull/16719), [conversation import #16731](https://github.com/pingdotgg/t3code/pull/16731), [Git work transfer #16734](https://github.com/pingdotgg/t3code/pull/16734), [thread handoff #16751](https://github.com/pingdotgg/t3code/pull/16751), and [Continue-on UI #16758](https://github.com/pingdotgg/t3code/pull/16758). Those later layers are outside this reduced stable package. Use owner-trusted peer environments.

The [complete dependency and history map](https://github.com/zainmitchell/t3code/blob/community/native-messaging-v0.1.2/docs/community-patches/native-messaging/UPSTREAM.md) explains the boundaries. The [dated review-status snapshot](https://github.com/zainmitchell/t3code/blob/community/native-messaging-v0.1.2/docs/community-patches/native-messaging/REVIEW-STATUS.md) distinguishes local evidence, CI approval holds, conflicts, and actual executed checks. Follow each PR for its current status. A closed proposal or an administrative green check does not establish whether a feature works.

### Tick dependencies and verification limits

Tick is standalone on the official base. It uses T3's existing scheduler, project and thread services, contracts, process runner, and host runtime. It needs no messaging patch, factory connector, unmerged upstream PR, extra package dependency, or database migration. Its [dependency and history map](https://github.com/zainmitchell/t3code/blob/community/native-tick-v0.1.2/docs/community-patches/native-tick/UPSTREAM.md) links the actual base services and public source history.

Both previews have recorded focused checks and disposable Windows backend exercises. CodeRabbit reviews have returned findings under assessment in the fork PRs; they are not clean-review claims. Real provider actions, complete clients, physical remote routes, other operating systems, and production-state upgrades remain unverified. Tick executes trusted host code without an OS sandbox, and a command process can survive a hard server crash on POSIX. Read each brief's evidence and limitations before use. Preview release assets are immutable; branch fixes after a release are identified separately.

Report reproducible bugs in [this fork's Issues](https://github.com/zainmitchell/t3code/issues). Discuss upstream suitability in the two separate Ideas posts linked above. Implementation and integration used **Claude Opus 5.5 through T3 Code**. Source extraction, bounded fixes, verification, examples, documentation, and publication used **GPT-6.1 Sol through Codex in T3 Code**. CodeRabbit supplies automated review. Historical upstream credits remain in the dependency map. The upstream MIT notice remains included.

---

T3 Code is an "agent harness control surface". It enables control of the agents on your machine with a best-in-class mobile app ([iOS](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824), [Android](https://play.google.com/store/apps/details?id=com.t3tools.t3code)), [web app](https://app.t3.codes) and [Electron-based desktop app](https://t3.codes).

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google Antigravity. If they're set up on your computer, T3 Code can control them.

## "Wait, what are you selling me?"

Nothing. We built T3 Code because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the editor that you want.

## Installation

> [!WARNING]
> T3 Code currently supports Codex, Claude, Cursor, Grok Build, OpenCode, and Antigravity. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
> - Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.

### Command line

```bash
curl -fsSL https://t3.codes/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://t3.codes/install.ps1 | iex
```

Then run `t3` to start the server and open the local web app. `t3 service install` keeps it running in the background, `t3 update` moves to a newer release, and `t3 --help` has the full reference.

To try it once without installing, run `npx t3@latest` instead.

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### Windows (`scoop`)

```bash
scoop install extras/t3code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Debian, Ubuntu (`.deb`)

Download the `.deb` from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), then:

```bash
sudo apt install ./T3-Code-*.deb
```

#### Arch Linux (AUR)

Stable:

```bash
yay -S t3code-bin
```

Nightly:

```bash
yay -S t3code-nightly-bin
```

The AUR packaging is maintained in this repository under [`packaging/aur`](./packaging/aur).

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Appearance preferences](./docs/user/appearance.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Connect Claude Code, Codex, ChatGPT and other agents over MCP](./docs/user/outside-agents.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run T3 Code as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

T3 Code uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before reporting a bug or opening a PR.

Have a feature request? Start an [Ideas discussion](https://github.com/pingdotgg/t3code/discussions/categories/ideas).

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).

## Native software factory source preview

The experimental [nightly 3669 factory source preview](https://github.com/zainmitchell/t3code/releases/tag/community-native-factory-nightly3669-preview.1) includes complete source, a four-part ordered patch series and checksums. [Read the detailed guide](https://github.com/zainmitchell/t3code/blob/574682104ff850d2265f6b23e91c6f207bc4c206/docs/community/native-factory-preview/README.md) for setup, dependencies, trust boundaries and evidence.

Only the complete final source is installable; module patches are not separate supported installations. Full lifecycle acceptance, final-source restart/no-duplicate/idle proof, web/mobile verification and legacy-loop retirement remain open. This targets nightly 3669, separately from the stable v0.1.2 messaging/tick previews.

Share feedback in the [factory Ideas discussion](https://github.com/pingdotgg/t3code/discussions/25487). [PR dependencies and history](https://github.com/zainmitchell/t3code/blob/574682104ff850d2265f6b23e91c6f207bc4c206/docs/community/native-factory-preview/PR-LINEAGE.md) distinguish required, optional and closed work.

## Native factory nightly3717 experimental source preview

**UNQUALIFIED EXPERIMENTAL SOURCE PREVIEW. Required frozen-lockfile installation, focused Vite+ tests, formatting/lint and affected-package typechecks did not complete because the validation host's Application Control rejected the installed Vite+ native module. The repository's affected-file gate is not passed. No qualified toolchain is established. Separately, native Windows-helper tests remain unproved. No executable binary distribution is included.**

The [nightly3717 source release](https://github.com/zainmitchell/t3code/releases/tag/community-native-factory-nightly3717-preview.1) provides complete source, an ordered four-component patch series, combined alternatives and checksums. [Read the exact source guide](https://github.com/zainmitchell/t3code/blob/c3420fceee60dc8f9a06b7a4324fca552a46403b/docs/community/native-factory-preview/README.md) for mechanisms, dependencies, setup/reuse/disable, attribution and limitations. Only the complete final factory source is the installation unit; factory/command-job module-only revisions are not supported installations.

Passed evidence is limited to13 Node-only stage cases,154 syntax checks with2 unsupported mobile cases, and paused disposable CLI proof on retained dependencies. These do not replace the repository gate or prove production, lifecycle, client, platform, native-containment or upgrade acceptance. [Factory Ideas Discussion25487](https://github.com/pingdotgg/t3code/discussions/25487) retains the separate proposal. The [historical3669 preview](https://github.com/zainmitchell/t3code/releases/tag/community-native-factory-nightly3669-preview.1) and stable messaging/tick previews remain available separately.

