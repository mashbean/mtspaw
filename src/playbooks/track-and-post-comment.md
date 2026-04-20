# Track and Post Comment

# Preparation

0. Randomly delay n seconds (90 <= n < 300) before proceeding.
1. Run `mtspaw -V` and make sure it's working.
2. Run `mtspaw sync-schema` to get the newest API schema.
3. Make sure ./env.json exists.
4. Stop and finish if unable to complete preparation.


# Execute step by step

1. Read env.json
    1-1. Get features.comment value.
    1-2. If false then stop and finish.
    1-3. Get thresholds.comment into THRESHOLD. If missing, use 80.
2. Read track.json
    2-1. If the file does not exist or is empty then stop and finish.
3. Run `mtspaw track-query`
    3-1. If pending.json does not exist then stop and finish.
4. Read pending.json
    4-1. Access the `articles` array, and extract only the `articleId` list into your memory (do not fetch full article contents at this step).
    4-2. Loop through the extracted `articleId`s one by one.
    4-3. Run `mtspaw read article --id <articleId>` to read the specific article content.
    4-4. Evaluate the article and give it a score (0-100) based on its quality (e.g. content depth, readability).
        - If the score >= THRESHOLD:
            - Identify the article's channel and events, and then apply the corresponding persona/role setting defined in `SOUL.md`.
            - Generate a contextual comment. The `--content` value must be HTML. Wrap each paragraph in `<p>` tags.
            - Before posting, compute the Chinese character ratio of the generated comment:
                - Strip HTML tags and whitespace from the content to get the plain text.
                - Count characters in these Unicode ranges as Chinese: U+4E00-U+9FFF (漢字), U+3000-U+303F (中文標點), U+FF00-U+FFEF (全形符號).
                - ratio = chinese_count / total_character_count (after stripping HTML and whitespace).
            - If ratio < 0.25: skip posting this comment. Log the reason and continue to step 4-5.
            - Otherwise: Run `mtspaw post article-comment --articleId <articleId> --content <generatedContent>`.
        - If the score < THRESHOLD: continue to the next step.
    4-5. Run `mtspaw remove pending --articleId <articleId>`.
    4-6. Clear the current article's content from your working memory to free up context space, but keep a rolling log of your last 5 generated comments in your short-term memory. Before generating the next comment in step 4-4, review this log to actively avoid repeating the same sentence structures, vocabulary, or opening phrases.
    4-7. Randomly pause n seconds (30 <= n < 180).
    4-8. If any error occurs during step 4-3 to 4-5, log the error, skip to step 4-6, and continue with the next `articleId`.
    4-9. Continue to the next `articleId` in your list until all are processed.
