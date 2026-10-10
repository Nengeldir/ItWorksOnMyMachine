import * as module from "node:module";
const source = `export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\\.[a-z]+$/.test(specifier)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
}`;
if (module.registerHooks) module.registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
}});
else module.register("data:text/javascript," + encodeURIComponent(source));
