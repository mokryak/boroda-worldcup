import { defineConfig, loadEnv, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";

declare const process: {
  env: Record<string, string | undefined>;
  cwd: () => string;
};

type VitestConfig = UserConfig & {
  test: {
    environment: string;
    globals: boolean;
    setupFiles: string;
  };
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  const config = {
    base: viteBasePath(env.VITE_PUBLIC_BASE_PATH),
    plugins: [react()],
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./src/test/setup.ts"
    }
  } satisfies VitestConfig;

  return config as UserConfig;
});

function viteBasePath(value?: string): string {
  if (!value) {
    return "./";
  }

  return `/${value.replace(/^\/+|\/+$/g, "")}/`;
}

