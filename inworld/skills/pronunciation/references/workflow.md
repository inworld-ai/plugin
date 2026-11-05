# Safe edits and pronunciation listening

## Read-modify-write

1. Read the exact named resource in the intended workspace/region. Keep its full
   name, current ETag, display name and complete entries as the before snapshot.
2. Apply the requested edit locally. Show added, changed, retained, and removed
   entries. Sending only a changed entry deletes every other entry. Empty list
   clears the dictionary; make that consequence explicit in the review.
3. For rename use only `updateMask=displayName`. For entry edits use only
   `updateMask=pronunciations`, the complete intended list, and current ETag.
   Do not echo output-only metadata into write bodies.
4. Execute within the user's authorized dictionary-editing scope. On 409, re-read,
   reconcile with the user's intent and new contents, then prepare a fresh diff.
   Never automatically drop the ETag or overwrite concurrent changes.
5. Read back an authorized successful save, retaining returned canonical phones
   and ETag. Rollback also requires the latest ETag and a new reviewed full list;
   a stale before snapshot must not overwrite another editor's changes.

For create, choose a recognizable unique display name and save the intended
complete body locally before submission. If timeout/lost response yields no
resource name, do not retry create. List **all pages** using the current method
schema, inspect candidate full names and contents, and resolve ambiguity. Display
names are not unique identity or authority to delete. If unresolved, stop and
report the uncertain outcome. Do not assume an undocumented idempotency key.

For an uncertain update, get the known resource and compare the entire intended
state before another conditional write. For uncertain delete, GET 404 confirms
absence; otherwise inspect before another conditional delete. `allowMissing`
does not bypass a stale ETag. Do not auto-clean up dictionaries on an error.

## Listening plan

Reuse the developer app's existing voice, audio output and fixtures. Prepare an
offline matrix before any paid generation. Keep text, voice, model, explicit
language, encoding, normalization and seed (if supported) fixed; vary only the
dictionary selector. Use fresh requests and inspect completed audio/errors.

Include target terms in several natural contexts, punctuation, required casing
and inflections, unrelated words, and a substring negative control (`scatter`
must not change because of `cat`). Keep some sentences as **holdouts** while
adjusting phones. Include a language mismatch and, for ordered named dictionaries,
a deliberate overlap to check first-dictionary precedence. Do not assume lexical
normalization across locales or that a saved word covers every inflection.

With explicit paid/audio authorization, compare baseline (both selectors absent)
and selected audio in the same voice. Listen for intended pronunciation,
intelligibility, naturalness, language/accent continuity, and unchanged controls.
Ask the intended speaker/domain reviewer to judge the holdouts. Log per-case
pass/fail, resource names, region, configuration and generation time. Do not use
transcription alone as pronunciation ground truth. Offline payload tests cannot
establish sound quality, model support, or feature availability.

Portal Preview/Play sends inline IPA, can use unsaved phones, and bypasses saved
word matching. For workspace lookup, use normal Playground with original spelling
and no temporary Custom pronunciations entries. Workspace cache has a standard
five-minute refresh interval, but refresh is asynchronous and can fail; five
minutes is not a maximum propagation delay and browser reload does not force it.
Named dictionaries are read during synthesis, without that cache interval. Start
a fresh synthesis after edits. Avoid editing/deleting selected resources while
queued jobs or conversations require stable pronunciations; selections are not
version-pinned.

Report what was actually tested: simulated request behavior versus real service
validation and human listening. For failures retain sanitized request ID/time,
region/model/language, resource names and error details; never retain the key.
