import path from "node:path";
import { render, renderToString } from "ink";
import React from "react";
import { DEFAULT_REFRESH_INTERVAL_MS } from "./model.js";
import { collect_dashboard_snapshot } from "./snapshot.js";
import { DashboardView } from "./view.js";

const h = React.createElement;

export async function observe_dashboard(options: {
  root_dir: string;
  once?: boolean;
  interval_ms?: number;
}): Promise<void> {
  const root_dir = path.resolve(options.root_dir);
  const interval_ms = options.interval_ms ?? DEFAULT_REFRESH_INTERVAL_MS;

  if (options.once === true) {
    console.log(render_dashboard(root_dir));
    return;
  }

  const render_snapshot = () =>
    h(DashboardView, { snapshot: collect_dashboard_snapshot(root_dir) });
  const instance = render(render_snapshot(), {
    stdout: process.stdout,
    stderr: process.stderr,
    exitOnCtrlC: false,
    incrementalRendering: true,
    maxFps: 15,
    interactive: true,
  });

  const timer = setInterval(() => {
    instance.rerender(render_snapshot());
  }, interval_ms);

  await new Promise<void>((resolve) => {
    let stopped = false;
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      instance.unmount();
      await instance.waitUntilExit().catch(() => {});
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

export function render_dashboard(root_dir: string): string {
  const snapshot = collect_dashboard_snapshot(root_dir);
  return renderToString(h(DashboardView, { snapshot }), {
    columns: process.stdout.columns ?? 100,
  });
}
