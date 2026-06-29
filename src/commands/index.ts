import type { CAC } from "cac";
import { registerClearCommand } from "./clear.js";
import { registerInitCommand } from "./init.js";
import { registerObserveCommand } from "./observe.js";
import { registerRunCommand } from "./run.js";
import { registerStopCommand } from "./stop.js";
import { registerWebuiCommand } from "./webui.js";

export function registerAll(cli: CAC) {
  registerClearCommand(cli);
  registerInitCommand(cli);
  registerObserveCommand(cli);
  registerRunCommand(cli);
  registerStopCommand(cli);
  registerWebuiCommand(cli);
}
