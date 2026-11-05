# Listening protocol

Use approved saved audio on the same playback device and volume. Start with
the actual app path; an isolated clean render can miss chunk joins, truncation,
queue delays or effects introduced by playback. Preserve raw clips; if loudness
matching is needed, keep a separate derived copy and document the transform.
Don't normalize away clipping/noise when those are being tested.

Randomize A/B order and conceal the candidate label when practical; retain the
mapping. Listen once for the whole message, then replay the critical span and
the ending. A listener fluent in the case's language should review accent and
meaning. Check:

- Names/product terms against the app owner's intended pronunciation, with
  accepted variants specified before testing.
- Numbers, decimal separators, currency, negatives and units against the
  intended amount. Distinguish a natural rendering from a wrong value.
- IDs character by character, including leading zeros and repeated digits.
  Check symbols and spelling conventions for the target language explicitly.
- Language spans and code switches for the intended language and pronunciation;
  a language tag is not evidence the model honored it.
- Pauses where intended, intelligible timing, no spoken markup, no lost tail
  after a break or streaming flush. A requested 500 ms break isn't a measured
  500 ms silence; use waveform/timestamp evidence for a numeric claim.
- Delivery, intelligibility, artifacts and consistency with the product persona.
  Preference for a timbre is separate from a correctness failure.

For every named check record `pass`, `fail` or `unknown`, the listener, audio
reference, and concrete notes (timestamp/span where useful). Never synthesize
review observations from the input text or an STT transcript. If listeners
disagree, retain both observations in notes and leave the adjudicated check
unknown until resolved. Don't invent MOS from one person's preference.

Use repeated renders only within an authorized budget when stochastic behavior
matters. The simple comparator accepts one retained outcome per case/run;
compare each replicate as a distinct run, preserve failed attempts, and show
variability rather than choosing the best clip. A small set cannot establish
failure probability or dependable latency tails.
