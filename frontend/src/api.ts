export interface User {
  id: string;
  name: string;
}

export interface TodoItem {
  id: number;
  title: string;
  description: string;
  deadline: Date;
}

export interface TodoItemForCreate {
  title: string;
  description: string;
  deadline: Date;
}

export class ApiError extends Error {
  constructor(status: number, message: string) {
    super(`${status} / ${message}`);
    this.name = "ApiError";
  }
}

async function request<T>(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
  };

  const config: RequestInit = {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  };

  const response = await fetch(endpoint, config);

  // If the response is not OK (e.g., 404, 500), throw a custom error.
  if (!response.ok) {
    const error = new ApiError(response.status, response.statusText);
    alert(`${error.name}: ${error.message}`);
    throw error;
  }

  // For 204 No Content, there's no body to parse
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// JSON has no date type, so the backend sends deadlines as strings
function parseDeadline<T extends { deadline: Date }>(todo: T): T {
  return { ...todo, deadline: new Date(todo.deadline) };
}

export function getMe(): Promise<User> {
  return request(`/api/me`, "GET");
}

export function getTodos(): Promise<TodoItem[]> {
  return request<TodoItem[]>(`/api/todos`, "GET").then((todos) =>
    todos.map(parseDeadline),
  );
}

export function createTodo(
  title: string,
  description: string,
  deadline: Date,
): Promise<TodoItem> {
  return request<TodoItem>(`/api/todos`, "POST", {
    title,
    description,
    deadline,
  }).then(parseDeadline);
}

export function generateTodo(prompt: string): Promise<TodoItemForCreate> {
  return request<TodoItemForCreate>(
    `/api/todos/generate?prompt=${encodeURIComponent(prompt)}`,
    "GET",
  ).then(parseDeadline);
}

export function deleteTodo(id: number): Promise<void> {
  return request(`/api/todos/${id}`, "DELETE");
}

// Calls onChange whenever the todos change, e.g. in another tab.
// Returns a function that stops listening (use it as the useEffect cleanup).
export function subscribeToTodoChanges(onChange: () => void): () => void {
  // Server-Sent Events: the browser keeps the request open and reconnects by itself
  const events = new EventSource("/api/todos/events");
  events.onmessage = (event) => {
    if (JSON.parse(event.data).type === "todos_changed") {
      onChange();
    }
  };
  return () => events.close();
}
