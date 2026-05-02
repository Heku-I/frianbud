import envPaths from "env-paths";
import { join } from "node:path";

export function resolveProfilePath(): string {
  const override = process.env.FRIANBUD_PROFILE_PATH;
  if (override && override.length > 0) return override;
  const paths = envPaths("frianbud", { suffix: "" });
  return join(paths.config, "profile.json");
}
