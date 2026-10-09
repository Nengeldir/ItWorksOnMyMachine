import { useEffect, useState } from "react";
import {
  getTodos,
  subscribeToTodoChanges,
  type TodoItem,
  type User,
} from "../api";
import TodoForm from "./TodoForm";
import TodoTable from "./TodoTable";
import "./Todos.css";

interface TodosProps {
  me?: User;
}

const Todos = ({ me }: TodosProps) => {
  const [todos, setTodos] = useState<TodoItem[]>([]);

  function updateTodos() {
    getTodos().then(setTodos);
  }

  useEffect(() => {
    updateTodos();
  }, []);

  // Live updates: refetch when the todos change in another tab
  useEffect(() => subscribeToTodoChanges(updateTodos), []);

  return (
    <main className="todos">
      <h2>{me ? `Todos of ${me.name}` : "Your todos"}</h2>
      <TodoForm onTodoCreated={updateTodos} />
      <TodoTable todos={todos} onTodoDeleted={updateTodos} />
    </main>
  );
};

export default Todos;
