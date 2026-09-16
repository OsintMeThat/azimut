"""Small case checklists, stored as manifest metadata and carried by bundles."""

from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, StringConstraints, model_validator

from .common import get_case

router = APIRouter(prefix="/api/cases", tags=["cases"])
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
Identifier = Annotated[str, StringConstraints(pattern=r"^[a-zA-Z0-9_-]{1,64}$")]


class Task(BaseModel):
    id: Identifier
    text: Text
    done: bool = False


class TodoList(BaseModel):
    id: Identifier
    name: Name
    tasks: list[Task] = Field(default_factory=list, max_length=200)


class Todos(BaseModel):
    revision: int = Field(ge=0)
    lists: list[TodoList] = Field(max_length=50)

    @model_validator(mode="after")
    def unique_ids(self):
        ids = [entry.id for entry in self.lists]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate list ids")
        for entry in self.lists:
            ids = [task.id for task in entry.tasks]
            if len(set(ids)) != len(ids):
                raise ValueError("duplicate task ids")
        return self


@router.get("/{case_id}/todos")
def read_todos(case_id: str):
    return get_case(case_id).read_todos()


@router.put("/{case_id}/todos")
def save_todos(case_id: str, body: Todos):
    case = get_case(case_id)
    with case.lock:
        if case.read_todos()["revision"] != body.revision:
            raise HTTPException(409, "This to-do list changed in another tab. Reload it before editing.")
        return case.write_todos(body.model_dump())
