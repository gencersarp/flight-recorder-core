import json
import pytest
from unittest.mock import patch, MagicMock, PropertyMock

from agent_flight_recorder import FlightRecorder, wrap_openai, record


class TestFlightRecorder:
    """Test FlightRecorder class with mocked HTTP calls."""

    def _mock_post(self, status_code=200, json_data=None):
        mock_resp = MagicMock()
        mock_resp.status_code = status_code
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = json_data or {}
        return mock_resp

    @patch("agent_flight_recorder.requests.post")
    def test_start_run(self, mock_post):
        mock_post.return_value = self._mock_post(json_data={"run_id": "test-run-123"})

        recorder = FlightRecorder("http://localhost:3001/api")
        run_id = recorder.start_run(name="Test", model="gpt-4", tags=["test"])

        assert run_id == "test-run-123"
        assert recorder.current_run_id == "test-run-123"
        mock_post.assert_called_once()
        call_args = mock_post.call_args
        assert "/runs/start" in call_args[0][0]

    @patch("agent_flight_recorder.requests.post")
    def test_start_run_failure_returns_none(self, mock_post):
        mock_post.side_effect = Exception("Connection refused")

        recorder = FlightRecorder("http://localhost:3001/api")
        run_id = recorder.start_run(name="Test")

        assert run_id is None
        assert recorder.current_run_id is None

    @patch("agent_flight_recorder.requests.post")
    def test_record_step(self, mock_post):
        mock_post.return_value = self._mock_post(json_data={"step_id": "step-456"})

        recorder = FlightRecorder("http://localhost:3001/api")
        recorder.current_run_id = "run-123"

        step_id = recorder.record_step("LLM_CALL", {"prompt": "hello"}, duration=100)

        assert step_id == "step-456"

    @patch("agent_flight_recorder.requests.post")
    def test_record_step_without_run_returns_none(self, mock_post):
        recorder = FlightRecorder("http://localhost:3001/api")
        step_id = recorder.record_step("LLM_CALL", {"prompt": "hello"})

        assert step_id is None
        mock_post.assert_not_called()

    @patch("agent_flight_recorder.requests.post")
    def test_record_step_failure_returns_none(self, mock_post):
        mock_post.side_effect = Exception("Network error")

        recorder = FlightRecorder("http://localhost:3001/api")
        recorder.current_run_id = "run-123"
        step_id = recorder.record_step("LLM_CALL", {"prompt": "hello"})

        assert step_id is None

    @patch("agent_flight_recorder.requests.post")
    def test_finish_run(self, mock_post):
        mock_post.return_value = self._mock_post()

        recorder = FlightRecorder("http://localhost:3001/api")
        recorder.current_run_id = "run-123"
        recorder.finish_run(status="success")

        assert recorder.current_run_id is None

    @patch("agent_flight_recorder.requests.post")
    def test_finish_run_without_current_run(self, mock_post):
        recorder = FlightRecorder("http://localhost:3001/api")
        recorder.finish_run(status="success")

        mock_post.assert_not_called()

    @patch("agent_flight_recorder.requests.post")
    def test_context_manager_success(self, mock_post):
        start_resp = self._mock_post(json_data={"run_id": "ctx-run"})
        finish_resp = self._mock_post()
        mock_post.side_effect = [start_resp, finish_resp]

        recorder = FlightRecorder("http://localhost:3001/api")
        with recorder.run(name="CTX Run"):
            pass

        assert mock_post.call_count == 2
        # Second call should be finish with status=success
        finish_call = mock_post.call_args_list[1]
        body = finish_call[1]["json"]
        assert body["status"] == "success"

    @patch("agent_flight_recorder.requests.post")
    def test_context_manager_error(self, mock_post):
        start_resp = self._mock_post(json_data={"run_id": "ctx-run"})
        finish_resp = self._mock_post()
        mock_post.side_effect = [start_resp, finish_resp]

        recorder = FlightRecorder("http://localhost:3001/api")
        with pytest.raises(ValueError):
            with recorder.run(name="Error Run"):
                raise ValueError("something broke")

        assert mock_post.call_count == 2
        finish_call = mock_post.call_args_list[1]
        body = finish_call[1]["json"]
        assert body["status"] == "error"

    @patch("agent_flight_recorder.requests.post")
    def test_record_llm_call(self, mock_post):
        mock_post.return_value = self._mock_post(json_data={"step_id": "llm-step"})

        recorder = FlightRecorder("http://localhost:3001/api")
        recorder.current_run_id = "run-123"
        step_id = recorder.record_llm_call(prompt="Hi", response="Hello", model="gpt-4", duration=200)

        assert step_id == "llm-step"
        call_body = mock_post.call_args[1]["json"]
        assert call_body["type"] == "LLM_CALL"
        assert call_body["payload"]["prompt"] == "Hi"
        assert call_body["payload"]["response"] == "Hello"

    @patch("agent_flight_recorder.requests.post")
    def test_record_tool_call(self, mock_post):
        mock_post.return_value = self._mock_post(json_data={"step_id": "tool-step"})

        recorder = FlightRecorder("http://localhost:3001/api")
        recorder.current_run_id = "run-123"
        step_id = recorder.record_tool_call(name="calc", args={"x": 1}, result=42, duration=10)

        assert step_id == "tool-step"
        call_body = mock_post.call_args[1]["json"]
        assert call_body["type"] == "TOOL_CALL"
        assert call_body["payload"]["name"] == "calc"

    @patch("agent_flight_recorder.requests.post")
    def test_api_key_header(self, mock_post):
        mock_post.return_value = self._mock_post(json_data={"run_id": "run-key"})

        recorder = FlightRecorder("http://localhost:3001/api")
        recorder._api_key = "my-secret-key"
        recorder.start_run(name="Key Test")

        headers = mock_post.call_args[1]["headers"]
        assert headers["Authorization"] == "Bearer my-secret-key"


class TestWrapOpenAI:
    """Test wrap_openai with a mocked OpenAI client."""

    @patch("agent_flight_recorder.requests.post")
    def test_wrap_openai_records_call(self, mock_post):
        # Set up mock responses for record_step
        mock_post.return_value = MagicMock(
            status_code=200,
            raise_for_status=MagicMock(),
            json=MagicMock(return_value={"step_id": "s1"}),
        )

        # Create fake OpenAI client
        mock_choice = MagicMock()
        mock_choice.message.content = "Hello there!"
        mock_choice.message.role = "assistant"
        mock_choice.finish_reason = "stop"

        mock_usage = MagicMock()
        mock_usage.prompt_tokens = 10
        mock_usage.completion_tokens = 5
        mock_usage.total_tokens = 15

        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]
        mock_completion.usage = mock_usage

        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = mock_completion

        recorder = FlightRecorder("http://localhost:3001/api")
        recorder.current_run_id = "run-openai"

        wrap_openai(mock_client, recorder)

        # Call the patched create
        result = mock_client.chat.completions.create(
            model="gpt-4",
            messages=[{"role": "user", "content": "Hi"}]
        )

        assert result == mock_completion
        # record_step should have been called via record_llm_call
        assert mock_post.called

    def test_wrap_openai_without_chat_attr(self):
        """Should not crash if client doesn't have chat.completions."""
        mock_client = MagicMock(spec=[])  # No attributes
        del mock_client.chat
        recorder = FlightRecorder("http://localhost:3001/api")
        # Should not raise
        wrap_openai(mock_client, recorder)


class TestRecordDecorator:
    """Test the @record decorator."""

    @patch("agent_flight_recorder.requests.post")
    def test_record_decorator_records_call(self, mock_post):
        mock_post.return_value = MagicMock(
            status_code=200,
            raise_for_status=MagicMock(),
            json=MagicMock(return_value={"step_id": "dec-step"}),
        )

        from agent_flight_recorder import _default_recorder
        _default_recorder.current_run_id = "run-decorator"

        @record(name="my_tool")
        def my_tool(x, y):
            return x + y

        result = my_tool(2, 3)
        assert result == 5
        assert mock_post.called

        call_body = mock_post.call_args[1]["json"]
        assert call_body["type"] == "TOOL_CALL"
        assert call_body["payload"]["name"] == "my_tool"
        assert call_body["payload"]["result"] == 5

        _default_recorder.current_run_id = None

    @patch("agent_flight_recorder.requests.post")
    def test_record_decorator_records_error(self, mock_post):
        mock_post.return_value = MagicMock(
            status_code=200,
            raise_for_status=MagicMock(),
            json=MagicMock(return_value={"step_id": "dec-step"}),
        )

        from agent_flight_recorder import _default_recorder
        _default_recorder.current_run_id = "run-decorator-err"

        @record(name="failing_tool")
        def failing_tool():
            raise RuntimeError("boom")

        with pytest.raises(RuntimeError, match="boom"):
            failing_tool()

        call_body = mock_post.call_args[1]["json"]
        assert "error" in call_body["payload"]
        assert "boom" in call_body["payload"]["error"]

        _default_recorder.current_run_id = None

    def test_record_decorator_uses_function_name(self):
        @record()
        def auto_named_func():
            return 42

        # Verify the function name is preserved
        assert auto_named_func.__name__ == "auto_named_func"


class TestGracefulDegradation:
    """Test that the SDK degrades gracefully when the server is down."""

    @patch("agent_flight_recorder.requests.post")
    def test_full_workflow_with_server_down(self, mock_post):
        mock_post.side_effect = Exception("Connection refused")

        recorder = FlightRecorder("http://localhost:9999/api")

        run_id = recorder.start_run(name="Offline Test")
        assert run_id is None

        step_id = recorder.record_step("LLM_CALL", {"prompt": "test"})
        assert step_id is None

        # Should not raise
        recorder.finish_run()
