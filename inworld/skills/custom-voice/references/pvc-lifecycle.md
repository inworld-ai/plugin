# PVC creation, continuation and status

Verified 2026-10-17 against [PVC onboarding](https://docs.inworld.ai/tts/professional-voice-cloning)
and the API references below. These instructions describe an authorized future
workflow; this skill ships no API executor.

1. Inspect the user's existing client and workspace. For a new voice, check
   [resolveUploadLimits](https://docs.inworld.ai/api-reference/pvcAPI/pvcvoiceservice/resolve-pvc-upload-limits)
   for current file/count/byte/duration/language limits and
   `usedPvcVoiceSlots`/`maxPvcVoiceSlots`. This endpoint does **not** report the
   training rate. Check the current plan table separately; a payment method is
   required for On-Demand PVC creation. Drafts and failures occupy slots too.
   Do not free slots by deleting voices automatically.
2. With create authorization,
   [create a draft](https://docs.inworld.ai/api-reference/pvcAPI/pvcvoiceservice/create-pvc-voice)
   and retain returned `pvcVoiceId` and resource `name`. With upload authorization,
   [upload samples](https://docs.inworld.ai/api-reference/pvcAPI/pvcvoiceservice/upload-pvc-voice-samples)
   in batches of at most 10. Retain each returned `sampleId`, size, duration,
   hash and trims. Compare actual attached samples on resume instead of blindly
   reuploading the local dataset. Actual post-trim duration must meet the minimum.
3. With explicit training authorization and quota understood,
   [train](https://docs.inworld.ai/api-reference/pvcAPI/pvcvoiceservice/train-pvc-voice)
   once. It returns the PVC voice resource, **not** an Operation or job ID.
   Inspect that resource with
   [get](https://docs.inworld.ai/api-reference/pvcAPI/pvcvoiceservice/get-pvc-voice).
   For authorized monitoring, docs suggest 15–30-second polls; bound the session
   wait and leave IDs and latest state for later continuation. No timing promise,
   background daemon or automatic retraining loop.

| Observed state | Next action |
| --- | --- |
| `PVC_VOICE_STATE_DRAFT` | Reconcile attached samples and trims; propose missing uploads or training |
| `PVC_VOICE_STATE_QUEUED` / `PVC_VOICE_STATE_TRAINING` | Observe or resume later; don't submit another train just to check progress |
| `PVC_VOICE_STATE_FAILED` | Read `failure.reason` and scrubbed `failure.message`; diagnose samples/language. Editing may return the voice to DRAFT with remaining samples intact. Obtain authorization for any repair or new training attempt |
| `PVC_VOICE_STATE_READY` | Resolve synthesis voice, audition and integrate; no sample changes, retraining or PVC deletion |
| Unknown/unspecified state | Preserve raw state and stop mutations; consult current docs |

On `429`, respect any retry guidance and the named quota window; no retry loop.
On `404`, check workspace and exact ID: the API does not distinguish missing
voices from voices belonging to another workspace. On timeout or lost create,
upload or train response, reconcile by
[list](https://docs.inworld.ai/api-reference/pvcAPI/pvcvoiceservice/list-pvc-voices)
and get first. Do not infer failure and create a duplicate.

READY is final: sample editing, training again, and deletion through PVC return
`409`. The returned `customVoice` is a Voices resource name; find the matching
entry using [List voices](https://docs.inworld.ai/api-reference/voiceAPI/voiceservice/list-voices)
and take its exact `voiceId` for TTS. Neither `pvcVoiceId` nor `sampleId` is a
synthesis ID. In Portal, the finished voice appears under My voices; copy its
voice ID there.

Removing a trained voice uses the ordinary Voices API or voice library, not PVC
deletion. A different training dataset needs a new PVC draft. Both are separate
user decisions: never delete a working voice to make room automatically. Keep
the working voice while evaluating a replacement whenever slots permit. If no
slot remains, explain the constraint and stop before destructive changes.
