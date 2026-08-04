import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getHttpsServerOptions } from "office-addin-dev-certs";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const packageVersion = (
  JSON.parse(readFileSync(join(import.meta.dirname, "package.json"), "utf8")) as { version: string }
).version;

async function getDevelopmentHttps() {
  const certificateDirectory = join(homedir(), ".office-addin-dev-certs");
  const certificatePath = join(certificateDirectory, "localhost.crt");
  const keyPath = join(certificateDirectory, "localhost.key");
  if (existsSync(certificatePath) && existsSync(keyPath)) {
    return {
      cert: readFileSync(certificatePath),
      key: readFileSync(keyPath),
    };
  }
  try {
    return await getHttpsServerOptions();
  } catch (error) {
    // office-addin-dev-certs may fail while cleaning an existing certificate
    // under a locked-down Windows profile. Reuse the already-issued localhost
    // pair without attempting to write, replace, or trust another certificate.
    if (!existsSync(certificatePath) || !existsSync(keyPath)) {
      throw error;
    }
    return {
      cert: readFileSync(certificatePath),
      key: readFileSync(keyPath),
    };
  }
}

export default defineConfig(async ({ command }) => {
  const environment = (globalThis as {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  const baseConfig = {
    plugins: [react(), tailwindcss()],
    publicDir: "wps-public",
    base: "./",
    define: {
      __WORDOLLAMA_BRIDGE_URL__: JSON.stringify(
        environment?.WORDOLLAMA_BRIDGE_URL ?? "http://127.0.0.1:37421",
      ),
      __WORDOLLAMA_ADDIN_VERSION__: JSON.stringify(
        environment?.WORDOLLAMA_ADDIN_VERSION ?? packageVersion,
      ),
      // Vite 8's dev client reads these compile-time flags as globals. A task
      // pane can inherit them from an existing runtime, but an Office Dialog
      // starts in a fresh WebView and otherwise fails before React is loaded.
      __BUNDLED_DEV__: "false",
      __SERVER_FORWARD_CONSOLE__: "false",
    },
    build: {
      // WPS 12.1 currently embeds Chromium 104. Vite 8's moving default target
      // is newer, so pin both JavaScript and CSS output to the actual host.
      target: "chrome104",
      cssTarget: "chrome104",
      rollupOptions: {
        input: {
          index: join(import.meta.dirname, "index.html"),
          settings: join(import.meta.dirname, "settings.html"),
          commands: join(import.meta.dirname, "commands.html"),
          wps: join(import.meta.dirname, "wps.html"),
        },
      },
    },
  };

  // The development certificate is needed only by `vite`'s dev server.
  // Production bundles must remain deterministic and must not try to mutate
  // the user's certificate store while running in CI or a release job.
  if (command !== "serve") {
    return baseConfig;
  }

  if (environment?.OFFICE_ADDIN_DEV_HTTP === "1") {
    return {
      ...baseConfig,
      server: {
        host: "localhost",
        port: 3000,
        https: false,
      },
    };
  }

  return {
    ...baseConfig,
    server: {
      host: "localhost",
      port: 3000,
      https: await getDevelopmentHttps(),
    },
  };
});
