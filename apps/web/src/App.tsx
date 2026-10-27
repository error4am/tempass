import { Home } from "./routes/Home";
import { Join } from "./routes/Join";
import { NotFound } from "./routes/NotFound";
import { Room } from "./routes/Room";
import { matchRoute, usePathname } from "./lib/router";
import { loadSession } from "./lib/session";

export default function App() {
  const pathname = usePathname();
  const route = matchRoute(pathname);

  if (route.name === "home") {
    return <Home />;
  }

  if (route.name === "join") {
    const session = loadSession(route.roomId);

    return session ? (
      <Room roomId={route.roomId} session={session} />
    ) : (
      <Join roomId={route.roomId} />
    );
  }

  if (route.name === "room") {
    const session = loadSession(route.roomId);

    return session ? (
      <Room roomId={route.roomId} session={session} />
    ) : (
      <Join roomId={route.roomId} />
    );
  }

  return <NotFound />;
}
