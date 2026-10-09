from datetime import datetime, timedelta
from os import getenv

from openai import OpenAI

from models import TodoItemForCreate


def _generate_todo_messages(prompt: str) -> list[dict]:
    today = datetime.now()
    next_week = today + timedelta(weeks=1)
    next_monday = today + timedelta(days=(7 - today.weekday()) % 7 or 7)

    return [
        {
            "role": "system",
            "content": f"You are a personal assistant that converts user input into a concise todo item with description. Today is {today.isoformat()} ({today.strftime('%A')}).",
        },
        # A few examples of what we expect ("few-shot prompting")
        {
            "role": "user",
            "content": "I need to clean my room because it's messy today.",
        },
        {
            "role": "assistant",
            "content": TodoItemForCreate(
                title="Clean room",
                description="Organize and tidy up living space",
                deadline=today,
            ).model_dump_json(),
        },
        {
            "role": "user",
            "content": "I have to finish my project report by next week.",
        },
        {
            "role": "assistant",
            "content": TodoItemForCreate(
                title="Finish project report",
                description="Complete final report and submit",
                deadline=next_week,
            ).model_dump_json(),
        },
        {"role": "user", "content": "Call my mom next Monday"},
        {
            "role": "assistant",
            "content": TodoItemForCreate(
                title="Call mom",
                description="Phone call with mother",
                deadline=next_monday,
            ).model_dump_json(),
        },
        {
            "role": "user",
            "content": prompt,
        },
    ]


def generate_todo(prompt: str) -> TodoItemForCreate | None:
    # Works with any OpenAI-compatible endpoint (see .env.sample)
    client = OpenAI(base_url=getenv("LLM_API_BASE"), api_key=getenv("LLM_API_KEY"))

    response = client.chat.completions.parse(
        model=getenv("LLM_MODEL", "openrouter/deepseek/deepseek-v4.1-flash"),
        messages=_generate_todo_messages(prompt),
        response_format=TodoItemForCreate,  # Force the LLM to answer in this structure
    )

    return response.choices[0].message.parsed
