def nonblank($message):
  if type == "string" and test("\\S") then . else error($message) end;

def final_text:
  [.[] | select(.type == "text") | .part.text]
  | last
  | nonblank("OpenCode command returned no final text");

# Mirrors SessionRetry.retryable in the pinned OpenCode release.
def retryable_message:
  . as $message
  | type == "string"
    and any(
      [
        "429|500|502|503|504|524",
        "rate increased too quickly|rate limit|rate-limit|rate_limit|too many requests",
        "overloaded|service unavailable|service_unavailable|service-unavailable|internal error|internal_error|internal server error|server error|server_error|server-error|provider returned error|provider_returned_error|provider-returned-error",
        "terminated|fetch failed|failed to fetch|network[-_\\s]error|upstream connect|connection error|connection refused|connection lost|socket connection was closed|socket hang up|reset before headers|getaddrinfo|enotfound|eai_again|econnrefused|econnreset|etimedout",
        "^timeout$|\\b(?:request|response|connection|network|stream|read) (?:timeout|timed out|time out)\\b",
        "try your request again|retry your request|resource exhausted|resource_exhausted",
        "\\btry again (?:later|in\\b)|\\b(?:currently|temporarily) at capacity\\b"
      ][];
      . as $pattern | $message | test($pattern; "i")
    );

def retryable_error:
  .error.name != "ContextOverflowError"
  and (
    .error.data.isRetryable == true
    or (.error.data.statusCode as $status | ($status | type) == "number" and $status >= 500)
    or (.error.data.message | retryable_message)
    or (.error.data.responseBody | retryable_message)
  );

def completed_task:
  [
    .[]
    | select(
        .type == "tool_use"
        and .part.tool == "task"
        and .part.state.status == "completed"
        and .part.state.input.command == $command
      )
    | .part.state.output
    | select(
        type == "string"
        and test("^<task[^>]*>\\n<task_result>\\n[\\s\\S]*\\n</task_result>\\n</task>$")
      )
    | sub("^<task[^>]*>\\n<task_result>\\n"; "")
    | sub("\\n</task_result>\\n</task>$"; "")
  ]
  | last
  | nonblank("OpenCode command returned no completed task");

def completed_review:
  if ([.[] | select(.type == "error")] | last | retryable_error) != true then
    error("OpenCode command did not end with a retryable provider error")
  else completed_task
  end;

if $operation == "final-text" then
  final_text
elif $operation == "completed-task" then
  completed_task
elif $operation == "completed-review" then
  completed_review
else
  error("unsupported review extraction operation: " + $operation)
end
