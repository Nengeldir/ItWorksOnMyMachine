import * as module from "node:module";
// Directory imports resolve to index.ts, other extensionless ones to .ts
const source = `export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier)) {
    try { return nextResolve(specifier + ".ts", context); }
    catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
      return nextResolve(specifier + "/index.ts", context);
    }
  }
  return nextResolve(specifier, context);
}`;
if (module.registerHooks) module.registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier)) {
    try { return nextResolve(specifier + ".ts", context); }
    catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
      return nextResolve(specifier + "/index.ts", context);
    }
  }
  return nextResolve(specifier, context);
}});
else module.register("data:text/javascript," + encodeURIComponent(source));
