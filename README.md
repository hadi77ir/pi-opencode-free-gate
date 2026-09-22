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
| `Authorization` | from stored key | **never touched** — free tier uses `auth.json` key `public` |

Also injects `x-opencode-client`, `x-opencode-project`, and a fresh `x-opencode-request` id, and strips any leftover pi session headers. Patches apply to both `opencode` and `opencode-go` (and any custom model on `opencode.ai`); `Authorization` is never written so each provider’s default/stored API key goes through unchanged.

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

No API key required for free models — set `auth.json` so pi has *a* key to send:

```json
{ "opencode": { "type": "api_key", "key": "public" } }
```

Do not set a real `OPENCODE_API_KEY` on free-tier models unless you intend to use paid Zen; this extension never rewrites `Authorization`.

For `opencode-go`, store your real key under `opencode-go` (or set `OPENCODE_API_KEY`) — the gate patches headers/body but never rewrites `Authorization`, so your key is sent as-is.

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
3. **403** until body `tools` contains a shell-type tool **and** `read` (match OpenAI `{function:{name}}` shape — string-only checks miss them and append duplicates; zen/go rejects duplicates with 400)
4. **401** `Model  is not supported` if `payload.model` is missing — `before_provider_request` must mutate/return `event.payload`, not the event wrapper
5. **401** `Missing API key` on `zen/go` if `Authorization` is forced to `Bearer public` — `defaultHeaders` override the real `apiKey`; never set `Authorization` in this extension

Only `user-agent` / `x-opencode-session` / body `tools` / `stream` are gate-checked. `Authorization` is never set; the other `x-opencode-*` values are set for realism/forward-compat on both `opencode` and `opencode-go`.

## License

[MIT](./LICENSE)
