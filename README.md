# mtspaw

A CLI tool for spawning and managing AI agents in the OpenClaw environment.


## Setup

Prerequisites: Node.js (ES2024 compatible), pnpm

1. Install dependencies

    pnpm install --frozen-lockfile

2. Build the project

    pnpm build

3. Link globally so the mtspaw command is available everywhere

    pnpm link --global

4. Verify installation

    mtspaw -V


## Setup for OpenClaw

All commands below should be run from the project root unless otherwise noted.

0. Copy .env.example to .env and update the variables

    MATTERS_API=https://your.api.url
    OPENCLAW_PATH=/path/to/your/openclaw/directory

1. Create the agent workspace via OpenClaw

    openclaw agent add

    This creates the workspace directory at OPENCLAW_PATH/workspace-{name} with template files
    (AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, etc.) and registers the agent in openclaw.json.

2. Initialize mtspaw config for the agent

    mtspaw init-agent

    Enter the same agent name used in step 1. This writes env.json into the existing workspace.

3. Move into the agent workspace

    cd /path/to/openclaw/workspace-{name}

4. Verify credentials

    mtspaw login

5. Download the latest GraphQL schema

    mtspaw sync-schema

    Select the proper branch when prompted.

6. Register and enable features the agent will use

    mtspaw feature add --feature article
    mtspaw feature add --feature comment
    mtspaw feature on --feature article
    mtspaw feature on --feature comment

7. Edit the workspace markdown files to configure the agent.
    SOUL.md defines the agent persona, background, and topic interests.
    AGENTS.md describes how multiple agents coordinate with each other.
    TOOLS.md documents the tools available to the agent.
    The playbooks use these files to shape the agent's behavior.


## Usage

All workspace-level commands (login, read, post, track, feature, etc.) require env.json in the current directory.
Run them from inside the agent workspace.

### Track and comment workflow

1. Start tracking an event or channel

    mtspaw track event --shortHash abc123
    mtspaw track channel --shortHash xyz789

2. View what is being tracked

    mtspaw track list

3. Query new articles from tracked sources into pending.json

    mtspaw track-query

    First run fetches 10 articles, subsequent runs fetch 20. Max 50 per query.
    Articles already commented on by the current user are skipped.

4. Read an article from the pending list

    mtspaw read article --id QXJ0aWNsZToxMjM0NQ
    mtspaw read article --shortHash wdkdskvfwp61

    Content is truncated to 5000 characters by default. Use --maxLength 0 for full content.

5. Post a comment

    mtspaw post article-comment --articleId QXJ0aWNsZToxMjM0NQ --content "Great article!"

    The command checks article state before posting. Inactive articles are skipped.
    Supports --replyTo and --parentId for threaded replies.

6. Remove the article from pending after processing

    mtspaw remove pending --articleId QXJ0aWNsZToxMjM0NQ

7. Stop tracking when done

    mtspaw untrack event --shortHash abc123
    mtspaw untrack channel --shortHash xyz789
    mtspaw untrack event all
    mtspaw untrack channel all

### Post article workflow

1. Publish a new article

    mtspaw post article --title "My Title" --content "Article body in markdown"

2. Submit an article to a campaign event

    mtspaw post article --title "My Title" --content "Article body" --eventShortHash abc123

### Feature management

    mtspaw feature add --feature comment
    mtspaw feature on --feature comment
    mtspaw feature off --feature comment
    mtspaw feature remove --feature comment

All feature commands also support interactive mode when called without --feature.

### Global options

    mtspaw -V                 Print version
    mtspaw -h                 Print help with all commands and options
    mtspaw -q <command>       Suppress terminal output (still logs to action.log)

### Agent playbooks

The src/playbooks directory contains step-by-step instructions for agents to execute autonomously.

- post-article.md: reads the SOUL.md persona, picks a topic, generates and publishes an article.
- track-and-post-comment.md: reads tracked articles, scores them, generates comments, posts, and cleans up pending.

Agents run these playbooks from their workspace directory where env.json, track.json, and SOUL.md are available.
