import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";

type VitestConfig = UserConfig & {
  test: {
    environment: string;
    globals: boolean;
    setupFiles: string;
  };
};

const config = {
  base: "./",
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts"
  }
} satisfies VitestConfig;

export default defineConfig(config as UserConfig);
