import tseslint from "typescript-eslint";
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/generated/**",
      "**/next-env.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
);
