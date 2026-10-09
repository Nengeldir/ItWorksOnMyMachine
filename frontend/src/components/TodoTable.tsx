import { deleteTodo, type TodoItem } from "../api";

interface TodoTableProps {
  todos: TodoItem[];
  onTodoDeleted: () => void;
}

const TodoTable = ({ todos, onTodoDeleted }: TodoTableProps) => {
  const handleDeleteTodo = async (todoId: number) => {
    await deleteTodo(todoId);
    onTodoDeleted();
  };

  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Description</th>
            <th>Deadline</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {todos.length === 0 && (
            <tr>
              <td colSpan={4} className="empty">
                Nothing to do yet.
              </td>
            </tr>
          )}
          {todos.map((todo) => (
            <tr key={todo.id}>
              <td>{todo.title}</td>
              <td>{todo.description}</td>
              <td>{todo.deadline.toLocaleDateString()}</td>
              <td>
                <button
                  onClick={() => handleDeleteTodo(todo.id)}
                  className="delete-button"
                  aria-label={`Delete "${todo.title}"`}
                  title="Delete"
                >
                  {/* Trash can icon, drawn in the button's text color */}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
                  </svg>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default TodoTable;
