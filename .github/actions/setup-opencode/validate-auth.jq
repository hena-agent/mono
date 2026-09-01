.[$provider] as $auth
| ($auth | type) == "object"
  and (
    if $auth.type == "oauth" then
      (($auth.access | type) == "string" and ($auth.access | test("\\S")))
      and $auth.refresh == $sentinel
      and (($auth.expires | type) == "number" and ($auth.expires | floor) == $auth.expires)
      and $auth.expires >= $min
    elif $require_oauth then
      false
    elif $auth.type == "api" then
      (($auth.key | type) == "string" and ($auth.key | test("\\S")))
    else
      false
    end
  )
