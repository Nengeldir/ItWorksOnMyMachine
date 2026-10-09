import type { User } from "../api";
import "./AppHeader.css";

interface AppHeaderProps {
  me?: User;
}

const AppHeader = ({ me }: AppHeaderProps) => {
  return (
    <header className="app-header">
      <img src="/hexagon.png" className="logo" alt="logo" />
      <h1>Welcome to VIScon {new Date().getFullYear()}</h1>
      <p>
        Hello <strong>{me?.name ?? "Hacker"}</strong>! This is an example app to
        get you started: change anything you like or throw it out completely.{" "}
        <a href="https://github.com/AndriMcFly/viscon-hackathon-template">
          Code on GitHub
        </a>
      </p>
    </header>
  );
};

export default AppHeader;
