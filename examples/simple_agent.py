import time
import sys
import os

# Add sdk to path for local testing
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../sdks/python')))

from agent_flight_recorder import run, record_llm_call, record_tool_call

def my_fake_llm(prompt):
    print(f"Calling LLM with prompt: {prompt}")
    time.sleep(0.5)
    return "This is a fake response from the LLM."

def my_fake_tool(name, args):
    print(f"Calling tool {name} with args {args}")
    time.sleep(0.2)
    return {"status": "success", "result": 42}

def run_agent():
    with run(name="Test Agent Run", model="gpt-4", tags=["test", "example"]):
        # Step 1: LLM Call
        prompt = "What is the meaning of life?"
        start_time = time.time()
        response = my_fake_llm(prompt)
        duration = int((time.time() - start_time) * 1000)
        record_llm_call(prompt=prompt, response=response, model="gpt-4", duration=duration)

        # Step 2: Tool Call
        tool_name = "calculator"
        tool_args = {"expression": "21 * 2"}
        start_time = time.time()
        tool_result = my_fake_tool(tool_name, tool_args)
        duration = int((time.time() - start_time) * 1000)
        record_tool_call(name=tool_name, args=tool_args, result=tool_result, duration=duration)

        # Step 3: Another LLM Call
        prompt = f"The tool returned {tool_result}. What's next?"
        start_time = time.time()
        response = my_fake_llm(prompt)
        duration = int((time.time() - start_time) * 1000)
        record_llm_call(prompt=prompt, response=response, model="gpt-4", duration=duration)

    print("Agent run complete!")

if __name__ == "__main__":
    run_agent()
