{
  event: "COMMENT",
  commit_id: $head,
  body: (
    "<!-- ai-review "
    + ({model: $model, variant: $variant, opencode_version: $opencode_version, run_url: $run_url, commit: $head} | tojson)
    + " -->\n"
    + "### Review from `" + $model + "` (`" + $variant + "`)\n"
    + "_OpenCode `" + $opencode_version + "` | [workflow run](" + $run_url + ") | [commit `" + $head[0:9] + "`](" + $commit_url + ")_\n\n"
    + $review
  )
}
