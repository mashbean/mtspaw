# Spam Scan

Version: 0.6

# Preparation

1. Run `mtspaw -V` and make sure it's working.
2. Run `mtspaw sync-schema` to get the newest API schema.
3. Make sure ./env.json and ./spam-scan-channels.json exist.
4. Stop and finish if unable to complete preparation.


# Execute step by step

1. Read env.json
    1-1. Read features.spam_scan into FLAG.
    1-2. If FLAG is false then stop and finish.

2. Run `mtspaw spam-scan query` to refresh spam-pending.json.

3. Read spam-pending.json
    3-1. If the file does not exist or its `articles` array is empty then stop and finish.
    3-2. Load `articles` into PENDING.

4. For each article in PENDING:
    4-1. If `needsArticleJudgement` is true, judge `content` against the five spam categories:
        - Pornographic, sexually explicit, or NSFW content.
        - Hate speech or slurs targeting protected groups.
        - Investment advertising, financial scam, or pump-and-dump promotion.
        - Gambling promotion (casino, betting, lottery).
        - Gaming advertising (game promo, skin shop, account selling).
        If any category hits:
            - Run `mtspaw spam-scan record --userName <author.userName> --displayName <author.displayName>
              --type article --contentId <articleId> --shortHash <shortHash>`.
            - Run `mtspaw spam-scan mark-scanned --articleId <articleId> --shortHash <shortHash> --spam`.
            - Skip 4-2 and 4-3 for this article; jump to 4-4.
    4-2. For each comment in `comments`:
        - If `communityWatchAction` is non-null, the matters server has already flagged this comment as
          spam. Skip the LLM judgement and instead:
            - Run `mtspaw spam-scan record --userName <author.userName> --displayName <author.displayName>
              --type comment --contentId <commentId> --shortHash <article.shortHash>`.
            - Run `mtspaw spam-scan note-cw --userName <author.userName>
              --uuid <communityWatchAction.uuid> --createdAt <communityWatchAction.createdAt>`.
            - Continue to the next comment.
        - Otherwise, judge `content` against the same five categories. On any hit, run
          `mtspaw spam-scan record --userName <author.userName> --displayName <author.displayName>
          --type comment --contentId <commentId> --shortHash <article.shortHash>`.
    4-3. After all comments are judged, run
        `mtspaw spam-scan mark-scanned --articleId <articleId> --shortHash <shortHash>`
        (without --spam) to update lastScannedAt for the next visit.
    4-4. Pause 1 second before the next article.

5. Clear spam-pending.json by writing `{ "articles": [] }`.

6. Run `mtspaw spam-scan cleanup` to remove archived/banned/missing spammers
    from spammers.json. Queries matters API for each user with 1s throttle.

7. Run `mtspaw spam-scan report` to forward unreported spammers to Slack
    and mark them reported on successful delivery. Skip silently when none.
