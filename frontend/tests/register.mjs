import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier)) {
    try { return nextResolve(specifier + ".ts", context); }
    catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
      return nextResolve(specifier + "/index.ts", context);
    }
  }
  return nextResolve(specifier, context);
}});
