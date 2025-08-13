// Terminal.tsx
import { useEffect, useRef } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { spawn } from "tauri-pty";
import { platform } from "@tauri-apps/plugin-os";

export default function Terminal() {
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Xterm({
      convertEol: true,
      windowsMode: false,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(terminalRef.current);
    const shell =
      platform() === "windows"
        ? "powershell.exe"
        : platform() === "macos"
          ? "zsh"
          : "bash";
    const pty = spawn(shell, [], {
      cols: term.cols,
      rows: term.rows,
    });

    // if (cwd) {
    //   const cd =
    //     os === "windows"
    //       ? `Set-Location -LiteralPath "${cwd}"\r`
    //       : `cd "${cwd}"\r`;
    //   pty.write(cd);
    // }

    pty.onData((data) => term.write(data));
    pty.onExit(({ exitCode }) => {
      term.write(`\n\nProgram exit: ${exitCode}`);
    });
    term.onData((data) => pty.write(data));
    term.onResize((e) => pty.resize(e.cols, e.rows));

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      pty.kill();
    };
  }, []);

  return <div ref={terminalRef} style={{ width: "100%", height: "95%" }} />;
}
