# pi-opencode-free-gate

**OpenCode free-tier gate patcher for the [pi coding agent](https://github.com/earendil-works/pi-coding-agent).**

Sends requests to `https://opencode.ai/zen/v1/chat/completions` with the headers and body shape the anonymous free-tier gate expects, so pi can use models like `big-pickle` without an OpenCode account.

Companion to the [OpenCode free-tier issues](https://github.com/anomalyco/opencode/issues/49433) (#49433, #49680).

## What it patches

The Zen gate (`POST /zen/v1/chat/completions`) rejects anonymous clients unless:

| Requirement | pi default | This extension |
|---|---|---|
| `User-Agent` | `OpenAI/JS …` | `opencode/1.18.23 ai-sdk/provider-utils/4.0.23 runtime/bun/1.4.0` |
| `x-opencode-session` | UUID / pi session | `ses_` + 12 hex + 14 base62 (stable per session) |
| `tools` in body | optional / incomplete | always includes a shell tool **and** `read` |
| `stream` | varies | defaults to `true` |
| `Authorization` | may be missing | `Bearer public` (anonymous) |

Also injects `x-opencode-client`, `x-opencode-project`, and a fresh `x-opencode-request` id, and strips any leftover pi session headers.

The session id is a deterministic SHA-256 mapping of the pi session id (`opencode-free:<session>` → first 6 bytes hex + 14 base62), so consecutive turns keep affinity without colliding across sessions.

## Requirements

- [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) ≥ 0.84
- Free-tier models only (`big-pickle`, `deepseek-v4-flash-free`, …) — no OpenCode account needed

## Install

### As a pi package (recommended)

```bash
pi install git:github.com/hadi77ir/pi-opencode-free-gate
```

### Manual

Copy `src/index.ts` into `~/.pi/agent/extensions/` (global) or `.pi/extensions/` (project-local), or add the path to `extensions` in `settings.json`.

### Try without installing

```bash
pi -e git:github.com/hadi77ir/pi-opencode-free-gate
```

## Configuration

Make an OpenCode free model the default in `~/.pi/agent/settings.json`:

```json
{
  "defaultProvider": "opencode",
  "defaultModel": "big-pickle"
}
```

No API key required. `auth.json` may contain `{"opencode": {"type": "api_key", "key": "public"}}` if pi prompts for credentials.

## Usage

```bash
pi -p "Say hello"
pi --model big-pickle -p "Solve this…"
pi --list-models opencode   # confirm the free-tier catalog
```

## Development

```bash
npm install
npx tsc --noEmit

# end-to-end against a temp agent dir
PI_CODING_AGENT_DIR=$(mktemp -d) \
  pi -e ./src/index.ts --provider opencode --model big-pickle -p "Say exactly: hello"
```

### How the gate was measured

Capture real OpenCode traffic with a MITM proxy and diff against pi's request. Bisected gates:

1. **403** until `User-Agent` matches `opencode/<semver>` (≥ 1.17.0)
2. **403** until `x-opencode-session` matches `ses_[0-9a-f]{12}[0-9A-Za-z]{14}`
3. **403** until body `tools` contains a shell-type tool **and** `read`
4. **401** `Model  is not supported` if `payload.model` is missing — `before_provider_request` must mutate/return `event.payload`, not the event wrapper

`Authorization` / `x-opencode-client` / `x-opencode-project` / `x-opencode-request` values are not gate-checked today; they are set for realism and forward compatibility.

## License

[MIT](./LICENSE)
