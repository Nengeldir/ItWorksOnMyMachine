import { useState, type FormEvent } from "react";
import { createTodo, generateTodo, type TodoItemForCreate } from "../api";

interface TodoFormProps {
  onTodoCreated: () => void;
}

// <input type="date"> expects "YYYY-MM-DD" in local time (toISOString() would be UTC)
function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const TodoForm = ({ onTodoCreated }: TodoFormProps) => {
  const [prompt, setPrompt] = useState<string>("");
  const [generatedTodo, setGeneratedTodo] = useState<TodoItemForCreate | null>(
    null,
  );
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  async function generateTodoFromPrompt(event: FormEvent) {
    event.preventDefault(); // Stop the browser from reloading the page
    if (!prompt.trim()) return;

    setIsGenerating(true);
    try {
      const generated = await generateTodo(prompt);
      setGeneratedTodo(generated);
      setPrompt("");
    } catch (error) {
      console.error("Failed to generate todo:", error);
    } finally {
      setIsGenerating(false);
    }
  }

  const handleCreateTodo = async () => {
    if (!generatedTodo) return;

    await createTodo(
      generatedTodo.title,
      generatedTodo.description,
      generatedTodo.deadline,
    );
    setGeneratedTodo(null);
    onTodoCreated();
  };

  if (!generatedTodo) {
    return (
      <form onSubmit={generateTodoFromPrompt} className="prompt-form">
        <input
          type="text"
          placeholder='Describe a todo, e.g. "Plan a birthday party next week"'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={isGenerating}
        />
        <button
          type="submit"
          disabled={isGenerating || !prompt.trim()}
          className="primary-button"
        >
          {isGenerating ? "Generating..." : "Generate Todo"}
        </button>
      </form>
    );
  }

  const editGeneratedTodo = (changes: Partial<TodoItemForCreate>) =>
    setGeneratedTodo({ ...generatedTodo, ...changes });

  return (
    <div className="card preview">
      <h3>Review and Edit Generated Todo</h3>
      <div className="form-row">
        <div className="form-field">
          <label htmlFor="todo-title">Title</label>
          <input
            id="todo-title"
            type="text"
            value={generatedTodo.title}
            onChange={(e) => editGeneratedTodo({ title: e.target.value })}
          />
        </div>
        <div className="form-field">
          <label htmlFor="todo-deadline">Deadline</label>
          <input
            id="todo-deadline"
            type="date"
            required
            value={toDateInputValue(generatedTodo.deadline)}
            onChange={(e) => {
              const value = e.target.value; // empty while the date is being cleared
              if (!value) return;
              // Without a time zone, the date is parsed as local time
              editGeneratedTodo({ deadline: new Date(`${value}T00:00`) });
            }}
          />
        </div>
      </div>
      <div className="form-field">
        <label htmlFor="todo-description">Description</label>
        <textarea
          id="todo-description"
          value={generatedTodo.description}
          onChange={(e) => editGeneratedTodo({ description: e.target.value })}
          rows={3}
        />
      </div>
      <div className="button-group">
        <button
          onClick={() => setGeneratedTodo(null)}
          className="secondary-button"
        >
          Cancel
        </button>
        <button onClick={handleCreateTodo} className="primary-button">
          Create Todo
        </button>
      </div>
    </div>
  );
};

export default TodoForm;
