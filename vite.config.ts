import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";

declare const process: {
  env: Record<string, string | undefined>;
};

type VitestConfig = UserConfig & {
  test: {
    environment: string;
    globals: boolean;
    setupFiles: string;
  };
};

const config = {
  base: viteBasePath(process.env.VITE_PUBLIC_BASE_PATH),
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts"
  }
} satisfies VitestConfig;

export default defineConfig(config as UserConfig);

function viteBasePath(value?: string): string {
  if (!value) {
    return "./";
  }

  return `/${value.replace(/^\/+|\/+$/g, "")}/`;
}
