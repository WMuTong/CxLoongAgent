#!/usr/bin/env node

import { cac } from "cac";
import { registerAll } from "./commands/index.js";

const cli = cac("loong");
registerAll(cli);

cli.help();
cli.version("0.1.0");

cli.parse();
