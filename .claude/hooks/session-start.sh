#!/bin/bash
# Runs at the start of every session (and every resume) BEFORE the agent reads
# a single file.
#
# WHY THIS EXISTS
# ---------------
# This repo is worked on from Claude Code on the web, where the container is
# ephemeral: it is reclaimed after inactivity and restored from a snapshot. That
# snapshot can be much older than the last session. It has happened twice:
#
#   system boot        Aug  7 22:44
#   reflog jumps       Aug 6 23:41:53  ->  Aug 7 22:47
#
# The machine came back on a disk from the previous night — ~21 hours stale.
# Commits made in between were present in `git log` but had NO reflog entries,
# which is the tell: a commit you make locally always writes one, a commit that
# arrives by `git fetch` does not. So the work had been done on a different
# container instance whose disk was never snapshotted.
#
# Losing work was never the real risk — everything was already on origin. The
# real risk is EDITING STALE FILES: grep for something you wrote yesterday, not
# find it, conclude it was never done, rewrite it, and push a commit that
# silently reverts a day of work behind a plausible message. That nearly
# happened. This hook exists to make that impossible.
#
# WHAT IT DOES
# ------------
# Fast-forwards automatically when that is provably lossless (clean tree, local
# strictly behind origin — the rollback signature, and no local commit can be
# lost because none exists that origin lacks). Anything ambiguous it refuses to
# touch and reports loudly. It never resets, never discards, never force-pushes.
#
# Silent on the happy path, on purpose: a hook that prints a paragraph every
# session costs tokens forever.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

WARN=""
note() { WARN="${WARN}$1"$'\n'; }

# ---- 1. Get the truth from origin ------------------------------------------
# Retried: a cold container's first outbound call often loses the race with the
# network coming up, and a failed fetch here would report a stale tree as clean.
fetched=""
for delay in 0 2 4 8; do
  [ "$delay" != 0 ] && sleep "$delay"
  if git fetch --quiet --prune origin >/dev/null 2>&1; then fetched=1; break; fi
done

if [ -z "$fetched" ]; then
  echo "git: COULD NOT REACH ORIGIN — the tree below is unverified and may be stale."
  echo "git: re-run 'git fetch origin' before trusting or editing anything."
  exit 0
fi

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
# Tracked changes only. A stray untracked scratch file must not be the reason
# a rolled-back tree stays broken — and if an incoming commit really would
# clobber an untracked file, the ff-only merge below refuses on its own and
# that refusal gets reported. So this gate is about edits to files that the
# rollback may have made stale, which is exactly the tracked ones.
dirty=$(git status --porcelain --untracked-files=no 2>/dev/null)

# ---- 2. Heal or report the checked-out branch ------------------------------
if [ "$branch" != "HEAD" ] && git rev-parse --verify --quiet "origin/$branch" >/dev/null 2>&1; then
  local_sha=$(git rev-parse HEAD)
  remote_sha=$(git rev-parse "origin/$branch")

  if [ "$local_sha" != "$remote_sha" ]; then
    behind=$(git merge-base --is-ancestor HEAD "origin/$branch" && echo 1 || echo "")
    ahead=$(git merge-base --is-ancestor "origin/$branch" HEAD && echo 1 || echo "")

    if [ -n "$behind" ]; then
      # Strictly behind: the rollback signature. Fast-forwarding is lossless by
      # definition here — there is no local commit that origin does not have.
      n=$(git rev-list --count "HEAD..origin/$branch")
      if [ -z "$dirty" ]; then
        if git merge --ff-only "origin/$branch" >/dev/null 2>&1; then
          note "git: ROLLBACK DETECTED AND REPAIRED — $branch was $n commit(s) behind origin; fast-forwarded to $(git rev-parse --short HEAD)."
          note "git: the working tree you are about to read is now current. Nothing was discarded."
        else
          note "git: $branch is $n commit(s) behind origin and the fast-forward FAILED. Do not edit; run 'git status' first."
        fi
      else
        # Uncommitted edits on a rolled-back tree: those edits were written
        # against stale files, so merging them is exactly the silent-revert
        # trap. Left untouched for a human to judge.
        note "git: ROLLBACK DETECTED — $branch is $n commit(s) behind origin, AND the tree has uncommitted changes."
        note "git: NOT repaired automatically. Those edits may be built on stale files — inspect before committing."
      fi
    elif [ -n "$ahead" ]; then
      n=$(git rev-list --count "origin/$branch..HEAD")
      note "git: $n local commit(s) on $branch are NOT on origin. A rollback would destroy them — push now."
    else
      note "git: $branch has DIVERGED from origin (local and remote each have commits the other lacks)."
      note "git: not touched. Reconcile deliberately — do not force-push."
    fi
  fi
fi

# ---- 3. Any OTHER local branch left stale ----------------------------------
# The last rollback landed with HEAD on main while the real work sat on a
# feature branch, so checking only the current branch would have missed it.
while read -r b; do
  [ -z "$b" ] || [ "$b" = "$branch" ] && continue
  git rev-parse --verify --quiet "origin/$b" >/dev/null 2>&1 || continue
  if ! git merge-base --is-ancestor "origin/$b" "$b" 2>/dev/null; then
    if git merge-base --is-ancestor "$b" "origin/$b" 2>/dev/null; then
      note "git: branch '$b' is behind origin (not checked out, so not touched)."
    else
      note "git: branch '$b' has diverged from origin (not checked out)."
    fi
  fi
done < <(git for-each-ref --format='%(refname:short)' refs/heads/ 2>/dev/null)

# ---- 4. Dependencies -------------------------------------------------------
# Only on the web, where the container may come back without them. `npm install`
# rather than `ci` so a warm container skips the work.
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && [ ! -d server/node_modules ]; then
  if (cd server && npm install --silent --no-audit --no-fund >/dev/null 2>&1); then
    note "deps: server/node_modules was missing — reinstalled."
  else
    note "deps: server/node_modules is missing and 'npm install' FAILED. The local server will not start."
  fi
fi

# ---- 5. Report -------------------------------------------------------------
# Only when there is something to say. Silence means: tree verified current.
[ -n "$WARN" ] && printf '%s' "$WARN"
exit 0
