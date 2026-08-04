# TOML-aware region splitter/stripper for install-codex.sh.
#
# Required variables:
#   action=strip: start_marker, end_marker
#   action=extract: start_marker, end_marker; require_region=1 rejects zero regions
#   action=split: root_file, sections_file
#   action=root-symbols: no extra variables; prints root keys and table headers
#   action=features-strip: feature_start_marker, feature_end_marker; validates
#     that a single mergeable [features] table owns the optional region, removes
#     the region, and rejects oso-owned keys outside it
#   action=features-merge: feature_file; inserts that file immediately after an
#     existing [features] header, or creates the table at EOF
#   action=engram-pointers: start_marker, end_marker, model_key, compact_key,
#     model_value, compact_value; moves Engram's exact pointers immediately
#     before the managed region. require_region=1 rejects an absent region.
#   action=remove-table: target_header; removes zero or one exact table and its
#     body while preserving every other byte. Duplicate target tables fail.
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

function compact_header(text, value) {
  value = text
  sub(/[[:space:]]*#.*/, "", value)
  gsub(/[[:space:]]/, "", value)
  return value
}

function is_features_header(text) {
  return compact_header(text) == "[features]"
}

function is_features_shape(text, value) {
  value = compact_header(text)
  return value ~ /^\[\[?features(\]|[.]|$)/ ||
         value ~ /^\[\[?"features"(\]|[.]|$)/ ||
         value ~ /^\[\[?\047features\047(\]|[.]|$)/
}

function is_owned_feature_key(text, value) {
  value = text
  sub(/[[:space:]]*#.*/, "", value)
  return value ~ /^[[:space:]]*(hooks|multi_agent)[[:space:]]*([.=])/ ||
         value ~ /^[[:space:]]*"(hooks|multi_agent)"[[:space:]]*([.=])/ ||
         value ~ /^[[:space:]]*\047(hooks|multi_agent)\047[[:space:]]*([.=])/
}

function is_root_features_key(text, value) {
  value = text
  sub(/[[:space:]]*#.*/, "", value)
  return value ~ /^[[:space:]]*features[[:space:]]*([.=])/ ||
         value ~ /^[[:space:]]*"features"[[:space:]]*([.=])/ ||
         value ~ /^[[:space:]]*\047features\047[[:space:]]*([.=])/
}

function is_pointer(text, key) {
  return text ~ "^" key "[[:space:]]*="
}

function pointer_value(text, value) {
  value = text
  sub(/^[^=]*=[[:space:]]*"/, "", value)
  sub(/"[[:space:]]*$/, "", value)
  return value
}

function is_string_pointer(text, key) {
  return text ~ "^" key "[[:space:]]*=[[:space:]]*\"[^\"]*\"[[:space:]]*$"
}

function emit_feature_file(line) {
  while ((getline line < feature_file) > 0) print line
  close(feature_file)
}

BEGIN {
  dq = "\""
  sq = sprintf("%c", 39)
  bs = "\\"
  if (action != "strip" && action != "extract" && action != "split" &&
      action != "root-symbols" && action != "features-strip" &&
      action != "features-merge" && action != "engram-pointers" &&
      action != "remove-table") exit 64
}

{
  at_root = string_mode == "" && array_depth == 0 && brace_depth == 0

  if (action == "engram-pointers") {
    original[NR] = $0
    if (at_root && $0 == start_marker) {
      pointer_starts++
      pointer_start_line = NR
    }
    if (at_root && $0 == end_marker) {
      pointer_ends++
      pointer_end_line = NR
    }
    if (at_root && is_pointer($0, model_key)) {
      model_rows++
      model_line = NR
      pointer_row[NR] = 1
      if (!is_string_pointer($0, model_key) || pointer_value($0) != model_value)
        invalid_model = 1
    }
    if (at_root && is_pointer($0, compact_key)) {
      compact_rows++
      compact_line = NR
      pointer_row[NR] = 1
      if (!is_string_pointer($0, compact_key) || pointer_value($0) != compact_value)
        invalid_compact = 1
    }
    scan_root($0)
    next
  }

  if (action == "remove-table") {
    if (remove_inside && at_root && $0 ~ /^[[:space:]]*\[/)
      remove_inside = 0
    if (!remove_inside && at_root && $0 == target_header) {
      remove_seen++
      remove_inside = 1
      scan_root($0)
      next
    }
    if (!remove_inside) print
    scan_root($0)
    next
  }

  if (action == "features-strip" || action == "features-merge") {
    if (action == "features-strip" && at_root && $0 == feature_start_marker) {
      if (feature_section != "features" || feature_inside)
        feature_malformed = 1
      feature_inside = 1
      feature_seen_start++
      next
    }
    if (action == "features-strip" && at_root && $0 == feature_end_marker) {
      if (feature_section != "features" || !feature_inside)
        feature_malformed = 1
      feature_inside = 0
      feature_seen_end++
      next
    }
    if (action == "features-strip" && at_root &&
        $0 ~ /^[[:space:]]*#[[:space:]]*oso-code:features:(start|end)/) {
      feature_malformed = 1
      next
    }
    if (at_root && $0 ~ /^[[:space:]]*\[/) {
      if (is_features_header($0)) {
        feature_tables++
        feature_section = "features"
        if (action == "features-merge") {
          print
          emit_feature_file()
          feature_inserted = 1
          next
        }
      } else {
        if (is_features_shape($0)) feature_malformed = 1
        feature_section = "other"
      }
    } else if (at_root && feature_section == "" && is_root_features_key($0)) {
      feature_malformed = 1
    } else if (at_root && feature_section == "features" && !feature_inside &&
               is_owned_feature_key($0)) {
      feature_malformed = 1
    }
    if (!feature_inside) print
    scan_root($0)
    next
  }

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
  if (action == "engram-pointers") {
    if (model_rows != 1 || compact_rows != 1 || invalid_model || invalid_compact) exit 11
    if (pointer_starts == 0 && pointer_ends == 0 && !require_region) {
      for (pointer_line = 1; pointer_line <= NR; pointer_line++) print original[pointer_line]
      exit
    }
    if (pointer_starts != 1 || pointer_ends != 1 ||
        pointer_start_line >= pointer_end_line) exit 10
    if (model_line < pointer_start_line && compact_line < pointer_start_line) {
      for (pointer_line = 1; pointer_line <= NR; pointer_line++) print original[pointer_line]
      exit
    }
    # Engram removes the old root pointers but leaves their following separator
    # behind before reinserting them inside the managed region. Consume exactly
    # that one empty separator so repeated setup runs cannot accumulate blanks;
    # any additional operator spacing remains untouched.
    pointer_separator_line = pointer_start_line - 1
    if (pointer_separator_line > 0 && original[pointer_separator_line] == "")
      skip_pointer_separator = pointer_separator_line
    for (pointer_line = 1; pointer_line <= NR; pointer_line++) {
      if (pointer_row[pointer_line] || pointer_line == skip_pointer_separator) continue
      if (pointer_line == pointer_start_line) {
        print model_key " = \"" model_value "\""
        print compact_key " = \"" compact_value "\""
      }
      print original[pointer_line]
    }
    exit
  }
  if (action == "remove-table" && remove_seen > 1) exit 12
  if ((action == "strip" || action == "extract") &&
      (malformed || inside || seen_start != seen_end || seen_start > 1 ||
       (require_region && seen_start != 1))) exit 5
  if (action == "features-strip" &&
      (feature_malformed || feature_inside ||
       feature_seen_start != feature_seen_end || feature_seen_start > 1 ||
       feature_tables > 1 || (feature_seen_start && feature_tables != 1))) exit 6
  if (action == "features-merge") {
    if (feature_malformed || feature_tables > 1 || feature_inserted > 1) exit 6
    if (!feature_inserted) {
      if (NR) print ""
      print "[features]"
      emit_feature_file()
    }
  }
}
