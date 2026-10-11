import * as module from "node:module";
// Directory imports resolve to index.ts, other extensionless ones to .ts
// Node < 22.15 has no registerHooks: the same resolver as an asynchronous
// hook (String.raw keeps the regex's backslash; awaiting lets the catch see
// a rejected resolution)
const source = String.raw`export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier)) {
    try { return await nextResolve(specifier + ".ts", context); }
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
