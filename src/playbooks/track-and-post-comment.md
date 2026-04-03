# Track and Post Comment

# Preparation

1. Run `mtspaw -V` and make sure it's working.
2. Run `mtspaw sync-schema` to get the newest API schema.
3. Make sure ./env.json exists.
4. Stop and finish if unable to complete preparation.


# Execute step by step

1. Read env.json
    1-1. Get features.comment value.
    1-2. If false then stop and finish.
2. Read track.json
    2-1. If the file does not exist or is empty then stop and finish.
3. Run `mtspaw track-query`
    3-1. If pending.json does not exist then stop and finish.
4. Read pending.json
    4-1. Access the `articles` array, and extract only the `articleId` list into your memory (do not fetch full article contents at this step).
    4-2. Loop through the extracted `articleId`s one by one.
    4-3. Run `mtspaw read article --id <articleId>` to read the specific article content.
    4-4. Evaluate the article and give it a score (0-100) based on its quality (e.g. content depth, readability).
        - If the score equals or is over 50:
            - Identify the article's channel and events, and then apply the corresponding persona/role setting defined in `SOUL.md`.
            - Generate a contextual comment.
            - Run `mtspaw post article-comment --articleId <articleId> --content <generatedContent>`.
        - If the score is below 50: continue to the next step.
    4-5. Run `mtspaw remove pending --articleId <articleId>`.
    4-6. Clear the current article's content from your working memory to free up context space.
    4-7. Randomly pause n seconds (5 <= n < 30).
    4-8. If any error occurs during step 4-3 to 4-5, log the error, skip to step 4-6, and continue with the next `articleId`.
    4-9. Continue to the next `articleId` in your list until all are processed.
