from __future__ import annotations
import base64, json, os, time
import httpx

INWORLD_API_BASE = os.environ.get("INWORLD_API_BASE", "https://api.inworld.ai")

def _auth() -> dict:
    return {"Authorization": f"Basic {os.environ['INWORLD_API_KEY']}"}

def _config(language=None, vocabulary=None, diarization=False, voice_profile=False, timestamps=False) -> dict:
    cfg = {"modelId": "inworld/inworld-stt-1", "audioEncoding": "AUTO_DETECT"}
    if language:
        cfg["language"] = language
    if vocabulary:
        cfg["prompts"] = list(vocabulary)
    if timestamps:
        cfg["includeWordTimestamps"] = True
    if diarization:
        cfg.update(enableSpeakerDiarization=True, includeWordTimestamps=True)
    if voice_profile:
        cfg["voiceProfileConfig"] = {"enableVoiceProfile": True}
    return cfg

def transcribe_short(audio: bytes, **opts) -> dict:
    """Clips up to ~16 MB. Diarization is not available synchronously."""
    if len(audio) > 16_000_000:
        raise ValueError("Use async transcription for recordings over about 16 MB")
    opts.pop("diarization", None)
    r = httpx.post(
        f"{INWORLD_API_BASE}/stt/v1/transcribe",
        json={"transcribeConfig": _config(**opts), "audioData": {"content": base64.b64encode(audio).decode()}},
        headers=_auth(),
        timeout=120,
    )
    r.raise_for_status()
    data = r.json()
    return {**data["transcription"],
            **({"voiceProfile": data["voiceProfile"]} if "voiceProfile" in data else {}),
            **({"usage": data["usage"]} if "usage" in data else {})}

class TranscriptionJobError(RuntimeError):
    def __init__(self, message, operation_name=None, acceptance_unknown=False):
        super().__init__(message)
        self.operation_name = operation_name
        self.acceptance_unknown = acceptance_unknown

def submit_transcription(path: str | None = None, url: str | None = None, **opts) -> str:
    """Submit once. A transport failure can leave acceptance unknown."""
    try:
        if url:
            r = httpx.post(
                f"{INWORLD_API_BASE}/stt/v1/transcribe:async",
                json={"transcribeConfig": _config(**opts), "audioUri": url},
                headers=_auth(), timeout=360,  # the submit waits while Inworld fetches the URL
            )
        else:
            with open(path, "rb") as f:
                # The config part must come before the file part.
                r = httpx.post(
                    f"{INWORLD_API_BASE}/stt/v1/transcribe:async",
                    files=[
                        ("transcribeConfig", (None, json.dumps(_config(**opts)), "application/json")),
                        ("file", (os.path.basename(path), f)),
                    ],
                    headers=_auth(), timeout=600,
                )
        r.raise_for_status()
        name = r.json()["name"]
        if not isinstance(name, str) or not name:
            raise ValueError("Submit returned no operation name")
        return name
    except Exception as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        raise TranscriptionJobError("Submission failed; reconcile unknown acceptance before resubmitting",
                                    acceptance_unknown=status is None or status >= 500) from exc

def wait_transcription(name: str, poll_s: float = 5, timeout_s: float = 1800) -> dict:
    """Resume the existing job; never resubmit from this function."""
    try:
        return _wait_transcription(name, poll_s, timeout_s)
    except Exception as exc:
        raise TranscriptionJobError(f"Operation {name}: {exc}", operation_name=name) from exc

def _wait_transcription(name: str, poll_s: float, timeout_s: float) -> dict:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        time.sleep(min(poll_s, max(0, deadline - time.monotonic())))
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        op = httpx.get(f"{INWORLD_API_BASE}/lro/v1alpha/{name}", headers=_auth(), timeout=min(30, remaining))
        op.raise_for_status()
        body = op.json()
        if not body.get("done"):
            continue
        if "error" in body:
            raise RuntimeError(f"Inworld STT job failed: {body['error']}")
        # Signed link, no Authorization header; expires 7 days after completion.
        result = httpx.get(body["response"]["resultUri"], timeout=60)
        result.raise_for_status()
        return result.json()
    raise TimeoutError(f"Polling timed out; resume operation {name}, do not submit it again blindly")

def transcribe_long(path: str | None = None, url: str | None = None, *, on_submitted,
                    poll_s: float = 5, timeout_s: float = 1800, **opts) -> dict:
    """on_submitted must durably save the name before polling begins."""
    if not callable(on_submitted):
        raise ValueError("Provide durable on_submitted persistence before submitting")
    name = submit_transcription(path=path, url=url, **opts)
    try:
        on_submitted(name)
    except Exception as exc:
        raise TranscriptionJobError(f"Persist operation {name} before resuming", operation_name=name) from exc
    return wait_transcription(name, poll_s, timeout_s)
