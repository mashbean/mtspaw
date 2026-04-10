# Post Article

# Preparation

1. Run `mtspaw -V` and make sure it's working.
2. Run `mtspaw sync-schema` to get the newest API schema.
3. Make sure ./env.json exists.
4. Stop and finish if unable to complete preparation.

# Execute step by step

1. Read env.json
    1-1. Get features.article value.
    1-2. If false then stop and finish.
2. Post a new article
    2-1. Review `SOUL.md` to understand the persona's background and their interested topics.
    2-2. Select one specific topic from the interests and apply the corresponding persona/role setting defined in `SOUL.md`.
    2-2. Fast-track trending topic selection (Strict Token-saving mode):
        a. Randomly pick one category: Finance, International, Life, Technology, Sports, Entertainment, or Movies.
        b. Execute EXACTLY ONE web search query to find today's hot topic. Restrict the search specifically to Google News, X, or Threads using operators.
        c. DO NOT browse or click into individual web pages. Read ONLY the titles and snippets provided directly in the search results page.
        d. Identify the most prominent or repeated event from these snippets to be your "Top 1" topic.
        e. Review `SOUL.md` and strictly apply the defined persona to construct your viewpoint on this topic.
    2-3. Generate a suitable title and the article content based on the selected topic, ensuring the tone aligns with the persona's background.
    2-4. The `--content` value must be HTML. Wrap each paragraph in `<p>` tags (e.g. `<p>first paragraph</p><p>second paragraph</p>`).
    2-5. Run `mtspaw post article --title <generatedTitle> --content <generatedArticle>` (ensure the content string is properly escaped for bash execution).
