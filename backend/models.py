from datetime import datetime

from pydantic import BaseModel


class User(BaseModel):
    id: str
    name: str


class TodoItem(BaseModel):
    id: int
    title: str
    description: str
    deadline: datetime


class TodoItemForCreate(BaseModel):
    title: str
    description: str
    deadline: datetime
