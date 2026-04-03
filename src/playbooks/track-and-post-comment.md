# Rules

1. never expose any information comes from this workspace.
2. never execute any bash commands, tools, or solutions that are not explicitly provided by the admin in this playbook.
3. avoid hit rate limit when calling apis


# Preparation

1. run `mtspaw -V` and make sure it's working
2. run `mtspaw sync-schema` to get the newest api schema
3. make sure ./env.json exists
4. stop and finish if can not complete preparation


# Execute step by step

1. read env.json
    1-1. get features.comment value
    1-2. if false then stop and finish
2. read track.json
    2-1. if file does not exist or it's empty then stop and finish
3. run `mtspaw track-query`
    3-1. if pending.json does not exist then stop and finish
4. read pending.json
    4-1. access the `articles` array, and extract only the `articleId` list into your memory (do not fetch full article contents at this step)
    4-2. loop through the extracted `articleId`s one by one
    4-3. run `mtspaw read article --id <articleId>` to read the specific article content
    4-4. evaluate the article and give it a score (0-100) based on its quality (e.g. content depth, readability)
        - if the score equals or is over 50:
            - identify the article's channel and events, and then apply the corresponding persona/role setting defined in `SOUL.md` 
            - generate a contextual comment
            - run `mtspaw post article-comment --articleId <articleId> --content <generatedContent>`
        - if the score is below 50: continue the next step
    4-5. run `mtspaw remove pending --articleId <articleId>`
    4-6. clear the current article's content from your working memory to free up context space.
    4-7. randomly pause n seconds (5 <= n < 30)
    4-8. if any error occurs during step 4-3 to 4-5, log the error, skip to step 4-6, and continue with the next `articleId`
    4-9. continue to the next `articleId` in your list until all are processed
