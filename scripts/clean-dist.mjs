/** Removes generated compiler output so moved modules cannot remain in packed artifacts. */

import { rmSync } from "node:fs";

rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });
