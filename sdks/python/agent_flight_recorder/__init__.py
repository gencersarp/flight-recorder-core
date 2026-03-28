"""Core module for the Agent Flight Recorder Python SDK."""
import os
import requests
import uuid
import time
import functools
from contextlib import contextmanager
from typing import Optional, Dict, Any, List, Callable


class FlightRecorder:
    def __init__(self, api_url: str = None):
        self.api_url = api_url or os.getenv("FLIGHT_RECORDER_API_URL", "http://localhost:3001/api")
        self.current_run_id = None
        self._api_key = os.getenv("AFR_API_KEY")

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def start_run(self, name: str = None, model: str = None, temperature: float = None,
                  metadata: Dict = None, tags: List[str] = None) -> Optional[str]:
        payload = {
            "name": name,
            "model": model,
            "temperature": temperature,
            "metadata": metadata,
            "tags": tags,
        }
        try:
            response = requests.post(
                f"{self.api_url}/runs/start",
                json=payload,
                headers=self._headers(),
                timeout=5,
            )
            response.raise_for_status()
            self.current_run_id = response.json()["run_id"]
            return self.current_run_id
        except Exception as e:
            print(f"Warning: Failed to start run: {e}")
            return None

    def record_step(self, type: str, payload: Dict, duration: int = None,
                    timestamp: str = None) -> Optional[str]:
        if not self.current_run_id:
            return None

        step_data = {
            "type": type,
            "payload": payload,
            "duration": duration,
            "timestamp": timestamp,
        }
        try:
            response = requests.post(
                f"{self.api_url}/runs/{self.current_run_id}/step",
                json=step_data,
                headers=self._headers(),
                timeout=5,
            )
            response.raise_for_status()
            return response.json()["step_id"]
        except Exception as e:
            print(f"Warning: Failed to record step: {e}")
            return None

    def finish_run(self, status: str = "success", metadata: Dict = None):
        if not self.current_run_id:
            return

        payload = {
            "status": status,
            "metadata": metadata,
        }
        try:
            response = requests.post(
                f"{self.api_url}/runs/{self.current_run_id}/finish",
                json=payload,
                headers=self._headers(),
                timeout=5,
            )
            response.raise_for_status()
            self.current_run_id = None
        except Exception as e:
            print(f"Warning: Failed to finish run: {e}")

    @contextmanager
    def run(self, name: str = None, model: str = None, temperature: float = None,
            metadata: Dict = None, tags: List[str] = None):
        self.start_run(name, model, temperature, metadata, tags)
        try:
            yield self
        except Exception as e:
            self.finish_run(status="error", metadata={"error": str(e)})
            raise
        else:
            self.finish_run()

    def record_llm_call(self, prompt: Any, response: Any, model: str = None,
                        duration: int = None) -> Optional[str]:
        payload = {
            "prompt": prompt,
            "response": response,
            "model": model,
        }
        return self.record_step("LLM_CALL", payload, duration)

    def record_tool_call(self, name: str, args: Dict, result: Any,
                         duration: int = None) -> Optional[str]:
        payload = {
            "name": name,
            "args": args,
            "result": result,
        }
        return self.record_step("TOOL_CALL", payload, duration)


# ---------------------------------------------------------------------------
# OpenAI wrapper (item 15)
# ---------------------------------------------------------------------------
def wrap_openai(client, recorder: FlightRecorder = None):
    """
    Monkey-patch an OpenAI client so all chat.completions.create calls
    are automatically recorded as LLM_CALL steps.

    Usage:
        from openai import OpenAI
        from agent_flight_recorder import FlightRecorder, wrap_openai

        client = OpenAI()
        recorder = FlightRecorder()
        wrap_openai(client, recorder)

        with recorder.run(name="My run", model="gpt-4"):
            response = client.chat.completions.create(
                model="gpt-4",
                messages=[{"role": "user", "content": "Hello"}]
            )
            # ^ automatically recorded as LLM_CALL step
    """
    if recorder is None:
        recorder = _default_recorder

    # Patch chat.completions.create
    if not hasattr(client, "chat") or not hasattr(client.chat, "completions"):
        print("Warning: wrap_openai expects an OpenAI client with chat.completions")
        return client

    original_create = client.chat.completions.create

    @functools.wraps(original_create)
    def patched_create(*args, **kwargs):
        start_time = time.time()
        error_msg = None
        result = None
        try:
            result = original_create(*args, **kwargs)
            return result
        except Exception as e:
            error_msg = str(e)
            raise
        finally:
            duration_ms = int((time.time() - start_time) * 1000)
            # Extract relevant info
            messages = kwargs.get("messages", args[0] if args else None)
            model = kwargs.get("model", None)

            response_data = None
            if result is not None:
                try:
                    # Handle ChatCompletion object
                    if hasattr(result, "choices") and result.choices:
                        choice = result.choices[0]
                        response_data = {
                            "content": getattr(choice.message, "content", None),
                            "role": getattr(choice.message, "role", None),
                            "finish_reason": getattr(choice, "finish_reason", None),
                        }
                        if hasattr(result, "usage") and result.usage:
                            response_data["usage"] = {
                                "prompt_tokens": getattr(result.usage, "prompt_tokens", None),
                                "completion_tokens": getattr(result.usage, "completion_tokens", None),
                                "total_tokens": getattr(result.usage, "total_tokens", None),
                            }
                    elif hasattr(result, "model_dump"):
                        response_data = result.model_dump()
                    else:
                        response_data = str(result)
                except Exception:
                    response_data = str(result)

            if error_msg is not None:
                response_data = {"error": error_msg}

            recorder.record_llm_call(
                prompt=messages,
                response=response_data,
                model=model,
                duration=duration_ms,
            )

    client.chat.completions.create = patched_create
    return client


# ---------------------------------------------------------------------------
# @record decorator (item 15)
# ---------------------------------------------------------------------------
def record(name: str = None, recorder: FlightRecorder = None, step_type: str = "TOOL_CALL"):
    """
    Decorator to automatically record a function call as a step.

    Usage:
        @record(name="fetch_weather")
        def fetch_weather(city: str) -> dict:
            return {"temp": 72, "city": city}

        # When called inside a recorder.run() context, the call is recorded
        # as a TOOL_CALL step with args and result.
    """
    if recorder is None:
        recorder_ref = [None]  # Use list for closure mutability
    else:
        recorder_ref = [recorder]

    def decorator(fn: Callable) -> Callable:
        fn_name = name or fn.__name__

        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            rec = recorder_ref[0] or _default_recorder
            start_time = time.time()
            error_msg = None
            result = None
            try:
                result = fn(*args, **kwargs)
                return result
            except Exception as e:
                error_msg = str(e)
                raise
            finally:
                duration_ms = int((time.time() - start_time) * 1000)
                # Serialize args safely
                try:
                    safe_args = {"args": list(args), "kwargs": kwargs}
                except Exception:
                    safe_args = {"args": str(args), "kwargs": str(kwargs)}

                if error_msg is not None:
                    payload = {"name": fn_name, "args": safe_args, "error": error_msg}
                else:
                    try:
                        payload = {"name": fn_name, "args": safe_args, "result": result}
                    except Exception:
                        payload = {"name": fn_name, "args": safe_args, "result": str(result)}

                rec.record_step(step_type, payload, duration_ms)

        return wrapper
    return decorator


# ---------------------------------------------------------------------------
# Module-level convenience functions (singleton)
# ---------------------------------------------------------------------------
_default_recorder = FlightRecorder()


def start_run(*args, **kwargs):
    return _default_recorder.start_run(*args, **kwargs)


def record_step(*args, **kwargs):
    return _default_recorder.record_step(*args, **kwargs)


def finish_run(*args, **kwargs):
    return _default_recorder.finish_run(*args, **kwargs)


@contextmanager
def run(*args, **kwargs):
    with _default_recorder.run(*args, **kwargs) as r:
        yield r


def record_llm_call(*args, **kwargs):
    return _default_recorder.record_llm_call(*args, **kwargs)


def record_tool_call(*args, **kwargs):
    return _default_recorder.record_tool_call(*args, **kwargs)
