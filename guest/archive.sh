# Source this from the builder. Digests and source directory names are pinned
# by guest/build.sh, never obtained from the archive or its download server.
prepare_source() (
  set -eu
  archive=$1
  source_dir=$2
  digest=$3

  stage=$(mktemp -d .source-XXXXXXXX)
  trap 'rm -rf "$stage"' EXIT
  trap 'exit 1' HUP INT TERM
  # Another builder may still be downloading to the shared archive pathname.
  # Verify and extract the same private copy, including on warm-cache builds.
  cp "$archive" "$stage/archive"
  chmod 400 "$stage/archive"
  printf 'Verifying %s\n' "$archive"
  printf '%s  %s\n' "$digest" "$stage/archive" | sha256sum -c -
  if [ ! -d "$source_dir" ]; then
    tar xf "$stage/archive" -C "$stage"
    test -d "$stage/$source_dir"
    test ! -L "$stage/$source_dir"
    mv "$stage/$source_dir" "$source_dir"
  fi
)
