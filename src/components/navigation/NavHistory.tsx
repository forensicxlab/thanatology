import * as React from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router";

type NavHistoryCtx = {
  canBack: boolean;
  canForward: boolean;
  back: () => void;
  forward: () => void;
};

const Ctx = React.createContext<NavHistoryCtx | null>(null);

export function useNavHistory() {
  const ctx = React.useContext(Ctx);
  if (!ctx)
    throw new Error("useNavHistory must be used within NavHistoryProvider");
  return ctx;
}

export function NavHistoryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const navType = useNavigationType(); // "POP" | "PUSH" | "REPLACE"

  const stackRef = React.useRef<Array<{ key: string; path: string }>>([]);
  const indexRef = React.useRef<number>(-1);

  const [flags, setFlags] = React.useState({
    canBack: false,
    canForward: false,
  });

  React.useEffect(() => {
    const entry = {
      key: location.key,
      path: location.pathname + location.search + location.hash,
    };

    const stack = stackRef.current;
    let index = indexRef.current;

    if (stack.length === 0) {
      stack.push(entry);
      index = 0;
    } else if (navType === "PUSH") {
      // new navigation: discard any "forward" entries
      stack.splice(index + 1);
      stack.push(entry);
      index = stack.length - 1;
    } else if (navType === "REPLACE") {
      // replace current entry
      if (index >= 0) stack[index] = entry;
      else {
        stack.push(entry);
        index = 0;
      }
    } else {
      // POP (back/forward via buttons, mouse buttons, OS gestures, etc.)
      const byKey = stack.findIndex((e) => e.key === entry.key);
      if (byKey !== -1) {
        index = byKey;
      } else {
        // fallback: sometimes keys can differ; try matching by path
        const byPath = stack.findIndex((e) => e.path === entry.path);
        if (byPath !== -1) index = byPath;
        else {
          // last resort: treat as a push into unknown entry
          stack.splice(index + 1);
          stack.push(entry);
          index = stack.length - 1;
        }
      }
    }

    indexRef.current = index;
    setFlags({
      canBack: index > 0,
      canForward: index < stack.length - 1,
    });
  }, [
    location.key,
    location.pathname,
    location.search,
    location.hash,
    navType,
  ]);

  const value = React.useMemo<NavHistoryCtx>(
    () => ({
      canBack: flags.canBack,
      canForward: flags.canForward,
      back: () => {
        if (flags.canBack) navigate(-1);
      },
      forward: () => {
        if (flags.canForward) navigate(1);
      },
    }),
    [flags.canBack, flags.canForward, navigate],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
