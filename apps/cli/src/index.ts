import { greeting } from "@slop-or-not/shared";

await Bun.write(Bun.stdout, `${greeting}\n`);
