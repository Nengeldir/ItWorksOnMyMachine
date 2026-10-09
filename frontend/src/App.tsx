import { useEffect, useState } from "react";
import { getMe, type User } from "./api";
import AppHeader from "./components/AppHeader";
import Todos from "./components/Todos";

const App = () => {
  const [me, setMe] = useState<User | undefined>();

  useEffect(() => {
    getMe().then(setMe);
  }, []);

  return (
    <>
      <AppHeader me={me} />
      <Todos me={me} />
    </>
  );
};

export default App;
