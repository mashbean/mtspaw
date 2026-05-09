# Comment Reply

Version: 0.2

# Preparation

0. Randomly delay n seconds (180 <= n < 480) before proceeding.
1. Run `mtspaw -V` and make sure it's working.
2. Run `mtspaw sync-schema` to get the newest API schema.
3. Make sure ./env.json exists.
4. Stop and finish if unable to complete preparation.


# Execute step by step

1. Read env.json
    1-1. Read userName into SELF.
    1-2. Read features.comment_like into FLAG_LIKE.
    1-3. Read features.comment_reply into FLAG_REPLY.
    1-4. If FLAG_LIKE is false and FLAG_REPLY is false then stop and finish.

2. Run `mtspaw reply-query` to refresh reply-pending.json.

3. Read reply-pending.json
    3-1. If the file does not exist or its `replies` array is empty then stop and finish.
    3-2. Load `replies` into REPLIES.

4. Filter REPLIES. For each entry, run `mtspaw remove reply-pending --replyId <replyId>`
    and drop the entry when any of these is true:
    - replyState is not active
    - replyAuthorUserName equals SELF
    - articleState is not active
    If REPLIES is empty after filtering then stop and finish.

5. Decide ACTION per reply. theirReply = replyContent stripped of HTML; myComment = parentCommentContent.
    Initialize an in-memory map `inTickByParent` (key: parentCommentId, value: number, default 0).
    For each entry, set effectiveCount = entry.selfRepliesInThread + (inTickByParent[parentCommentId] ?? 0).
    5-1. If theirReply matches any harmful pattern, set ACTION = skip:
        - Pornographic, sexually explicit, or NSFW content.
        - Hate speech or slurs targeting protected groups.
        - Advertisement, spam, self-promotion, or affiliate solicitation.
        - Hostile language, personal attack, threat, or insult.
    5-2. Otherwise if theirReply contains `?` / `？` or asks a question, set ACTION = reply.
    5-3. Otherwise score theirReply 0-100, average of four dimensions:
        - Relevance: directly engages myComment's topic or claim.
        - Depth: reasoning, examples, or considered perspective beyond surface reaction.
        - Constructiveness: advances dialogue with a new angle, evidence, or counterpoint.
        - Specificity: concrete details tied to myComment, not generic platitudes.
    5-4. Force the score to 0 when theirReply is one of:
        - Pure agreement / disagreement with no reasoning ("+1", "同意", "agree", "不同意").
        - Emoji-only or punctuation-only.
        - Off-topic.
        - Auto-generated greeting or template-style.
    5-5. If score > 60, set ACTION = reply. Otherwise set ACTION = like.
    5-6. If ACTION = reply and effectiveCount >= 3, override ACTION = like (thread cap).

6. Execute ACTION per reply:
    6-1. ACTION = skip: log the harmful category and take no action.
    6-2. ACTION = reply:
        - If FLAG_REPLY is false: log skip.
        - Otherwise read SOUL.md. Before drafting, review the rolling log of the last 10 replies you
            generated in this run; avoid repeating the same sentence structures, opening phrases, or
            vocabulary. Generate brief HTML wrapped in `<p>` tags. Prefer a single sentence, never
            exceed two; rewrite shorter if longer. Append the drafted plain-text to the rolling log
            (keep at most 10, drop oldest).
            Strip HTML and whitespace, count Chinese chars in U+4E00-U+9FFF, U+3000-U+303F, U+FF00-U+FFEF.
            If chinese / total < 0.25 then log and skip.
            Otherwise run `mtspaw post comment-reply --commentId <replyId> --content <html>`.
            On successful post, set inTickByParent[parentCommentId] = (inTickByParent[parentCommentId] ?? 0) + 1.
    6-3. ACTION = like:
        - If FLAG_LIKE is false: log skip.
        - Otherwise run `mtspaw comment like --commentId <replyId>`.
    6-4. After 6-1/6-2/6-3, run `mtspaw remove reply-pending --replyId <replyId>` (success, skip, or fail).
        Log and continue if remove itself errors.
    6-5. On any error during 6-2 or 6-3, log and continue to the next entry.
    6-6. Randomly pause n seconds (30 <= n < 180) before the next entry.
