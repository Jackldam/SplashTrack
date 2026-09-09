/**
 * Bundles the `splashtrack` CLI into one file for the image.
 *
 * WHY A BUNDLE. The CLI is TypeScript that imports across the `@/*` alias, and
 * the runtime image contains no TypeScript toolchain — `03-deployment-model.md`
 * §1.2 lists "no build tools or devDependencies in the final layer" among the
 * image's target properties, and shipping `tsx` plus the whole `src/` tree to
 * run one command would break it. `tsc` alone cannot help: it does not rewrite
 * path aliases, so its output would not resolve. esbuild does both — it reads
 * `tsconfig.json`'s `paths` and emits one module.
 *
 * `--packages=external` keeps every npm dependency out of the bundle and
 * resolved from `node_modules` at runtime. That is deliberate: bundling Prisma's
 * generated client together with `@prisma/client`'s runtime, or better-auth's
 * dynamic plugin loading, is a class of failure that appears at the worst
 * moment. Our own source is inlined; other people's stays where they put it.
 */
import { build, type Plugin } from "esbuild";

/**
 * Next.js has no `exports` map, so `next/server`, `next/headers` and
 * `next/navigation` are bare subpaths that only a CommonJS resolver can find —
 * it guesses the `.js`. Node's ESM resolver does not guess, so an external
 * `import "next/server"` inside an ESM bundle fails at runtime with
 * ERR_MODULE_NOT_FOUND, which is exactly what it did the first two times this
 * ran in the image.
 *
 * The specifiers are rewritten to their real filenames. They stay EXTERNAL: this
 * changes the name, not what is bundled.
 */
const resolveNextSubpaths: Plugin = {
  name: "next-subpath-extensions",
  setup(pluginBuild) {
    // Single-segment, extensionless `next/<name>` only: `next/dist/...` paths
    // and anything already carrying an extension resolve on their own.
    pluginBuild.onResolve({ filter: /^next\/[a-z-]+$/ }, (args) => ({
      path: `${args.path}.js`,
      external: true,
    }));
  },
};

void build({
  entryPoints: ["src/cli/index.ts"],
  // `splitting`, so the dynamic `import()` in `src/cli/index.ts` stays dynamic.
  // Bundled into one file, esbuild inlines those imports and `secret:init` —
  // the command that must run with no key and no database — would load the auth
  // instance and the Prisma client at start-up, which is the one thing it may
  // not do.
  outdir: "dist",
  entryNames: "cli",
  outExtension: { ".js": ".mjs" },
  splitting: true,
  plugins: [resolveNextSubpaths],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  tsconfig: "tsconfig.json",
  // Source maps would put the whole `src/` tree into the image as text, which
  // is a bigger layer for a stack trace this CLI deliberately does not print
  // (see `src/cli/index.ts`).
  sourcemap: false,
  banner: {
    // `createRequire` is used by the CLI to resolve the Prisma binary; ESM has
    // no `require`, and esbuild does not shim it for external packages.
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
}).then(
  () => console.log("Built dist/cli.mjs"),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
