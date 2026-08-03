# TOML-aware region splitter/stripper for install-codex.sh.
#
# Required variables:
#   action=strip: start_marker, end_marker
#   action=extract: start_marker, end_marker; require_region=1 rejects zero regions
#   action=split: root_file, sections_file
#   action=root-symbols: no extra variables; prints root keys and table headers
#
# It tracks multiline strings plus array/inline-table depth. A marker-looking
# line inside operator text is data, not installer ownership; a table-looking
# line inside a multiline string or nested array is not the first TOML table.

function escaped_before(text, position, count, cursor) {
  count = 0
  for (cursor = position - 1; cursor > 0 && substr(text, cursor, 1) == bs; cursor--) count++
  return count % 2
}

function scan_root(text, length_, i, c, triple) {
  length_ = length(text)
  for (i = 1; i <= length_;) {
    triple = substr(text, i, 3)
    if (string_mode == "multiline-basic") {
      if (triple == dq dq dq && !escaped_before(text, i)) { string_mode = ""; i += 3 }
      else i++
      continue
    }
    if (string_mode == "multiline-literal") {
      if (triple == sq sq sq) { string_mode = ""; i += 3 }
      else i++
      continue
    }
    c = substr(text, i, 1)
    if (c == "#") return
    if (triple == dq dq dq) { string_mode = "multiline-basic"; i += 3; continue }
    if (triple == sq sq sq) { string_mode = "multiline-literal"; i += 3; continue }
    if (c == dq) {
      for (i++; i <= length_; i++) {
        c = substr(text, i, 1)
        if (c == bs) { i++; continue }
        if (c == dq) { i++; break }
      }
      continue
    }
    if (c == sq) {
      for (i++; i <= length_ && substr(text, i, 1) != sq; i++);
      i++
      continue
    }
    if (c == "[") array_depth++
    else if (c == "]" && array_depth > 0) array_depth--
    else if (c == "{") brace_depth++
    else if (c == "}" && brace_depth > 0) brace_depth--
    i++
  }
}

BEGIN {
  dq = "\""
  sq = sprintf("%c", 39)
  bs = "\\"
  if (action != "strip" && action != "extract" && action != "split" && action != "root-symbols") exit 64
}

{
  at_root = string_mode == "" && array_depth == 0 && brace_depth == 0

  if (action == "strip" || action == "extract") {
    if (at_root && $0 == start_marker) {
      if (inside) malformed = 1
      inside = 1
      seen_start++
      next
    }
    if (at_root && $0 == end_marker) {
      if (!inside) malformed = 1
      inside = 0
      seen_end++
      next
    }
    if (action == "strip" && !inside) print
    if (action == "extract" && inside) print
    scan_root($0)
    next
  }

  if (action == "root-symbols") {
    if (at_root && $0 ~ /^[[:space:]]*\[/) {
      print
      table_context = 1
      next
    }
    if (at_root && !table_context) print
    scan_root($0)
    next
  }

  if (!section && at_root && $0 ~ /^[[:space:]]*\[/) section = 1
  if (section) print > sections_file
  else {
    print > root_file
    scan_root($0)
  }
}

END {
  if ((action == "strip" || action == "extract") &&
      (malformed || inside || seen_start != seen_end || seen_start > 1 ||
       (require_region && seen_start != 1))) exit 5
}
