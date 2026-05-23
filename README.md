# mtspaw 🐾

A CLI tool for spawning and managing AI agents in the OpenClaw environment.


## Setup

Prerequisites: Node.js (ES2024 compatible), pnpm

1. Install dependencies

    ```
    pnpm install
    ```

2. Build the project

    ```
    pnpm build
    ```

3. Link globally so the mtspaw command is available everywhere

    ```
    pnpm link --global
    ```

4. Verify installation

    ```
    mtspaw -V
    ```


## Setup for OpenClaw

All commands below should be run from the project root unless otherwise noted.

1. Copy .env.example to .env and update the variables

    ```
    MATTERS_API=https://your.api.url
    OPENCLAW_PATH=/path/to/your/openclaw/directory
    ```

2. Create the agent workspace via OpenClaw

    ```
    openclaw agents add
    ```

    This creates the workspace directory at OPENCLAW_PATH/workspace-{name} with template files
    (AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, etc.) and registers the agent in openclaw.json.

3. Initialize mtspaw config for the agent

    ```
    mtspaw init-agent
    ```

    Enter the same agent name used in step 2. This writes env.json into the existing workspace.

4. Move into the agent workspace

    ```
    cd /path/to/openclaw/workspace-{name}
    ```

5. Verify credentials

    ```
    mtspaw login
    ```

6. Download the latest GraphQL schema

    ```
    mtspaw sync-schema
    ```

    Select the proper branch when prompted.

7. Register and enable features the agent will use

    ```
    mtspaw feature add --feature article
    mtspaw feature add --feature comment
    mtspaw feature add --feature comment_like
    mtspaw feature add --feature comment_reply
    mtspaw feature on --feature article
    mtspaw feature on --feature comment
    mtspaw feature on --feature comment_like
    mtspaw feature on --feature comment_reply
    ```

8. Edit the workspace markdown files to configure the agent.
    SOUL.md defines the agent persona, background, and topic interests.
    AGENTS.md describes how multiple agents coordinate with each other.
    TOOLS.md documents the tools available to the agent.
    The playbooks use these files to shape the agent's behavior.


## Usage

All workspace-level commands (login, read, post, track, feature, etc.) require env.json in the current directory.
Run them from inside the agent workspace.

### Track and comment workflow

1. Start tracking an event or channel

    ```
    mtspaw track event --shortHash abc123
    mtspaw track channel --shortHash xyz789
    ```

2. View what is being tracked

    ```
    mtspaw track list
    ```

3. Query new articles from tracked sources into pending.json

    ```
    mtspaw track-query
    ```

    First run fetches 10 articles, subsequent runs fetch 20. Max 50 per query.
    Articles already commented on by the current user are skipped.

4. Read an article from the pending list

    ```
    mtspaw read article --id QXJ0aWNsZToxMjM0NQ
    mtspaw read article --shortHash wdkdskvfwp61
    ```

    Content is truncated to 5000 characters by default. Use --maxLength 0 for full content.

5. Post a comment

    ```
    mtspaw post article-comment --articleId QXJ0aWNsZToxMjM0NQ --content "Great article!"
    ```

    The command checks article state before posting. Inactive articles are skipped.
    Supports --replyTo and --parentId for threaded replies.

6. Remove the article from pending after processing

    ```
    mtspaw remove pending --articleId QXJ0aWNsZToxMjM0NQ
    ```

7. Stop tracking when done

    ```
    mtspaw untrack event --shortHash abc123
    mtspaw untrack channel --shortHash xyz789
    mtspaw untrack event all
    mtspaw untrack channel all
    ```

### Post article workflow

1. Publish a new article

    ```
    mtspaw post article --title "My Title" --content "Article body in markdown"
    ```

2. Submit an article to a campaign event

    ```
    mtspaw post article --title "My Title" --content "Article body" --eventShortHash abc123
    ```

### Reply to a comment

```
mtspaw post comment-reply --commentId Q29tbWVudDoxMjM --content "Thanks for the insight!"
```

Looks up the target comment, derives the correct article and parent ids, then posts the reply.
Skips when either the target comment or its article is not active.

### Like or unlike a comment

```
mtspaw comment like --commentId Q29tbWVudDoxMjM
mtspaw comment unlike --commentId Q29tbWVudDoxMjM
```

`comment like` checks the comment is active before upvoting. `comment unlike` removes the current
account's upvote without the active-state precheck.

### Comment-reply pipeline

```
mtspaw reply-query
mtspaw remove reply-pending --replyId <id>
```

`reply-query` walks `viewer.notices`, appends new CommentNewReply entries to `reply-pending.json`,
updates the lastNoticeId checkpoint, and drops entries with replyCreatedAt older than 2 days.
The first run only sets the checkpoint without enqueuing anything.
Pass `--dry-run` to print would-be checkpoint and new entries (with each reply / parent excerpt)
without writing the file.
`remove reply-pending` removes a single processed entry from the file.

### Feature management

```
mtspaw feature add --feature comment
mtspaw feature on --feature comment
mtspaw feature off --feature comment
mtspaw feature remove --feature comment
```

### Spam scan repeated-comment cluster

After `mtspaw spam-scan query` writes `spam-pending.json`, build high-confidence repeated comment
candidates:

```
mtspaw spam-scan cluster --minArticleSpread 3
```

This writes `spam-candidates.json` for comment patterns that appear across at least three different
articles. Use `--dry-run` to inspect the candidate summary without writing the file.

Build a dry-run Community Watch clean plan from those candidates:

```
mtspaw spam-scan plan-clean
```

This writes `spam-clean-plan.json` with planned comment IDs and the suggested reason. It does not
remove comments.

All feature commands also support interactive mode when called without --feature.

`init-agent` seeds these known feature keys: `article`, `comment`,
`comment_like`, `comment_reply`, `wallet`, `donate`, `spam_scan`. Playbooks read
these flags to decide whether the agent is permitted to perform the corresponding action.

### Threshold management

Thresholds are numeric knobs stored in env.json that tune playbook behavior.
Currently supported (both 0-100):
- comment: minimum article score required before posting a comment (default 80).
- donate: minimum article score required before donating (default 85).

```
mtspaw threshold set --name comment --value 85
mtspaw threshold list
```

Run `mtspaw threshold set` without flags for interactive selection.

### Score management

Records article scores in score.json for downstream playbooks (e.g. donation
selection) to consume.

```
mtspaw score add --articleId <id> --shortHash <hash> --score <0-100> --author <username>
mtspaw score remove --articleId <id>
mtspaw score clear
```

`add` overwrites any existing entry with the same articleId. `remove` errors if
the articleId is not present. `clear` empties the entire articles array.

### Wallet management

Each agent can have its own Ethereum wallet for on-chain actions.

```
mtspaw wallet create
mtspaw wallet create --force
mtspaw wallet bind
mtspaw wallet unbind
mtspaw wallet balance
```

`wallet create` generates a new Ethereum wallet for the agent. Pass `--force`
to overwrite an existing one.

`wallet bind` attaches the local wallet to the current Matters account.
Requires `wallet create` to have been run first.

`wallet unbind` removes the wallet currently bound to the Matters account.

`wallet balance` prints the USDT and native ETH balances of the local wallet on
the configured network.

### Donation

Send a USDT donation from the agent wallet to an article author on Optimism.
Requires `wallet create` and `wallet bind` to have been run first.

```
mtspaw donate article --shortHash <hash> [--amount <usdt>]
```

`--amount` defaults to `0.1` USDT when omitted.

### Spam patrol

Periodically scans configured feeds for spam articles and comments, accumulates a roster of offenders
in `spammers.json`, and produces plain-text output for an external telegram pipeline.

```
mtspaw spam-scan query [--dry-run]
mtspaw spam-scan record --userName <name> --displayName <name> --type article|comment --contentId <id> --shortHash <hash>
mtspaw spam-scan mark-scanned --articleId <id> --shortHash <hash> [--spam]
mtspaw spam-scan note-cw --userName <name> --uuid <uuid> --createdAt <iso>
mtspaw spam-scan list-unreported
mtspaw spam-scan mark-reported --userName <name>
mtspaw spam-scan mark-reported --all
mtspaw spam-scan report
mtspaw spam-scan cleanup
```

`query` reads `spam-scan-channels.json`, walks each feed for 10 articles plus up to 3 top-level and 3
nested comments each, and writes `spam-pending.json` for the playbook to judge. Comments that strip to
empty / short / emoji-only / pure punctuation without a URL are filtered out before reaching the LLM. Article entries already
flagged spam within the 7-day TTL are skipped; non-spam articles are re-visited with only newer comments.
Pass `--dry-run` to fetch and print a per-feed summary plus the would-be enqueue list without writing
`spam-pending.json`.

`spam-scan-channels.json` is seeded by `init-agent` with icymi, hottest, and seven curated channel
shortHashes. The operator edits this file to tune coverage.

`record` appends an occurrence under a user in `spammers.json`, rotating at 10 entries. The roster itself
caps at 100 users; when a new user pushes count over the cap, the user with the oldest `lastSeenAt` is
evicted (LRU).
`mark-scanned` upserts the article state and prunes entries older than 7 days.
`note-cw` updates `communityWatchHistory` on an existing roster entry; it is a no-op when the user is
not already in the roster.
`list-unreported` prints every roster user with `reported: false` as plain text (userName, displayName,
occurrences, and a community-watch annotation when applicable).
`mark-reported` flips `reported: true` on a single user or on every unreported entry. The external
pipeline forwards `list-unreported` output and runs `mark-reported --all` on success.

`report` is the integrated Slack flow: it builds the same plain-text body as `list-unreported`, POSTs
to `https://slack.com/api/chat.postMessage` with the bearer token, and flips `reported: true` on every
included user only when Slack returns `ok: true`. Exits 0 silently when there are no unreported entries.

`cleanup` walks every spammer in `spammers.json`, looks up `user(input: { userName }).status.state` on
the matters API with a 1-second throttle between calls, and removes entries whose state is `archived`,
`banned`, or whose user lookup returns null (hard-deleted / never existed). Active and frozen entries
are kept. The playbook runs this between clearing pending and sending the report so the Slack message
never includes already-banned spammers.

### Global options

```
mtspaw -V                 Print version
mtspaw -h                 Print help with all commands and options
mtspaw -q <command>       Suppress terminal output (still logs to action.log)
```

### Agent playbooks

The src/playbooks directory contains step-by-step instructions for agents to execute autonomously.

- post-article.md: reads the SOUL.md persona, picks a topic, generates and publishes an article.
- post-trending-article.md: token-saving variant that picks a trending topic by category and publishes an article.
- track-and-post-comment.md: reads tracked articles, scores them, generates comments, posts, and cleans up pending.
- donate-article.md: picks the highest-scored article from score.json (within last 36h, score >= thresholds.donate,
  not self, not among the last 7 donated authors), sends 0.1 USDT, then clears score.json.
- comment-reply.md: pulls fresh CommentNewReply notices via `mtspaw reply-query` into reply-pending.json,
  decides per entry whether to reply back (questions or quality > 60) or like, then removes the entry
  from the pending file. Designed to run on a periodic cron.
- spam-scan.md: walks configured feeds via `mtspaw spam-scan query`, LLM-judges each new article and
  comment against five spam categories, records hits to `spammers.json`, and marks articles scanned.
  Designed to run on a periodic cron; the final step calls `mtspaw spam-scan report` to push fresh
  unreported spammers to Slack and flip `reported: true` on successful delivery.

Agents run these playbooks from their workspace directory where env.json, track.json, and SOUL.md are available.

Each playbook declares a `Version: X.Y` line near the top. Run `mtspaw playbook list` from a workspace
to compare the source playbook versions against the workspace copies (status: `ok`, `different`,
`legacy`, `missing`, or `?`). `legacy` means the workspace copy is from before the version line was
added. Use `mtspaw renew doc --target <name>` to refresh a stale workspace copy.
